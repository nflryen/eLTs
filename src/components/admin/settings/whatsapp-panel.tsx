"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import {
  Smartphone,
  QrCode,
  Wifi,
  WifiOff,
  RefreshCw,
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
  LogOut,
  Info,
} from "lucide-react";
import {
  getWhatsAppStatusWithQrAction,
  connectWhatsAppAction,
  disconnectWhatsAppAction,
  sendTestWhatsAppPingAction,
} from "@/app/actions/whatsapp-actions";
import type { WhatsAppConnectionState } from "@/lib/notifications/types";

interface WhatsAppStatusData extends WhatsAppConnectionState {
  qrDataUrl?: string | null;
}

export function WhatsAppPanel({ initialStatus }: { initialStatus: WhatsAppStatusData }) {
  const [status, setStatus] = useState<WhatsAppStatusData>(initialStatus);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const fetchStatus = useCallback(async () => {
    try {
      const data = await getWhatsAppStatusWithQrAction();
      setStatus(data);
    } catch (err) {
      console.warn("Could not poll WhatsApp status:", err);
    }
  }, []);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await fetchStatus();
    setIsRefreshing(false);
  };

  const handleConnect = () => {
    startTransition(async () => {
      try {
        await connectWhatsAppAction();
        await fetchStatus();
      } catch (err) {
        console.error("Connect failed:", err);
      }
    });
  };

  const handleDisconnect = () => {
    if (!confirm("Apakah Anda yakin ingin memutuskan sesi WhatsApp ini?")) return;
    startTransition(async () => {
      try {
        await disconnectWhatsAppAction();
        await fetchStatus();
      } catch (err) {
        console.error("Disconnect failed:", err);
      }
    });
  };

  const handleSendTestPing = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone.trim()) return;

    setTestResult(null);
    startTransition(async () => {
      try {
        const res = await sendTestWhatsAppPingAction(testPhone.trim());
        if (res.success) {
          setTestResult({
            success: true,
            message: "Pesan pengujian berhasil dikirim!",
          });
        } else {
          setTestResult({
            success: false,
            message: res.error || "Gagal mengirim pesan pengujian.",
          });
        }
      } catch (err) {
        setTestResult({
          success: false,
          message: err instanceof Error ? err.message : "Terjadi kesalahan sistem.",
        });
      }
    });
  };

  // ── Polite Polling Engine ──────────────────────────────────────────────────
  useEffect(() => {
    // Poll fast (3.5s) if waiting for QR or connecting, slower (12s) if connected, idle (20s) if disconnected
    let intervalMs = 20000;
    if (status.isConnecting || status.qrDataUrl) {
      intervalMs = 3500;
    } else if (status.isConnected) {
      intervalMs = 12000;
    }

    const timer = setInterval(() => {
      fetchStatus();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [status.isConnecting, status.qrDataUrl, status.isConnected, fetchStatus]);

  return (
    <div className="space-y-6">
      {/* ── Status Header Card ── */}
      <div className="rounded-xl border border-[#ececee] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                status.isConnected
                  ? "bg-emerald-50 text-emerald-600"
                  : status.isConnecting || status.qrDataUrl
                    ? "bg-amber-50 text-amber-600"
                    : "bg-zinc-100 text-zinc-500"
              }`}
            >
              {status.isConnected ? (
                <Wifi size={24} />
              ) : status.isConnecting || status.qrDataUrl ? (
                <QrCode size={24} className="animate-pulse" />
              ) : (
                <WifiOff size={24} />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[#18181b]">WhatsApp Gateway (Self-Hosted)</h2>
                {status.isConnected ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Terhubung
                  </span>
                ) : status.isConnecting || status.qrDataUrl ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    <Loader2 size={10} className="animate-spin" />
                    Menunggu Pindai QR
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                    Terputus
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[#71717a]">
                {status.isConnected
                  ? `Nomor Studio: +${status.connectedPhone || "Aktif"} · Tanpa biaya langganan pihak ketiga`
                  : "Menghubungkan sistem notifikasi otomatis langsung dengan nomor WhatsApp Business studio."}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#ececee] bg-white px-3 py-1.5 text-xs font-medium text-[#3f3f46] hover:bg-[#fafafa] disabled:opacity-50"
            >
              <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
              <span>Segarkan</span>
            </button>

            {status.isConnected ? (
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                <LogOut size={13} />
                <span>Putuskan Sesi</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#18181b] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-black disabled:opacity-50 shadow-sm"
              >
                {isPending ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />}
                <span>{status.qrDataUrl ? "Refresh QR" : "Hubungkan WhatsApp"}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── QR Code Scanner Card (Visible when awaiting authentication) ── */}
      {status.qrDataUrl && !status.isConnected && (
        <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/50 p-6 shadow-sm">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:gap-8">
            <div className="flex shrink-0 flex-col items-center rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={status.qrDataUrl}
                alt="Pindai QR WhatsApp Studio"
                className="h-56 w-56 rounded-lg object-contain"
              />
              <p className="mt-2 text-[11px] font-medium text-amber-700 flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                QR aktif · Memindai otomatis...
              </p>
            </div>

            <div className="space-y-3">
              <div className="inline-flex items-center gap-1.5 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                <Smartphone size={13} />
                Langkah Penghubungan Perangkat
              </div>
              <h3 className="text-base font-semibold text-[#18181b]">
                Pindai Kode QR dengan WhatsApp Studio Anda
              </h3>
              <ol className="list-inside list-decimal space-y-2 text-xs leading-relaxed text-[#52525b]">
                <li>
                  Buka aplikasi <strong>WhatsApp</strong> atau <strong>WhatsApp Business</strong> pada ponsel resmi studio.
                </li>
                <li>
                  Buka <strong>Menu (titik tiga)</strong> di Android atau <strong>Pengaturan</strong> di iPhone.
                </li>
                <li>
                  Pilih <strong>Perangkat Tertaut (Linked Devices)</strong>, lalu ketuk{" "}
                  <strong>Tautkan Perangkat (Link a Device)</strong>.
                </li>
                <li>
                  Arahkan kamera ponsel Anda ke kode QR di samping untuk menyelesaikan autentikasi.
                </li>
              </ol>

              <div className="rounded-lg border border-amber-200 bg-white/80 p-3 text-xs text-[#71717a]">
                <p className="flex items-center gap-1.5 font-medium text-[#18181b]">
                  <Info size={14} className="text-amber-600 shrink-0" />
                  Kredensial Aman & Permanen
                </p>
                <p className="mt-0.5">
                  Setelah berhasil ditautkan, sesi tersimpan secara lokal dan otomatis tersambung kembali saat server
                  dijalankan ulang tanpa perlu memindai ulang.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Connected Overview Card ── */}
      {status.isConnected && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 text-xs text-emerald-900">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-emerald-950">WhatsApp Studio Berhasil Terhubung</p>
              <p className="text-emerald-800 leading-relaxed">
                Seluruh notifikasi otomatis (Proofing Magic Link, peringatan batas waktu pemilihan, faktur komersial,
                dan konfirmasi pembayaran) siap dikirim secara langsung dari nomor studio Anda tanpa batas kuota.
              </p>
              {status.lastConnectedAt && (
                <p className="text-[11px] text-emerald-700 pt-1">
                  Waktu tersambung: {new Date(status.lastConnectedAt).toLocaleString("id-ID")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Disconnect Error Notice (if any) ── */}
      {status.lastDisconnectReason && !status.isConnected && !status.qrDataUrl && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-600 flex items-start gap-2.5">
          <AlertCircle size={15} className="text-zinc-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-zinc-900">Catatan Koneksi Terakhir:</p>
            <p className="text-zinc-600 mt-0.5">{status.lastDisconnectReason}</p>
          </div>
        </div>
      )}

      {/* ── Test Message Ping Form ── */}
      <div className="rounded-xl border border-[#ececee] bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-[#18181b]">Uji Coba Pengiriman Pesan</h3>
        <p className="mt-1 text-xs text-[#71717a]">
          Kirimkan pesan uji coba ke nomor Anda untuk memastikan gateway Baileys berfungsi dengan sempurna.
        </p>

        <form onSubmit={handleSendTestPing} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Contoh: 081234567890 atau 628123456789"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            className="flex-1 rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b] transition-colors"
          />
          <button
            type="submit"
            disabled={isPending || !testPhone.trim()}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#18181b] px-4 py-2 text-xs font-medium text-white hover:bg-black disabled:opacity-50 shadow-sm"
          >
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            <span>Kirim Pesan Uji</span>
          </button>
        </form>

        {testResult && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-lg p-3 text-xs ${
              testResult.success
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle size={14} className="shrink-0 text-red-600" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
