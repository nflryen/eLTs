"use server";

import { requireOps } from "@/lib/auth/roles";
import type {
  AttentionAction,
  AttentionItem,
  AttentionQueue,
  AttentionSeverity,
} from "@/types/attention";
import { sectorToPillar } from "@/lib/sector-lens";
import { readSectorLens } from "@/lib/sector-lens.server";

/**
 * THE ATTENTION ENGINE — "Hari Ini"
 *
 * Replaces the owner's manual morning audit. Today that audit means opening and
 * mentally cross-referencing seven places (calendar, six project tabs, invoices,
 * editor queue, inquiries) before any real work can start — about 15 minutes a
 * day, and the cross-references are the part that gets missed.
 *
 * This action computes the whole picture in one pass and returns a ranked work
 * queue. Every item carries the action that RESOLVES it, not just a link that
 * describes it.
 *
 * Ranking rule: by consequence, then by staleness.
 *   critical — a shoot today/next 24h with unresolved blockers
 *   high     — money at risk, client waiting, gear conflict already live
 *   medium   — accumulating risk (unscheduled shoot, stale lead, pack not checked)
 */

const HOUR = 1000 * 60 * 60;
const DAY = HOUR * 24;

/** Humanise an elapsed duration in Indonesian. */
function humanAge(ms: number): string {
  const hours = Math.floor(ms / HOUR);
  if (hours < 1) return "baru saja";
  if (hours < 24) return `${hours} jam`;
  const days = Math.floor(hours / 24);
  return `${days} hari`;
}

function waLink(phone: string | null, text: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const normalised = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return `https://wa.me/${normalised}?text=${encodeURIComponent(text)}`;
}

