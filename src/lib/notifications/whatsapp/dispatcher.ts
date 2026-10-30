/**
 * Automated WhatsApp Notification Dispatcher & Queue Integration
 * eLTs Visual Studio OS
 *
 * Bridges the self-hosted Baileys provider with public.notification_logs,
 * providing audit logging, automatic state transitions, and exponential retry.
 */

import { createServiceSupabase } from "@/lib/supabase/service";
import { getBaileysProvider } from "./baileys-provider";
import { formatRupiah, formatDateId } from "@/lib/reminders/compose";
import type {
  NotificationTrigger,
  NotificationResult,
  SendWhatsAppOptions,
  NotificationDispatchContext,
} from "../types";

export interface DispatchResult {
  ok: boolean;
  logId?: string;
  result: NotificationResult;
}

/**
 * Low-level dispatch executor.
 * Records the notification in notification_logs, calls Baileys, and updates status.
 */
export async function dispatchWhatsAppNotification(
  trigger: NotificationTrigger,
  opts: SendWhatsAppOptions,
  context: NotificationDispatchContext = {}
): Promise<DispatchResult> {
  const provider = getBaileysProvider();
  const preview = opts.messageText.slice(0, 120).replace(/\n/g, " ");
  let logId: string | undefined;

  // 1. Record PENDING attempt in database (if Supabase configured)
  try {
    const supabase = createServiceSupabase();
    const { data: logEntry, error: insertErr } = await supabase
      .from("notification_logs")
      .insert({
        channel: "WHATSAPP",
        trigger_type: trigger,
        recipient: opts.recipientPhone,
        subject_or_preview: preview,
        provider: provider.name,
        status: "PENDING",
        project_id: context.projectId || null,
        invoice_id: context.invoiceId || null,
        payload_json: {
          recipientPhone: opts.recipientPhone,
          messagePreview: preview,
          mediaUrl: opts.mediaUrl,
          metadata: opts.metadata,
        },
      })
      .select("id")
      .maybeSingle();

    if (!insertErr && logEntry) {
      logId = logEntry.id;
    }
  } catch (dbErr) {
    console.warn("[Dispatcher] Could not create initial notification_log entry:", dbErr);
  }

  // 2. Transmit message via Baileys Provider
  const result = await provider.sendMessage(opts);

  // 3. Update database log with final outcome
  if (logId) {
    try {
      const supabase = createServiceSupabase();
      if (result.success) {
        await supabase
          .from("notification_logs")
          .update({
            status: "SENT",
            external_id: result.externalMessageId || null,
            dispatched_at: result.timestamp,
          })
          .eq("id", logId);
      } else {
        await supabase
          .from("notification_logs")
          .update({
            status: "FAILED",
            error_message: result.error || "Unknown send error",
            retry_count: 1,
            next_retry_at: new Date(Date.now() + 60 * 1000).toISOString(), // 1 min backoff
          })
          .eq("id", logId);
      }
    } catch (updateErr) {
      console.warn("[Dispatcher] Could not update notification_log status:", updateErr);
    }
  }

  return {
    ok: result.success,
    logId,
    result,
  };
}

// ── Domain-Specific Automated Dispatchers ────────────────────────────────────

/**
 * Dispatch Proofing Gallery Magic Link to client upon project readiness.
 */
