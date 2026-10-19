"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOps } from "@/lib/auth/roles";
import { createServiceSupabase } from "@/lib/supabase/service";
import { composeReminder, type PaymentMethod, type ReminderKind, type ReminderProject, REMINDER_KINDS } from "@/lib/reminders/compose";
import { formatPhoneForDisplay, normalisePhone } from "@/lib/whatsapp/phone";
import { signInvoicePdfToken } from "@/lib/pdf/token";
import { site } from "@/config/site";

/**
 * Project action bar: every reminder the operator can dispatch from the project
 * header, plus the invoice PDF link.
 *
 * Composition happens here, on the server, because the message depends on the
 * full project record. The browser receives a finished message and a `wa.me`
 * link — it never assembles payment details itself.
 */

export type ReminderPreview = {
  kind: ReminderKind;
  message: string;
  waUrl: string | null;
  targetPhone: string | null;
  /** Field names the operator must fill before this can be sent. */
  missing: string[];
};

export type ProjectActionContext = {
  projectId: string;
  projectName: string;
  clientName: string | null;
  clientPhoneDisplay: string | null;
  suggested: ReminderKind[];
  available: Array<{ kind: ReminderKind; label: string }>;
  invoices: Array<{ id: string; invoiceNumber: string; pdfUrl: string | null }>;
};

const REMINDER_LABELS: Record<ReminderKind, string> = {
  T_MINUS_7_PREP: "Persiapan H-7",
  T_MINUS_1_CALLSHEET: "Call Sheet H-1",
  SHOOT_DAY_ONSITE: "Hari Pengambilan",
  GALLERY_READY: "Galeri Siap",
  PAYMENT_DP: "Tegur DP",
  PAYMENT_FINAL: "Tegur Pelunasan",
  PAYMENT_OVERDUE: "Tagihan Lewat Tempo",
  SELECTION_REMINDER: "Pengingat Seleksi",
};

const uuidSchema = z.uuid();

/** Calendar date in the studio's local zone, never UTC-shifted. */
function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function pdfSecret(): string | null {
  const secret = process.env.INVOICE_PDF_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

/**
 * Loads the reminder context for one project. Returns null when the project is
 * missing or the caller lacks access.
 */
async function loadReminderContext(projectId: string) {
  const { supabase } = await requireOps();
  const service = createServiceSupabase();

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, name, shoot_date, gallery_url, gallery_code, selection_deadline, venue_name, venue_address, venue_maps_url, call_time, customer_id, status")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !project) return null;

  const { data: customer } = await supabase
    .from("customers")
    .select("name, phone")
    .eq("id", project.customer_id)
    .maybeSingle();

  const { data: payments } = await supabase
    .from("studio_payment_methods")
    .select("bank_name, account_number, account_holder, label")
    .eq("is_active", true)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true });

  const { data: latestInvoice } = await supabase
    .from("project_invoices")
    .select("id, invoice_number, due_date, gross_contract_value")
    .eq("project_id", projectId)
    .order("issue_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Outstanding balance comes from the RPC so it agrees with the portal.
  let amountDue = Number(latestInvoice?.gross_contract_value ?? 0);
  if (latestInvoice?.invoice_number) {
    const { data: dto } = await service.rpc("get_client_invoice_dto", {
      p_invoice_number: latestInvoice.invoice_number,
    });
    const balance = Number((dto as { balance_due?: number } | null)?.balance_due ?? NaN);
    if (Number.isFinite(balance) && balance >= 0) amountDue = balance;
  }

  const galleryUrl = project.gallery_url
    ?? (project.gallery_code ? `${site.url}/g/${project.gallery_code}` : null);

  const reminderProject: ReminderProject = {
    name: project.name,
    client_name: customer?.name ?? null,
    client_phone: customer?.phone ?? null,
    shoot_date: project.shoot_date ?? null,
    call_time: project.call_time ?? null,
    venue_name: project.venue_name ?? null,
    venue_address: project.venue_address ?? null,
    venue_maps_url: project.venue_maps_url ?? null,
    gallery_url: galleryUrl,
    selection_deadline: project.selection_deadline ?? null,
    crew_contacts: null,
  };

  return {
    supabase,
    project,
    customer: customer ?? null,
    reminderProject,
    paymentMethods: (payments ?? []).map<PaymentMethod>((p) => ({
      bank_name: p.bank_name,
      account_number: p.account_number,
      account_holder: p.account_holder,
      label: p.label,
    })),
    invoice: latestInvoice
      ? {
          invoice_number: latestInvoice.invoice_number,
          amount_due: amountDue,
          due_date: latestInvoice.due_date ?? null,
        }
      : null,
  };
}