export async function getAttentionQueue(): Promise<AttentionQueue> {
  /*
   * User-scoped client (audit finding B3). This read previously bypassed RLS
   * via service_role, so a WORKER's attention queue was assembled from rows
   * RLS would have denied them — expenses, pending splits and invoice totals.
   * The caller's JWT now applies the same policy as every other read.
   */
  const { supabase } = await requireOps();
  const lens = await readSectorLens();
  const pillar = sectorToPillar(lens);

  const now = Date.now();
  const in7d = new Date(now + 7 * DAY).toISOString();
  const items: AttentionItem[] = [];

  // ── Fetch the working set in parallel ────────────────────────────────────
  let projectQuery = supabase
    .from("projects")
    .select("id, name, status, shoot_date, service_pillar, contract_value, selection_locked_at, selection_quota_max, is_fully_paid, is_dp_paid, created_at")
    .in("status", ["draft", "editing", "ready"])
    .not("shoot_date", "is", null);
  if (pillar) projectQuery = projectQuery.eq("service_pillar", pillar);

  const [
    { data: projects },
    { data: assignments },
    { data: expenses },
    { data: invoices },
    { data: leads },
    { data: editorTasks },
  ] = await Promise.all([
    projectQuery,
    /*
     * No `crew_members(...)` embed.
     *
     * Migration 0024 dropped phone/email/bank_* from crew_members, so the old
     * `crew_members(full_name, phone)` embed fails the whole query with 42703
     * once the columns are gone. Nothing in this engine ever read the embed —
     * the queue counts assignment rows and links to the project, it never names
     * or messages a crew member — so the join is removed rather than rewired to
     * `v_crew_identity`. A future crew-facing action should query the view.
     */
    supabase
      .from("project_crew_assignments")
      .select("id, project_id, role_title, acceptance_status, created_at, offer_expires_at")
      .in("acceptance_status", ["PENDING_OFFER", "DECLINED"]),
    supabase
      .from("project_expenses")
      .select("id, project_id, name, category, source_type, asset_id, pack_status, vendor_name, return_status, rental_duration_days")
      .eq("pack_status", "PENDING"),
    supabase
      .from("project_invoices")
      .select("id, invoice_number, project_id, gross_contract_value, due_date, is_cancelled"),
    supabase
      .from("inquiries")
      .select("id, name, brand_name, phone, pillar, budget_range, message, status, created_at")
      .eq("status", "NEW"),
    supabase
      .from("editor_tasks")
      .select("id, project_id, status, deliverable_count, created_at, projects(name)")
      .in("status", ["PENDING", "IN_PROGRESS", "REVIEW"]),
  ]);

  const projectIds = new Set((projects ?? []).map((p) => p.id));
  const projectName = new Map((projects ?? []).map((p) => [p.id, p.name as string]));

  // ── 1. SHOOTS WITHIN 24H THAT ARE NOT READY TO ROLL ──────────────────────
  for (const p of projects ?? []) {
    if (!p.shoot_date) continue;
    const shootMs = new Date(`${p.shoot_date}T00:00:00+07:00`).getTime();
    const hoursAway = (shootMs - now) / HOUR;
    if (hoursAway > 26 || hoursAway < -36) continue;

    const findings: string[] = [];
    const actions: AttentionAction[] = [];

    const pending = (assignments ?? []).filter(
      (a) => a.project_id === p.id && a.acceptance_status === "PENDING_OFFER",
    );
    const declined = (assignments ?? []).filter(
      (a) => a.project_id === p.id && a.acceptance_status === "DECLINED",
    );
    if (pending.length > 0) findings.push(`${pending.length} kru belum konfirmasi`);
    if (declined.length > 0) findings.push(`${declined.length} kru MENOLAK — perlu pengganti`);

    const unpacked = (expenses ?? []).filter(
      (e) => e.project_id === p.id && e.asset_id !== null && e.pack_status === "PENDING",
    );
    if (unpacked.length > 0) findings.push(`${unpacked.length} alat belum dicek packing`);

    if (findings.length === 0) continue;

    if (pending.length > 0 || declined.length > 0) {
      actions.push({
        label: "Atur Kru",
        href: `/admin/projects/${p.id}?module=crew`,
        kind: "primary",
      });
    }
    if (unpacked.length > 0) {
      actions.push({
        label: "Cek Packing",
        href: `/admin/projects/${p.id}?module=gear`,
        kind: "secondary",
      });
    }

    const isToday = hoursAway < 12 && hoursAway > -36;
    items.push({
      id: `shoot-ready-${p.id}`,
      severity: "critical",
      category: isToday ? "HARI INI" : "BESOK",
      title: p.name as string,
      detail: isToday ? "Produksi berjalan hari ini" : "Produksi berjalan besok",
      ageLabel: hoursAway > 0 ? `${Math.round(hoursAway)} jam lagi` : "sedang berjalan",
      ageHours: 1000 + Math.max(0, -hoursAway),
      findings,
      actions,
    });
  }

  // ── 2. CLIENT DELIVERIES OVERDUE (photo selection locked, not delivered) ──
  const locked = (projects ?? []).filter((p) => p.selection_locked_at);
  for (const p of locked) {
    const task = (editorTasks ?? []).find((t) => t.project_id === p.id);
    if (!task) continue;
    const lockedMs = new Date(p.selection_locked_at as string).getTime();
    const waiting = now - lockedMs;
    if (waiting < 5 * DAY) continue;

    items.push({
      id: `delivery-overdue-${p.id}`,
      severity: waiting > 10 * DAY ? "high" : "medium",
      category: "TERTUNDA DIKIRIM",
      title: p.name as string,
      detail: `${task.deliverable_count} foto dipilih klien, belum dikirim`,
      ageLabel: humanAge(waiting),
      ageHours: waiting / HOUR,
      findings: [`Status editor: ${String(task.status).replace(/_/g, " ").toLowerCase()}`],
      actions: [
        { label: "Buka Post-Produksi", href: "/admin/editor-queue", kind: "primary" },
      ],
    });
  }

  // ── 3. OVERDUE INVOICES ───────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  for (const inv of invoices ?? []) {
    if (inv.is_cancelled || !projectIds.has(inv.project_id)) continue;
    if (inv.due_date >= today) continue;
    const overdueMs = now - new Date(`${inv.due_date}T00:00:00+07:00`).getTime();

    items.push({
      id: `invoice-overdue-${inv.id}`,
      severity: overdueMs > 7 * DAY ? "high" : "medium",
      category: "INVOICE JATUH TEMPO",
      title: projectName.get(inv.project_id) ?? inv.invoice_number,
      detail: `Rp ${Number(inv.gross_contract_value).toLocaleString("id-ID")} · ${inv.invoice_number}`,
      ageLabel: humanAge(overdueMs),
      ageHours: overdueMs / HOUR,
      findings: [`Jatuh tempo ${inv.due_date}`],
      actions: [
        {
          label: "Ingatkan via WA",
          href: waLink(
            null,
            `Halo, kami ingin mengingatkan invoice ${inv.invoice_number} untuk proyek ${projectName.get(inv.project_id) ?? ""} yang telah jatuh tempo pada ${inv.due_date}. Terima kasih.`,
          ),
          kind: "whatsapp",
        },
        { label: "Buka Proyek", href: `/admin/projects/${inv.project_id}`, kind: "secondary" },
      ],
    });
  }

  // ── 4. UNANSWERED LEADS ──────────────────────────────────────────────────
  for (const lead of leads ?? []) {
    const createdMs = new Date(lead.created_at as string).getTime();
    const waiting = now - createdMs;
    if (waiting < 4 * HOUR) continue;

    items.push({
      id: `lead-${lead.id}`,
      severity: waiting > 24 * HOUR ? "high" : "medium",
      category: "LEAD BELUM DIBALAS",
      title: lead.brand_name || lead.name,
      detail: `${lead.pillar ?? "Layanan"}${lead.budget_range ? ` · ${lead.budget_range}` : ""}`,
      ageLabel: humanAge(waiting),
      ageHours: waiting / HOUR,
      findings: [String(lead.message).slice(0, 110) + (String(lead.message).length > 110 ? "…" : "")],
      actions: [
        {
          label: "Balas WA",
          href: waLink(
            lead.phone,
            `Halo ${lead.name}, terima kasih sudah menghubungi ELTS Studio. Kami ingin membahas kebutuhan ${lead.pillar ?? "produksi"} Anda.`,
          ),
          kind: "whatsapp",
        },
      ],
    });
  }

  // ── 5. GEAR CONFLICT: same asset committed to two near-date shoots ────────
  const assetUsage = new Map<string, Array<{ projectId: string; name: string; date: string }>>();
  const dateByProject = new Map((projects ?? []).map((p) => [p.id, p.shoot_date as string]));
  for (const e of expenses ?? []) {
    if (!e.asset_id) continue;
    const date = dateByProject.get(e.project_id);
    if (!date) continue;
    const list = assetUsage.get(e.asset_id) ?? [];
    list.push({ projectId: e.project_id, name: e.name, date });
    assetUsage.set(e.asset_id, list);
  }
  for (const [assetId, uses] of assetUsage) {
    const uniqueDates = [...new Set(uses.map((u) => u.date))].sort();
    if (uniqueDates.length < 2) continue;
    // A 1-day buffer either side: two shoots within 48h contend for the same kit.
    const clashing = uniqueDates.some((d, i) => {
      const next = uniqueDates[i + 1];
      if (!next) return false;
      return new Date(next).getTime() - new Date(d).getTime() <= 2 * DAY;
    });
    if (!clashing) continue;
    const conflict = uses[uses.length - 1];
    const project = (projects ?? []).find((p) => p.id === conflict.projectId);
    if (!project) continue;

    items.push({
      id: `gear-conflict-${assetId}-${conflict.projectId}`,
      severity: "high",
      category: "BENTROK GEAR",
      title: conflict.name,
      detail: `Dipakai ${uses.length} proyek dalam rentang berdekatan`,
      ageLabel: `jadwal ${uniqueDates.join(" & ")}`,
      ageHours: 200,
      findings: [...new Set(uses.map((u) => projectName.get(u.projectId) ?? u.name))],
      actions: [
        {
          label: "Lihat Gear",
          href: `/admin/projects/${conflict.projectId}?module=gear`,
          kind: "primary",
        },
        { label: "Cari Pengganti", href: "/admin/inventory", kind: "secondary" },
      ],
    });
  }

  // ── 6. SHOOTS THIS WEEK WITH NO CREW DISPATCHED ──────────────────────────
  for (const p of projects ?? []) {
    if (!p.shoot_date) continue;
    const shootMs = new Date(`${p.shoot_date}T00:00:00+07:00`).getTime();
    if (shootMs < now || shootMs > new Date(in7d).getTime()) continue;
    const hasCrew = (assignments ?? []).some((a) => a.project_id === p.id);
    const dispatched = (assignments ?? []).filter((a) => a.project_id === p.id).length;
    if (hasCrew && dispatched > 0) continue;
    // Only flag when the project genuinely has nobody attached.
    const anyAssignment = (assignments ?? []).some((a) => a.project_id === p.id);
    if (anyAssignment) continue;

    items.push({
      id: `unscheduled-${p.id}`,
      severity: "medium",
      category: "BELUM DIJADWALKAN",
      title: p.name as string,
      detail: `Shoot ${p.shoot_date} · belum ada kru ditugaskan`,
      ageLabel: `${Math.round((shootMs - now) / DAY)} hari lagi`,
      ageHours: 100 + Math.max(0, 7 - (shootMs - now) / DAY),
      findings: ["Siapkan shoot day: dispatch kru + alokasi gear + checklist"],
      actions: [
        { label: "Siapkan Shoot", href: `/admin/projects/${p.id}?module=crew`, kind: "primary" },
      ],
    });
  }

  // ── 7. EQUIPMENT PACK NOT VERIFIED FOR UPCOMING SHOOTS ───────────────────
  for (const p of projects ?? []) {
    if (!p.shoot_date) continue;
    const shootMs = new Date(`${p.shoot_date}T00:00:00+07:00`).getTime();
    const daysAway = (shootMs - now) / DAY;
    if (daysAway < 0 || daysAway > 3) continue;
    const pendingPack = (expenses ?? []).filter(
      (e) => e.project_id === p.id && e.asset_id !== null && e.pack_status === "PENDING",
    );
    if (pendingPack.length === 0) continue;
    // Already surfaced as critical in (1) if within 26h — avoid duplicating.
    if (daysAway <= 1.1) continue;

    items.push({
      id: `pack-${p.id}`,
      severity: "medium",
      category: "PACKING BELUM DICEK",
      title: p.name as string,
      detail: `${pendingPack.length} alat belum diverifikasi`,
      ageLabel: `${Math.round(daysAway)} hari lagi`,
      ageHours: 90,
      findings: pendingPack.slice(0, 5).map((e) => e.name),
      actions: [
        { label: "Cek Packing", href: `/admin/projects/${p.id}?module=gear`, kind: "primary" },
      ],
    });
  }

  // ── Rank: severity first, then staleness ─────────────────────────────────
  const weight: Record<AttentionSeverity, number> = { critical: 3, high: 2, medium: 1 };
  items.sort((a, b) => {
    const bySeverity = weight[b.severity] - weight[a.severity];
    if (bySeverity !== 0) return bySeverity;
    return b.ageHours - a.ageHours;
  });

  return {
    items,
    generatedAt: new Date().toISOString(),
    summary: {
      critical: items.filter((i) => i.severity === "critical").length,
      high: items.filter((i) => i.severity === "high").length,
      medium: items.filter((i) => i.severity === "medium").length,
      total: items.length,
    },
  };
}