export async function notifyProofingMagicLink(params: {
  projectId: string;
  clientName: string;
  clientPhone: string;
  projectName: string;
  accessToken: string;
  selectionQuotaMin: number;
  selectionQuotaMax: number;
  selectionDeadline?: string | null;
}): Promise<DispatchResult> {
  const deadlineStr = params.selectionDeadline
    ? formatDateId(params.selectionDeadline)
    : "7 hari kerja sejak pesan ini diterima";

  const messageText = [
    `Halo Kak ${params.clientName || "Pelanggan"}, terima kasih telah mempercayakan momen berharga Anda kepada eLTs Photography! ✨`,
    "",
    `Galeri foto untuk proyek *"${params.projectName}"* sudah selesai diproses dan siap untuk Anda pilih:`,
    "",
    `🔗 *Akses Galeri Proofing:*`,
    `https://client.elts.co.id/proofing/${params.accessToken}`,
    "",
    `📋 *Panduan Pemilihan:*`,
    `• Kuota Foto Pilihan: *${params.selectionQuotaMin} - ${params.selectionQuotaMax} foto*`,
    `• Batas Waktu Pemilihan: *${deadlineStr}*`,
    "",
    `Silakan buka tautan di atas untuk melihat foto dan menandai foto favorit Anda. Setelah kuota terpenuhi, klik tombol *"Kunci Pilihan"* agar langsung masuk ke antrean kurasi editor kami.`,
    "",
    `Salam hangat,`,
    `*eLTs Photography Studio Operations*`,
  ].join("\n");

  return dispatchWhatsAppNotification(
    "PROOFING_DELIVERY_MAGIC_LINK",
    {
      recipientPhone: params.clientPhone,
      messageText,
      metadata: {
        projectId: params.projectId,
        accessToken: params.accessToken,
      },
    },
    {
      projectId: params.projectId,
      clientName: params.clientName,
    }
  );
}

/**
 * Dispatch Deadline Countdown Warning when selection deadline approaches.
 */
export async function notifyProofingDeadlineWarning(params: {
  projectId: string;
  clientName: string;
  clientPhone: string;
  projectName: string;
  accessToken: string;
  remainingDaysOrHoursText: string;
  selectionDeadline: string;
}): Promise<DispatchResult> {
  const deadlineFormatted = formatDateId(params.selectionDeadline);

  const messageText = [
    `Halo Kak ${params.clientName || "Pelanggan"}, pengingat ramah dari eLTs Photography! ⏳`,
    "",
    `Batas waktu pemilihan foto untuk proyek *"${params.projectName}"* tersisa *${params.remainingDaysOrHoursText}* (jatuh tempo pada *${deadlineFormatted}*).`,
    "",
    `🔗 *Lanjutkan Pemilihan Foto:*`,
    `https://client.elts.co.id/proofing/${params.accessToken}`,
    "",
    `Agar proses penyuntingan dan pengiriman album tidak tertunda, mohon segera mengunci pilihan foto terbaik Anda.`,
    "",
    `Butuh bantuan? Silakan langsung balas pesan ini.`,
    "",
    `Salam hangat,`,
    `*eLTs Photography Studio Operations*`,
  ].join("\n");

  return dispatchWhatsAppNotification(
    "PROOFING_DEADLINE_WARNING",
    {
      recipientPhone: params.clientPhone,
      messageText,
      metadata: {
        projectId: params.projectId,
        selectionDeadline: params.selectionDeadline,
      },
    },
    {
      projectId: params.projectId,
      clientName: params.clientName,
    }
  );
}

/**
 * Dispatch Confirmation when client locks their photo selection.
 */
export async function notifySelectionConfirmation(params: {
  projectId: string;
  clientName: string;
  clientPhone: string;
  projectName: string;
  selectedCount: number;
}): Promise<DispatchResult> {
  const messageText = [
    `Halo Kak ${params.clientName || "Pelanggan"}, terima kasih! 🙌`,
    "",
    `Pilihan *${params.selectedCount} foto* untuk proyek *"${params.projectName}"* telah berhasil dikunci dan kami terima.`,
    "",
    `Tim editor eLTs Photography telah menerima manifest pemilihan Anda dan segera memulai tahap finalisasi & color grading.`,
    "",
    `Kami akan mengabari Anda kembali segera setelah seluruh hasil final siap diunduh.`,
    "",
    `Salam hangat,`,
    `*eLTs Photography Studio Operations*`,
  ].join("\n");

  return dispatchWhatsAppNotification(
    "SELECTION_CONFIRMATION",
    {
      recipientPhone: params.clientPhone,
      messageText,
      metadata: {
        projectId: params.projectId,
        selectedCount: params.selectedCount,
      },
    },
    {
      projectId: params.projectId,
      clientName: params.clientName,
    }
  );
}

