"use server";

import { requireOps } from "@/lib/auth/roles";
import { getBaileysProvider } from "@/lib/notifications/whatsapp/baileys-provider";
import {
  notifyProofingMagicLink,
  notifyProofingDeadlineWarning,
  dispatchWhatsAppNotification,
} from "@/lib/notifications/whatsapp/dispatcher";
import type { WhatsAppConnectionState, NotificationResult } from "@/lib/notifications/types";

/**
 * Inspect live Baileys WhatsApp connection status and current QR code if pending.
 */
export async function getWhatsAppConnectionStatusAction(): Promise<WhatsAppConnectionState> {
  await requireOps();
  const provider = getBaileysProvider();
  return provider.getConnectionStatus();
}

/**
 * Manually connect or re-trigger Baileys connection handshake.
 */
export async function connectWhatsAppAction(): Promise<WhatsAppConnectionState> {
  await requireOps();
  const provider = getBaileysProvider();
  await provider.connect();
  return provider.getConnectionStatus();
}

/**
 * Operator action to manually dispatch / re-send Proofing Magic Link via WhatsApp.
 */
export async function sendProofingMagicLinkAction(projectId: string): Promise<{
  success: boolean;
  error?: string;
  result?: NotificationResult;
}> {
  try {
    const { supabase } = await requireOps();

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name, access_token, selection_quota_min, selection_quota_max, selection_deadline, customer_id, customers!inner(name, phone)")
      .eq("id", projectId)
      .maybeSingle();

    if (projErr || !project) {
      return { success: false, error: "Data proyek atau pelanggan tidak ditemukan." };
    }

    const customer = (project as unknown as { customers: { name: string; phone: string | null } | null }).customers;
    if (!customer?.phone) {
      return { success: false, error: "Nomor WhatsApp pelanggan belum tercatat." };
    }

    if (!project.access_token) {
      return { success: false, error: "Token akses galeri belum dibuat untuk proyek ini." };
    }

    const dispatchRes = await notifyProofingMagicLink({
      projectId: project.id,
      clientName: customer.name,
      clientPhone: customer.phone,
      projectName: project.name,
      accessToken: project.access_token,
      selectionQuotaMin: project.selection_quota_min || 15,
      selectionQuotaMax: project.selection_quota_max || 20,
      selectionDeadline: project.selection_deadline,
    });

    return {
      success: dispatchRes.ok,
      error: dispatchRes.result.error,
      result: dispatchRes.result,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Gagal mengirim link proofing WhatsApp.",
    };
  }
}

/**
 * Operator action to manually dispatch a deadline warning countdown.
 */
export async function sendDeadlineReminderAction(projectId: string): Promise<{
  success: boolean;
  error?: string;
  result?: NotificationResult;
}> {
  try {
    const { supabase } = await requireOps();

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name, access_token, selection_deadline, customer_id, customers!inner(name, phone)")
      .eq("id", projectId)
      .maybeSingle();

    if (projErr || !project) {
      return { success: false, error: "Data proyek tidak ditemukan." };
    }

    const customer = (project as unknown as { customers: { name: string; phone: string | null } | null }).customers;
    if (!customer?.phone) {
      return { success: false, error: "Nomor WhatsApp pelanggan belum tercatat." };
    }

    if (!project.access_token || !project.selection_deadline) {
      return { success: false, error: "Batas waktu atau token akses galeri belum diatur." };
    }

    const deadlineTime = new Date(project.selection_deadline).getTime();
    const nowTime = Date.now();
    const diffHours = Math.max(0, Math.round((deadlineTime - nowTime) / (1000 * 60 * 60)));
    const remainingText = diffHours > 24
      ? `${Math.floor(diffHours / 24)} hari lagi`
      : `${diffHours} jam lagi`;

    const dispatchRes = await notifyProofingDeadlineWarning({
      projectId: project.id,
      clientName: customer.name,
      clientPhone: customer.phone,
      projectName: project.name,
      accessToken: project.access_token,
      remainingDaysOrHoursText: remainingText,
      selectionDeadline: project.selection_deadline,
    });

    return {
      success: dispatchRes.ok,
      error: dispatchRes.result.error,
      result: dispatchRes.result,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Gagal mengirim pengingat deadline WhatsApp.",
    };
  }
}

/**
 * Send a quick test ping from operator console to verify live Baileys connectivity.
 */
export async function sendTestWhatsAppPingAction(targetPhone: string): Promise<{
  success: boolean;
  error?: string;
  result?: NotificationResult;
}> {
  try {
    await requireOps();
    const dispatchRes = await dispatchWhatsAppNotification("PROOFING_DELIVERY_MAGIC_LINK", {
      recipientPhone: targetPhone,
      messageText: `🧪 *eLTs Studio OS Test Ping*\nKoneksi WhatsApp Gateway Baileys self-hosted berhasil dan aktif!\nTimestamp: ${new Date().toISOString()}`,
    });

    return {
      success: dispatchRes.ok,
      error: dispatchRes.result.error,
      result: dispatchRes.result,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Gagal mengirim pesan pengujian.",
    };
  }
}
