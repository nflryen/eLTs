"use server";

/*
 * Studio-side consultation lead actions.
 *
 * WHY THE WHATSAPP LINK IS NOT BUILT HERE
 * ---------------------------------------
 * A `"use server"` module may export only async functions, so the link builder
 * and phone normaliser live in `src/lib/leads/whatsapp.ts`. The admin view calls
 * them directly when rendering the "Chat on WhatsApp" button, which also means
 * the link is correct on first paint rather than after a round trip.
 *
 * GUARDS
 * ------
 * Every action calls `requireOps()` (rank >= 80), matching the RLS write policy
 * from 0027 (`private.has_role_rank(60)` for read, and staff-only writes). The
 * actions are the authority; RLS is the second line, not the first.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOps } from "@/lib/auth/roles";
import type { InquiryAddon, InquiryRow, InquiryStatus, PhotographyType } from "@/types/database";
import { sumAddons } from "@/lib/leads/pricing";
import {
  generateGalleryCode,
  generateAccessToken,
  hashGalleryPin,
} from "@/lib/security/tokens";
import { getPinPepper } from "@/lib/env";

export type LeadRow = InquiryRow & {
  /** Resolved package name, joined for display. Null when none was chosen. */
  package_name: string | null;
  package_price_idr: number | null;
  /**
   * package price + Σ(add-on price). Computed from the SERVER-RESOLVED values
   * stored at submission time, never from anything the browser sent.
   */
  estimate_total_idr: number | null;
};

/**
 * Jakarta-local calendar date (YYYY-MM-DD) for invoice columns.
 *
 * `project_invoices.issue_date`/`due_date` are DATE, not timestamptz — sending
 * a UTC timestamp shifts every evening issue back a day.
 */