/**
 * Dispatch Commercial Invoice notification with payment details.
 */
export async function notifyInvoiceIssued(params: {
  invoiceId: string;
  projectId: string;
  clientName: string;
  clientPhone: string;
  projectName: string;
  invoiceNumber: string;
  grossAmount: number;
  minimumDpPct: number;
  dueDate?: string | null;
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
}): Promise<DispatchResult> {
  const dpAmount = Math.round((params.grossAmount * params.minimumDpPct) / 100);
  const dueFormatted = params.dueDate ? formatDateId(params.dueDate) : "Sesuai kesepakatan";

  const messageText = [
    `Halo Kak ${params.clientName || "Pelanggan"},`,
    "",
    `Invoice komersial resmi untuk proyek *"${params.projectName}"* telah diterbitkan oleh studio eLTs:`,
    "",
    `📄 *No. Invoice:* ${params.invoiceNumber}`,
    `💰 *Total Nilai Kontrak:* ${formatRupiah(params.grossAmount)}`,
    `💳 *Uang Muka (DP ${params.minimumDpPct}%):* ${formatRupiah(dpAmount)}`,
    `📅 *Batas Pembayaran:* ${dueFormatted}`,
    "",
    params.bankName
      ? [
          `🏦 *Rekening Pembayaran Resmi:*`,
          `Bank: *${params.bankName}*`,
          `No. Rekening: *${params.accountNumber}*`,
          `Atas Nama: *${params.accountHolder}*`,
          "",
        ].join("\n")
      : "",
    `Setelah melakukan transfer, silakan kirimkan bukti transfer kepada kami untuk verifikasi otomatis.`,
    "",
    `Terima kasih atas kerja samanya!`,
    `*eLTs Photography Studio Finance*`,
  ].filter(Boolean).join("\n");

  return dispatchWhatsAppNotification(
    "INVOICE_ISSUED",
    {
      recipientPhone: params.clientPhone,
      messageText,
      metadata: {
        invoiceId: params.invoiceId,
        invoiceNumber: params.invoiceNumber,
      },
    },
    {
      projectId: params.projectId,
      invoiceId: params.invoiceId,
      clientName: params.clientName,
    }
  );
}

/**
 * Dispatch Verified Payment Confirmation Receipt to client.
 */
export async function notifyPaymentReceiptConfirmed(params: {
  receiptId: string;
  invoiceId: string;
  projectId: string;
  clientName: string;
  clientPhone: string;
  projectName: string;
  receiptNumber: string;
  amountPaid: number;
  isFullyPaid: boolean;
}): Promise<DispatchResult> {
  const messageText = [
    `Halo Kak ${params.clientName || "Pelanggan"}, pembayaran Anda telah kami terima & verifikasi! ✅`,
    "",
    `🧾 *No. Kwitansi:* ${params.receiptNumber}`,
    `💵 *Jumlah Diterima:* ${formatRupiah(params.amountPaid)}`,
    `📁 *Proyek:* ${params.projectName}`,
    `📊 *Status:* ${params.isFullyPaid ? "LUNAS (100% Terbayar)" : "Uang Muka (DP) Terverifikasi"}`,
    "",
    params.isFullyPaid
      ? "🎉 Seluruh hak unduh resolusi tinggi dan master Google Drive untuk proyek Anda telah dibuka secara otomatis!"
      : "Jadwal dan persiapan teknis untuk proyek Anda telah diamankan.",
    "",
    `Terima kasih telah memilih eLTs Photography!`,
    `*eLTs Photography Studio Finance*`,
  ].join("\n");

  return dispatchWhatsAppNotification(
    "PAYMENT_RECEIPT_CONFIRMED",
    {
      recipientPhone: params.clientPhone,
      messageText,
      metadata: {
        receiptId: params.receiptId,
        invoiceId: params.invoiceId,
        isFullyPaid: params.isFullyPaid,
      },
    },
    {
      projectId: params.projectId,
      invoiceId: params.invoiceId,
      clientName: params.clientName,
    }
  );
}