export async function getProjectActionContext(projectId: string): Promise<ProjectActionContext | null> {
  if (!uuidSchema.safeParse(projectId).success) return null;
  const ctx = await loadReminderContext(projectId);
  if (!ctx) return null;

  const { data: invoices } = await ctx.supabase
    .from("project_invoices")
    .select("id, invoice_number")
    .eq("project_id", projectId)
    .order("issue_date", { ascending: false });

  const secret = pdfSecret();
  const pdfLinks = (invoices ?? []).map((inv) => ({
    id: inv.id as string,
    invoiceNumber: inv.invoice_number as string,
    pdfUrl: secret
      ? `/api/invoices/${inv.id}/pdf?token=${encodeURIComponent(signInvoicePdfToken(inv.id as string, secret))}`
      : null,
  }));

  return {
    projectId,
    projectName: ctx.project.name,
    clientName: ctx.customer?.name ?? null,
    clientPhoneDisplay: ctx.customer?.phone ? formatPhoneForDisplay(ctx.customer.phone) : null,
    suggested: suggestedFor(ctx.reminderProject),
    available: REMINDER_KINDS.map((kind) => ({ kind, label: REMINDER_LABELS[kind] })),
    invoices: pdfLinks,
  };
}

function suggestedFor(project: ReminderProject): ReminderKind[] {
  const suggested: ReminderKind[] = [];
  if (project.shoot_date) {
    const days = Math.round(
      (Date.parse(`${project.shoot_date}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / 86_400_000
    );
    if (days === 7) suggested.push("T_MINUS_7_PREP");
    if (days === 1) suggested.push("T_MINUS_1_CALLSHEET");
    if (days === 0) suggested.push("SHOOT_DAY_ONSITE");
  }
  if (project.gallery_url) {
    suggested.push("GALLERY_READY");
    if (project.selection_deadline) suggested.push("SELECTION_REMINDER");
  }
  return suggested;
}

/**
 * Preview one reminder. Pure read: composing never writes and never dispatches.
 * Logging only happens after the operator confirms and actually opens WhatsApp.
 */
export async function previewReminder(
  projectId: string,
  kind: ReminderKind
): Promise<{ ok: true; preview: ReminderPreview } | { ok: false; error: string }> {
  if (!uuidSchema.safeParse(projectId).success) return { ok: false, error: "ID proyek tidak valid." };
  if (!REMINDER_KINDS.includes(kind)) return { ok: false, error: "Jenis pengingat tidak dikenal." };

  const ctx = await loadReminderContext(projectId);
  if (!ctx) return { ok: false, error: "Proyek tidak ditemukan." };

  const composed = composeReminder(kind, {
    project: ctx.reminderProject,
    invoice: ctx.invoice,
    paymentMethods: ctx.paymentMethods,
    studioName: site.name,
  });

  return {
    ok: true,
    preview: {
      kind,
      message: composed.message,
      waUrl: composed.waUrl,
      targetPhone: composed.targetPhone,
      missing: composed.missing,
    },
  };
}

/**
 * Record that the operator dispatched a reminder, after WhatsApp has been
 * opened. Issued by the operator's own session, so RLS (rank >= 80) applies on
 * top of the explicit `requireOps` gate.
 */
export async function logReminderDispatch(
  projectId: string,
  kind: ReminderKind,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  if (!uuidSchema.safeParse(projectId).success) return { ok: false, error: "ID proyek tidak valid." };
  if (!REMINDER_KINDS.includes(kind)) return { ok: false, error: "Jenis pengingat tidak dikenal." };
  // The body snapshot is audit evidence; an empty one proves nothing was sent.
  if (!message.trim()) return { ok: false, error: "Pesan kosong tidak dapat dicatat." };

  const { supabase, user } = await requireOps();

  // The number recorded must be the one actually messaged, so it is taken from
  // the same project record the preview used. A dispatch without a usable
  // phone cannot have happened, so refuse to write an audit row for it.
  const ctx = await loadReminderContext(projectId);
  if (!ctx) return { ok: false, error: "Proyek tidak ditemukan." };
  const parsed = normalisePhone(ctx.reminderProject.client_phone);
  if (!parsed.ok) return { ok: false, error: "Nomor WhatsApp klien tidak valid." };

  const { error } = await supabase.from("client_reminders_log").insert({
    project_id: projectId,
    reminder_kind: kind,
    target_phone: parsed.phone.e164,
    body_snapshot: message.slice(0, 4000),
    dispatched_by: user.id,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/projects/${projectId}`);
  return { ok: true };
}