function jakartaDateString(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** YYYY-MM period key for `next_document_number`. */
function jakartaPeriodKey(d = new Date()): string {
  return jakartaDateString(d).slice(0, 7);
}

export type LeadResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const statusSchema = z.enum([
  "NEW",
  "CONTACTED",
  "SCHEDULED",
  "CONVERTED",
  "LOST",
  "QUOTED",
  "ARCHIVED",
]);

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * Every lead, newest first, with its package resolved.
 *
 * The join is a second query rather than a PostgREST embed because
 * `inquiries.selected_package_id` is a nullable FK: an embed would emit a
 * `pricelist_packages: null` object per row that the UI then has to defensively
 * unwrap. A map lookup is simpler and one round trip cheaper at this size.
 */
export async function listLeads(): Promise<LeadRow[]> {
  const { supabase } = await requireOps();

  const { data: leads, error } = await supabase
    .from("inquiries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    /*
     * Throwing, not returning []: an empty list renders as "no leads yet" and
     * would hide a broken query behind a plausible-looking empty state.
     */
    throw new Error(`Gagal memuat lead: ${error.message}`);
  }

  const packageIds = Array.from(
    new Set(
      (leads ?? [])
        .map((l) => l.selected_package_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const packages = new Map<string, { name: string; price: number }>();
  if (packageIds.length > 0) {
    const { data: rows } = await supabase
      .from("pricelist_packages")
      .select("id, name, price_idr")
      .in("id", packageIds);

    for (const p of rows ?? []) {
      packages.set(p.id, { name: p.name, price: p.price_idr });
    }
  }

  return (leads ?? []).map((lead) => {
    const pkg = lead.selected_package_id ? packages.get(lead.selected_package_id) : null;
    const addons = Array.isArray(lead.selected_addons)
      ? (lead.selected_addons as InquiryAddon[])
      : [];
    const addonsTotal = sumAddons(addons);
    const pkgPrice = pkg?.price ?? null;
    const rawSubtotal = (pkgPrice ?? 0) + addonsTotal;
    const discount = Number(lead.referral_discount_amount) || 0;
    const finalEstimate = Math.max(0, rawSubtotal - discount);

    return {
      ...lead,
      selected_addons: addons,
      package_name: pkg?.name ?? null,
      package_price_idr: pkgPrice,
      estimate_total_idr:
        pkgPrice === null && addonsTotal === 0 ? null : finalEstimate,
    };
  });
}

/** Counts per status, for the filter chips. */
export async function getLeadCounts(): Promise<Record<string, number>> {
  const { supabase } = await requireOps();

  const { data } = await supabase.from("inquiries").select("status");

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function updateLeadStatus(
  id: string,
  status: InquiryStatus,
): Promise<LeadResult<InquiryRow>> {
  const parsed = statusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, error: "Status tidak dikenal." };

  const { supabase } = await requireOps();

  const patch: Partial<InquiryRow> = { status: parsed.data };

  /*
   * Stamp the first time a lead is actually contacted. A backdated value is
   * never overwritten, so "time to first contact" stays measurable even if an
   * operator later flips the status back and forth.
   */
  if (parsed.data !== "NEW") {
    const { data: current } = await supabase
      .from("inquiries")
      .select("contacted_at")
      .eq("id", id)
      .maybeSingle();
    if (current && !current.contacted_at && parsed.data !== "LOST") {
      patch.contacted_at = new Date().toISOString();
    }
  }

  const { data, error } = await supabase
    .from("inquiries")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error: `Gagal memperbarui status: ${error.message}` };
  if (!data) return { ok: false, error: "Lead tidak ditemukan." };

  revalidatePath("/admin/leads");
  return { ok: true, data };
}

export async function updateLeadNotes(
  id: string,
  notes: string,
): Promise<LeadResult> {
  const { supabase } = await requireOps();

  const { error } = await supabase
    .from("inquiries")
    .update({ notes: notes.trim() || null })
    .eq("id", id);

  if (error) return { ok: false, error: `Gagal menyimpan catatan: ${error.message}` };

  revalidatePath("/admin/leads");
  return { ok: true };
}

/**
 * Convert a lead into a customer + draft project.
 *
 * WHY A CUSTOMER IS CREATED FIRST
 * -------------------------------
 * `projects.customer_id` is a non-null FK, so a project cannot exist without a
 * customer. Reusing an existing customer by phone number would be wrong here:
 * the same person can legitimately book twice for different events, and merging
 * them silently would attach a new project to an old invoice history.
 *
 * The operation is idempotent against double-clicks: if the lead already has a
 * `converted_project_id`, that project is returned instead of creating a second
 * one.
 */
export async function convertLeadToBooking(
  id: string,
): Promise<LeadResult<{ projectId: string; customerId: string; invoiceId: string | null }>> {
  const { supabase } = await requireOps();

  const { data: lead, error: leadError } = await supabase
    .from("inquiries")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (leadError) return { ok: false, error: `Gagal memuat lead: ${leadError.message}` };
  if (!lead) return { ok: false, error: "Lead tidak ditemukan." };

  if (lead.converted_project_id) {
    return {
      ok: true,
      data: {
        projectId: lead.converted_project_id,
        customerId: lead.converted_customer_id ?? "",
        invoiceId: null,
      },
    };
  }

  // ── 1. Customer ───────────────────────────────────────────────────────────
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert({
      name: lead.brand_name?.trim() || lead.name.trim(),
      email: lead.email,
      phone: lead.phone,
    })
    .select("id")
    .single();

  if (customerError || !customer) {
    return { ok: false, error: `Gagal membuat klien: ${customerError?.message ?? "tidak diketahui"}` };
  }

  // ── 2. Draft project ──────────────────────────────────────────────────────
  /*
   * `projects.service_pillar` has a CHECK constraint with exactly three values
   * (BROADCAST_LIVE_STREAMING, COMMERCIAL_VIDEO, EVENT_GRADUATION_PHOTO) — the
   * lead's free-text `pillar` from a public form must be mapped onto them, not
   * passed through. Passing it verbatim fails the insert with a 23514 and the
   * operator sees "Gagal membuat proyek".
   */
  const PILLARS = [
    "BROADCAST_LIVE_STREAMING",
    "COMMERCIAL_VIDEO",
    "EVENT_GRADUATION_PHOTO",
  ] as const;
  type Pillar = (typeof PILLARS)[number];

  function resolvePillar(raw: string | null): Pillar {
    if (raw && (PILLARS as readonly string[]).includes(raw)) return raw as Pillar;
    const v = (raw ?? "").toUpperCase();
    if (/BROADCAST|LIVE|STREAM|TECH/.test(v)) return "BROADCAST_LIVE_STREAMING";
    if (/VIDEO|COMMERCIAL/.test(v)) return "COMMERCIAL_VIDEO";
    return "EVENT_GRADUATION_PHOTO";
  }

  /*
   * `projects.photography_type` is a narrow enum, but a lead's `event_type` is
   * free text from a public form ("other", "wisuda", anything). Map known
   * values and fall back to "event" — casting would let an unrecognised string
   * reach the CHECK constraint and fail the whole conversion.
   */
  const PHOTOGRAPHY_TYPES: PhotographyType[] = [
    "wedding",
    "prewedding",
    "graduation",
    "couple",
    "event",
  ];
  const photographyType: PhotographyType = PHOTOGRAPHY_TYPES.includes(
    lead.event_type as PhotographyType,
  )
    ? (lead.event_type as PhotographyType)
    : "event";
  const projectName = `${lead.event_type ? lead.event_type : "Sesi"} — ${lead.name.trim()}`;
  const slugBase = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const slug = `${slugBase || "proyek"}-${Date.now().toString(36).slice(-4)}`;

  /*
   * A project cannot exist without gallery credentials (NOT NULL columns), so
   * reuse the same token helpers the project wizard uses. A random PIN is
   * generated because the operator hands it to the client later; the client is
   * never shown it during conversion.
   */
  const pepper = getPinPepper();
  const defaultPin = Math.floor(100000 + Math.random() * 900000).toString();
  const gallery_code = generateGalleryCode();
  const access_token = generateAccessToken();
  const gallery_pin_hash = await hashGalleryPin(defaultPin, pepper);

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      customer_id: customer.id,
      name: projectName,
      slug,
      service_pillar: resolvePillar(lead.pillar),
      photography_type: photographyType,
      gallery_code,
      access_token,
      gallery_pin_hash,
      status: "draft",
    })
    .select("id")
    .single();

  if (projectError || !project) {
    /*
     * Roll the customer back rather than leaving an orphan. The project is the
     * thing the operator wanted; a customer with no project is invisible in the
     * UI and would confuse the next conversion attempt for this lead.
     */
    await supabase.from("customers").delete().eq("id", customer.id);
    return { ok: false, error: `Gagal membuat proyek: ${projectError?.message ?? "tidak diketahui"}` };
  }

  // ── 3. Invoice with inherited, server-resolved line items ─────────────────
  /*
   * The line items are built from `inquiries.selected_addons`, which was priced
   * by `resolveLeadPricing` at submission time. Nothing here re-enters a price
   * by hand, and nothing reads a client-supplied amount — so the invoice the
   * studio issues matches the quote the client saw.
   *
   * The invoice is created as a DRAFT-grade record with no due date until the
   * operator sets one; `due_date` is NOT NULL, so we issue it at +14 days, the
   * studio's standard term. The operator can adjust before sending.
   */
  const lineItems: { description: string; quantity: number; unit_price: number; subtotal: number }[] = [];

  if (lead.selected_package_id) {
    const { data: pkg } = await supabase
      .from("pricelist_packages")
      .select("name, price_idr")
      .eq("id", lead.selected_package_id)
      .maybeSingle();

    if (pkg) {
      const price = Number(pkg.price_idr) || 0;
      lineItems.push({
        description: pkg.name,
        quantity: 1,
        unit_price: price,
        subtotal: price,
      });
    }
  }

  for (const addon of Array.isArray(lead.selected_addons) ? lead.selected_addons : []) {
    const price = Number(addon.price_idr) || 0;
    lineItems.push({
      description: addon.name,
      quantity: 1,
      unit_price: price,
      subtotal: price,
    });
  }
  if (lead.referral_code && Number(lead.referral_discount_amount) > 0) {
    const discount = Math.round(Number(lead.referral_discount_amount));
    lineItems.push({
      description: `Diskon Referral (${lead.referral_code})`,
      quantity: 1,
      unit_price: -discount,
      subtotal: -discount,
    });
  }

  const grossContractValue = Math.max(0, lineItems.reduce((acc, item) => acc + item.subtotal, 0));

  let invoiceId: string | null = null;
  if (lineItems.length > 0) {
    const { data: invNum } = await supabase.rpc("next_document_number", {
      p_doc_type: "INV",
      p_period_key: jakartaPeriodKey(),
    });

    if (invNum) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 14);

      const { data: invoice, error: invoiceError } = await supabase
        .from("project_invoices")
        .insert({
          project_id: project.id,
          invoice_number: invNum as string,
          issue_date: jakartaDateString(),
          due_date: jakartaDateString(dueDate),
          line_items: lineItems,
          gross_contract_value: grossContractValue,
          minimum_dp_pct: 30,
          client_notes: lead.notes,
          referral_code_id: lead.referral_code_id ?? null,
          referral_code: lead.referral_code ?? null,
          referral_discount_amount: Number(lead.referral_discount_amount) || 0,
        })
        .select("id")
        .single();

      if (invoiceError) {
        /*
         * A missing invoice must not lose the project: the operator can issue
         * one from /admin/invoices. Surface the reason instead of failing the
         * whole conversion and orphaning a valid customer.
         */
        console.error("lead_convert_invoice_failed", { code: invoiceError.code });
      } else {
        invoiceId = invoice?.id ?? null;
      }
    }
  }

  // ── 4. Link back ──────────────────────────────────────────────────────────
  const { error: linkError } = await supabase
    .from("inquiries")
    .update({
      status: "CONVERTED",
      converted_customer_id: customer.id,
      converted_project_id: project.id,
    })
    .eq("id", id);

  if (linkError) {
    return {
      ok: false,
      error: `Proyek dibuat tetapi lead gagal ditandai: ${linkError.message}`,
    };
  }

  revalidatePath("/admin/leads");
  revalidatePath("/admin/projects");
  return {
    ok: true,
    data: { projectId: project.id, customerId: customer.id, invoiceId },
  };
}

export async function deleteLead(id: string): Promise<LeadResult> {
  const { supabase } = await requireOps();

  const { error } = await supabase.from("inquiries").delete().eq("id", id);
  if (error) return { ok: false, error: `Gagal menghapus lead: ${error.message}` };

  revalidatePath("/admin/leads");
  return { ok: true };
}
