"use server";

import { revalidatePath } from "next/cache";
import { requireOps } from "@/lib/auth/roles";
import {
  buildStreamA,
  buildStreamB,
  ManifestInvariantError,
} from "@/app/actions/gear-exports";
import { jakartaShortDate, jakartaTime } from "@/lib/datetime";
import { escapeHtml, idr } from "@/lib/format";

/**
 * Callable gear actions for the client console.
 *
 * WHY THIS FILE IS SEPARATE FROM gear-exports.ts
 * ----------------------------------------------
 * `gear-exports.ts` is a `server-only` DATA module (`buildStreamA`/`buildStreamB`)
 * — it must never be callable from the browser. This file is the thin
 * `"use server"` boundary the client component talks to.
 *
 * Mixing the two is what produced the earlier build error: a module marked
 * `server-only` cannot be imported by a client component, and a data module
 * without `"use server"` cannot expose callable functions to one.
 */

/** Toggles a packing line between PENDING and PACKED, with actor attribution. */
export async function setPackStatus(
  expenseId: string,
  projectId: string,
  next: "PENDING" | "PACKED",
): Promise<{ success: boolean; error?: string }> {
  const { admin, supabase } = await requireOps();

  const { data: row } = await supabase
    .from("project_expenses")
    .select("id, project_id, asset_id, category")
    .eq("id", expenseId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!row) return { success: false, error: "Item tidak ditemukan pada proyek ini." };
  // Only physical, asset-linked rows have a packing state.
  if (!row.asset_id) {
    return { success: false, error: "Hanya aset fisik yang memiliki status packing." };
  }

  const { error } = await supabase
    .from("project_expenses")
    .update({
      pack_status: next,
      pack_checked_at: next === "PACKED" ? new Date().toISOString() : null,
      pack_checked_by: next === "PACKED" ? admin.user_id : null,
    })
    .eq("id", expenseId)
    .eq("project_id", projectId);

  if (error) return { success: false, error: error.message };
  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}

/** Builds the vendor booking WhatsApp copy for Stream B. */
export async function buildVendorBookingMessage(
  projectId: string,
  vendorName?: string,
): Promise<{ success: boolean; text?: string; phone?: string; error?: string }> {
  await requireOps();

  let data;
  try {
    data = await buildStreamB(projectId);
  } catch (err) {
    if (err instanceof ManifestInvariantError) return { success: false, error: err.message };
    return { success: false, error: "Gagal memuat data vendor." };
  }

  const target = vendorName ? data.vendors.find((v) => v.vendorName === vendorName) : data.vendors[0];
  if (!target) return { success: false, error: "Tidak ada item sewa vendor pada proyek ini." };

  const MAX = 25;
  const shown = target.lines.slice(0, MAX);
  const hidden = target.lines.length - shown.length;
  const total = target.subtotal + target.depositAmount;

  const lines = shown
    .map((l, i) => {
      const perDay = l.unitDays > 1 ? ` × ${l.unitDays} hari` : "";
      return `${i + 1}. ${escapeHtml(l.description)}\n   ${l.quantity} unit${perDay} × ${idr(l.unitRate)} = ${idr(l.lineTotal)}`;
    })
    .join("\n");

  const sla =
    target.pickupAt && target.returnDueAt
      ? `\n📅 *JADWAL PENGAMBILAN*\nAmbil    : ${jakartaShortDate(target.pickupAt)}, ${jakartaTime(target.pickupAt)} WIB\nKembali  : ${jakartaShortDate(target.returnDueAt)}, ${jakartaTime(target.returnDueAt)} WIB\n`
      : "";
  const deposit =
    target.depositAmount > 0
      ? `\n*DEPOSIT JAMINAN: ${idr(target.depositAmount)}*\n(dikembalikan saat alat kembali lengkap)`
      : "";

  const text =
    `🧾 *PURCHASE ORDER — SEWA ALAT*\n` +
    `*ELTS. Creative & Digital Studio*\n` +
    `No. PO: ${target.poNumber ?? "(draft)"}\n\n` +
    `Halo *${escapeHtml(target.vendorName)}*,\n` +
    `Kami ingin membooking alat berikut untuk produksi *${escapeHtml(data.project.name)}*:\n\n` +
    `📋 *DAFTAR SEWA*\n${lines}\n` +
    (hidden > 0 ? `… dan ${hidden} item lainnya (lihat PO terlampir)\n` : "") +
    `\n━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `*SUBTOTAL: ${idr(target.subtotal)}*${deposit}\n` +
    `*TOTAL: ${idr(total)}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n${sla}` +
    `\nMohon konfirmasi ketersediaan dan final rate. Terima kasih! 🙏`;

  return { success: true, text, phone: target.vendorPhone ?? undefined };
}

/** Builds the internal packing checklist WhatsApp copy for Stream A. */
export async function buildInternalPackingMessage(
  projectId: string,
): Promise<{ success: boolean; text?: string; error?: string }> {
  await requireOps();

  let data;
  try {
    data = await buildStreamA(projectId);
  } catch (err) {
    if (err instanceof ManifestInvariantError) return { success: false, error: err.message };
    return { success: false, error: "Gagal memuat manifest." };
  }

  const all = [...data.studioItems, ...data.partnerItems];
  if (all.length === 0) return { success: false, error: "Tidak ada aset fisik pada proyek ini." };

  const fmt = (i: (typeof all)[number]) => {
    const acc: string[] = [];
    if (i.accessories.batteries) acc.push(`baterai ×${i.accessories.batteries}`);
    for (const c of i.accessories.cards ?? []) acc.push(`card ${c.capacity_gb}GB ×${c.qty}`);
    if (i.accessories.charger) acc.push("charger");
    const detail = acc.length ? `\n   _${acc.join(" · ")}_` : "";
    const owner = i.sourceType === "PARTNER_OWNED" ? ` _(milik ${escapeHtml(i.ownerName)})_` : "";
    return `☐ ${escapeHtml(i.name)}${owner}${detail}`;
  };

  const studio = data.studioItems.map(fmt).join("\n");
  const partner = data.partnerItems.map(fmt).join("\n");

  const text =
    `📋 *MANIFEST MUAT — CEK PACKING*\n` +
    `*${escapeHtml(data.project.name)}*\n` +
    `📍 ${escapeHtml(data.project.venueName)}\n` +
    `📅 ${data.project.shootDate ? jakartaShortDate(`${data.project.shootDate}T00:00:00+07:00`) : "-"}\n\n` +
    `*KIT STUDIO (${data.studioItems.length})*\n${studio}\n` +
    (partner ? `\n*GEAR PARTNER (${data.partnerItems.length})*\n${partner}\n` : "") +
    `\n━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${data.totalItems} item · ${data.totalAccessories} aksesori\n` +
    `Hitung aksesori satu per satu sebelum berangkat.\n` +
    `Tanda tangan manifest dicetak untuk serah-terima.`;

  return { success: true, text };
}
