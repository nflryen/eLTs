/**
 * Self-Hosted Baileys WhatsApp Web Multi-Device Adapter
 * eLTs Visual Studio OS
 *
 * Implements IWhatsAppProvider without external subscription dependencies.
 * Uses persistent multi-file auth credentials in .data/baileys_auth.
 */

import type { WASocket, ConnectionState } from "@whiskeysockets/baileys";
import path from "node:path";
import fs from "node:fs";
import { normalisePhone } from "@/lib/whatsapp/phone";
import type {
  IWhatsAppProvider,
  NotificationResult,
  SendWhatsAppOptions,
  WhatsAppConnectionState,
} from "../types";

/** Singleton holder across Next.js module reloads */
declare global {
  var __elts_baileys_provider__: BaileysWhatsAppProvider | undefined;
}

export class BaileysWhatsAppProvider implements IWhatsAppProvider {
  public readonly name = "BAILEYS_SELF_HOSTED";

  private socket: WASocket | null = null;
  private authDir: string;
  private isConnected = false;
  private isConnecting = false;
  private currentQr: string | null = null;
  private lastDisconnectReason: string | null = null;
  private connectedPhone: string | null = null;
  private lastConnectedAt: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000;

  constructor(customAuthDir?: string) {
    this.authDir =
      customAuthDir ||
      process.env.WHATSAPP_AUTH_DIR ||
      path.join(process.cwd(), ".data", "baileys_auth");

    if (typeof window === "undefined") {
      try {
        if (!fs.existsSync(this.authDir)) {
          fs.mkdirSync(this.authDir, { recursive: true });
        }
      } catch (err) {
        console.warn("[Baileys] Unable to create auth directory:", err);
      }
    }
  }

  /**
   * Determine if the provider should operate in mock mode.
   * Enabled during unit tests, CI, build phase, or when MOCK_WHATSAPP=true.
   */
  private isMockMode(): boolean {
    if (process.env.ENABLE_REAL_BAILEYS === "true") return false;
    if (process.env.MOCK_WHATSAPP === "true") return true;
    if (process.env.NEXT_PHASE === "phase-production-build" || process.env.NEXT_PHASE === "phase-export") return true;
    if (
      process.env.NODE_ENV === "test" ||
      process.execArgv.includes("--test") ||
      process.argv.some((a) => a.includes("test"))
    ) {
      return true;
    }

    // If not paired yet in development, fall back to mock safely
    const credsFile = path.join(this.authDir, "creds.json");
    if (!fs.existsSync(credsFile) && process.env.NODE_ENV !== "production") {
      return true;
    }

    return false;
  }

  public getConnectionStatus(): WhatsAppConnectionState {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      qrCode: this.currentQr,
      lastDisconnectReason: this.lastDisconnectReason,
      connectedPhone: this.connectedPhone,
      lastConnectedAt: this.lastConnectedAt,
    };
  }

  /**
   * Connect or re-connect the Baileys WASocket client.
   */
  public async connect(): Promise<void> {
    if (this.isMockMode()) {
      this.isConnected = true;
      this.isConnecting = false;
      this.connectedPhone = "6280000000000";
      this.lastConnectedAt = new Date().toISOString();
      return;
    }

    if (this.socket && this.isConnected) {
      return;
    }

    if (this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    try {
      const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = await import(
        "@whiskeysockets/baileys"
      );
      const { default: pino } = await import("pino");

      // eslint-disable-next-line react-hooks/rules-of-hooks
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      const logger = pino({
        level: process.env.NODE_ENV === "development" ? "warn" : "silent",
      });

      this.socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: ["eLTs Studio OS", "Chrome", "macOS"],
        connectTimeoutMs: 25000,
        keepAliveIntervalMs: 15000,
      });

      this.socket.ev.on("creds.update", saveCreds);

      this.socket.ev.on("connection.update", (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.currentQr = qr;
        }

        if (connection === "close") {
          this.isConnected = false;
          this.isConnecting = false;
          const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          this.lastDisconnectReason = `Disconnected (code ${statusCode ?? "unknown"})`;

          if (shouldReconnect) {
            this.scheduleReconnect();
          } else {
            this.currentQr = null;
            this.socket = null;
          }
        } else if (connection === "open") {
          this.isConnected = true;
          this.isConnecting = false;
          this.currentQr = null;
          this.reconnectAttempts = 0;
          this.lastDisconnectReason = null;
          this.lastConnectedAt = new Date().toISOString();
          this.connectedPhone = this.socket?.user?.id?.split(":")[0] || null;
        }
      });
    } catch (err: unknown) {
      this.isConnecting = false;
      this.isConnected = false;
      this.lastDisconnectReason = err instanceof Error ? err.message : String(err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        console.warn("[Baileys] Automatic reconnection failed:", err);
      });
    }, delay);
  }

  public async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.end(undefined);
      } catch {
        // ignore clean close errors
      }
      this.socket = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
  }

  /**
   * Send a WhatsApp message to an Indonesian or international mobile number.
   */
  public async sendMessage(opts: SendWhatsAppOptions): Promise<NotificationResult> {
    const timestamp = new Date().toISOString();

    // 1. Normalise phone number to WhatsApp JID format
    const parsed = normalisePhone(opts.recipientPhone);
    if (!parsed.ok) {
      return {
        success: false,
        provider: this.name,
        error: `Nomor telepon tidak valid (${parsed.reason}): "${opts.recipientPhone}"`,
        timestamp,
      };
    }

    const jid = `${parsed.phone.e164}@s.whatsapp.net`;

    // 2. Handle Mock Mode
    if (this.isMockMode()) {
      return {
        success: true,
        provider: this.name,
        externalMessageId: `mock_baileys_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp,
      };
    }

    // 3. Ensure live socket connection
    if (!this.isConnected || !this.socket) {
      await this.connect();
      // Allow brief handshake window
      if (!this.isConnected || !this.socket) {
        return {
          success: false,
          provider: this.name,
          error: "Klien WhatsApp belum terhubung. Silakan pindai QR code terlebih dahulu.",
          timestamp,
        };
      }
    }

    try {
      let sentResult;
      if (opts.mediaUrl) {
        sentResult = await this.socket.sendMessage(jid, {
          image: { url: opts.mediaUrl },
          caption: opts.messageText,
        });
      } else {
        sentResult = await this.socket.sendMessage(jid, {
          text: opts.messageText,
        });
      }

      const externalMessageId = sentResult?.key?.id || undefined;

      return {
        success: true,
        provider: this.name,
        externalMessageId,
        timestamp,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        provider: this.name,
        error: errorMessage,
        timestamp,
      };
    }
  }
}

/**
 * Global singleton accessor for the Baileys provider.
 */
export function getBaileysProvider(): BaileysWhatsAppProvider {
  if (!globalThis.__elts_baileys_provider__) {
    globalThis.__elts_baileys_provider__ = new BaileysWhatsAppProvider();
  }
  return globalThis.__elts_baileys_provider__;
}
