/**
 * Notification Subsystem Core Types & Contracts
 * eLTs Visual Studio OS
 */

export type NotificationChannel = "WHATSAPP" | "EMAIL";

export type NotificationTrigger =
  | "PROOFING_DELIVERY_MAGIC_LINK"
  | "PROOFING_DEADLINE_WARNING"
  | "SELECTION_CONFIRMATION"
  | "INVOICE_ISSUED"
  | "PAYMENT_RECEIPT_CONFIRMED"
  | "SHOOT_CALLSHEET_T_MINUS_1";

export type NotificationStatus = "PENDING" | "SENT" | "FAILED" | "DELIVERED";

export interface NotificationAttachment {
  filename: string;
  content: Buffer | string; // Buffer or Base64 string
  contentType: string;
}

export interface SendWhatsAppOptions {
  recipientPhone: string;
  messageText: string;
  mediaUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface SendEmailOptions {
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  attachments?: NotificationAttachment[];
  metadata?: Record<string, unknown>;
}

export interface NotificationResult {
  success: boolean;
  provider: string;
  externalMessageId?: string;
  error?: string;
  timestamp: string;
}

export interface WhatsAppConnectionState {
  isConnected: boolean;
  isConnecting: boolean;
  qrCode?: string | null;
  lastDisconnectReason?: string | null;
  connectedPhone?: string | null;
  lastConnectedAt?: string | null;
}

/**
 * Abstract WhatsApp Provider Interface
 * Supports self-hosted Baileys, Meta Cloud API, or external gateways.
 */
export interface IWhatsAppProvider {
  readonly name: string;
  sendMessage(opts: SendWhatsAppOptions): Promise<NotificationResult>;
  getConnectionStatus(): WhatsAppConnectionState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * Abstract Transactional Email Provider Interface
 */
export interface IEmailProvider {
  readonly name: string;
  sendEmail(opts: SendEmailOptions): Promise<NotificationResult>;
}

export interface NotificationDispatchContext {
  projectId?: string | null;
  invoiceId?: string | null;
  clientName?: string | null;
}
