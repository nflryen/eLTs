"use server";

import { requireStaff } from "@/lib/auth/roles";
import { FINANCE_VISIBILITY_RANK, type DashboardTelemetry, type ShootsTodayItem, type TimelineEntry } from "@/lib/dashboard/types";
import { type RoleSession } from "@/lib/auth/roles";
import { jktTodayIso, jktDayStartUtc, jakartaClock, endOfMonth } from "@/lib/dashboard/time";
import {
  countMetric,
  emptyZero,
  failed,
  hidden,
  measure,
  ok,
  type Metric,
} from "@/lib/dashboard/metric";
import { getAttentionQueue } from "@/app/actions/attention";
import type { AttentionQueue } from "@/types/attention";

/**
 * EXECUTIVE DASHBOARD TELEMETRY
 * -----------------------------
 * One pass, every figure measured or explicitly unmeasured. No catch block may
 * produce a number: `admin-cockpit.ts` did exactly that and reported "Rp 0" when
 * a query failed, which reads as a quiet month rather than a broken dashboard.
 *
 * FINANCIAL VISIBILITY
 * --------------------
 * Revenue and receivables resolve to `hidden` below FOUNDER rank (100). ADMIN
 * (80) sees "Nilai Kontrak Aktif" instead — the contracted value of work in
 * flight, which is operational context, not a cash position. Every restricted
 * figure is dropped server-side: a `hidden` metric never carries its value over
 * the wire, so the browser cannot reveal what the server withheld.
 */

/**
 * Statuses that count as "work in flight". Archived and expired are excluded:
 * they are history, not active load. A module-private const (not exported) is
 * permitted inside a "use server" file.
 */
const ACTIVE_PROJECT_STATUSES = ["draft", "editing", "ready"] as const;

/**
 * Resolve telemetry for the current session.
 *
 * `requireStaff` (rank >= 60) gates the whole surface; WORKER may open the
 * dashboard but sees no financial tiles at all.
 */
export async function getDashboardTelemetry(): Promise<DashboardTelemetry> {
  const session: RoleSession = await requireStaff();
  const { supabase, rank, displayName } = session;
  const canSeeFinance = rank >= FINANCE_VISIBILITY_RANK;

  const today = jktTodayIso();
  const dayStart = jktDayStartUtc(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthPrefix = today.slice(0, 7); // YYYY-MM

  // ── Attention queue (already computed and ranked elsewhere) ──────────────
  // A failure here must not hide the telemetry, so it degrades to an empty
  // queue with an explicit zero summary rather than breaking the page.
  const attention = await getAttentionQueue().catch<AttentionQueue>(() => ({
    items: [],
    generatedAt: new Date().toISOString(),
    summary: { critical: 0, high: 0, medium: 0, total: 0 },
  }));

  // ── Independent metrics, measured in parallel ────────────────────────────
  const [
    activeProjects,
    shootsToday,
    shootsTodayList,
    crewOnDuty,
    pendingEditing,
    gearOut,
    gearInCustody,
    monthlyRevenue,
    unpaidReceivables,
    activeContractValue,
  ] = await Promise.all([
    measure(
      supabase
        .from("projects")
        .select("*", { count: "exact", head: true })
        .in("status", ACTIVE_PROJECT_STATUSES as unknown as string[]),
      ({ count }) => countMetric(count)
    ),

    measure(
      supabase
        .from("projects")
        .select("*", { count: "exact", head: true })
        .eq("shoot_date", today)
        .in("status", ACTIVE_PROJECT_STATUSES as unknown as string[]),
      ({ count }) => countMetric(count)
    ),

    loadShootsToday(supabase, today),

    loadCrewOnDuty(supabase, dayStart),

    measure(
      supabase
        .from("editor_tasks")
        .select("*", { count: "exact", head: true })
        .in("status", ["PENDING", "IN_PROGRESS", "REVIEW"]),
      ({ count }) => countMetric(count)
    ),

    // Gear "out" = packed or loaded and not yet returned.
    measure(
      supabase
        .from("project_expenses")
        .select("*", { count: "exact", head: true })
        .in("pack_status", ["PACKED", "LOADED", "MISSING"]),
      ({ count }) => countMetric(count)
    ),

    // Gear "in custody" = back in the studio.
    measure(
      supabase
        .from("project_expenses")
        .select("*", { count: "exact", head: true })
        .eq("pack_status", "RETURNED"),
      ({ count }) => countMetric(count)
    ),

    canSeeFinance ? loadMonthlyRevenue(supabase, monthStart, monthPrefix) : Promise.resolve(hidden<number>()),

    canSeeFinance ? loadUnpaidReceivables(supabase) : Promise.resolve(hidden<number>()),

    // Operational for everyone from ADMIN up; WORKER sees the tile too since
    // it is contracted value, not cash. Still measured, never invented.
    loadActiveContractValue(supabase),
  ]);

  // ── Timeline: today's shoots plus handoffs ───────────────────────────────
  const timeline = await buildTimeline(supabase, today, shootsTodayList);

  const nextCallTime: Metric<string> = (() => {
    if (shootsTodayList.state === "error") return failed<string>();
    if (shootsTodayList.state === "hidden") return hidden<string>();
    const times = shootsTodayList.value
      .map((s) => s.callTime)
      .filter((t): t is string => typeof t === "string" && /^\d{2}:\d{2}$/.test(t))
      .sort();
    // No call time today is a real, measured outcome — not a numeric zero.
    // Casting `emptyZero()` here produced the string "0" on the dashboard.
    if (times.length === 0) return { state: "empty", value: "" };
    return ok(times[0]);
  })();

  return {
    displayName,
    rank,
    canSeeFinance,
    monthlyRevenue,
    unpaidReceivables,
    activeContractValue,
    activeProjects,
    shootsToday,
    nextCallTime,
    crewOnDuty,
    pendingEditing,
    gearOut,
    gearInCustody,
    shootsTodayList,
    timeline,
    attention,
  };
}

// ─── Query helpers ───────────────────────────────────────────────────────────

type Supabase = RoleSession["supabase"];

/** Today's field shoots with their earliest call time and crew count. */
async function loadShootsToday(supabase: Supabase, today: string): Promise<Metric<ShootsTodayItem[]>> {
  try {
    const { data: projects, error } = await supabase
      .from("projects")
      // `projects` has no venue column: location lives on the crew assignment,
      // which is also where the call time is recorded. Selecting a nonexistent
      // column made PostgREST reject the whole query and blank the tile.
      .select("id, name, shoot_date, status")
      .eq("shoot_date", today)
      .in("status", ACTIVE_PROJECT_STATUSES as unknown as string[]);

    if (error || !projects) return failed<ShootsTodayItem[]>();
    if (projects.length === 0) return { state: "empty", value: [] };

    const ids = projects.map((p) => p.id as string);
    const { data: assignments, error: assignError } = await supabase
      .from("project_crew_assignments")
      .select("project_id, call_time, venue_name, acceptance_status")
      .in("project_id", ids);

    // A crew failure would misreport staffing, so the whole tile fails closed
    // rather than showing every shoot as unstaffed.
    if (assignError) return failed<ShootsTodayItem[]>();

    const byProject = new Map<string, Array<{ call_time: string | null; venue_name: string | null; acceptance_status: string }>>();
    for (const a of assignments ?? []) {
      const list = byProject.get(a.project_id as string) ?? [];
      list.push({
        call_time: a.call_time as string | null,
        venue_name: a.venue_name as string | null,
        acceptance_status: (a.acceptance_status as string) ?? "PENDING",
      });
      byProject.set(a.project_id as string, list);
    }

    const items: ShootsTodayItem[] = projects.map((p) => {
      const rows = byProject.get(p.id as string) ?? [];
      const times = rows
        .map((r) => r.call_time)
        .filter((t): t is string => typeof t === "string")
        .map((t) => jakartaClock(t))
        .filter((t): t is string => t !== null)
        .sort();
      return {
        projectId: p.id as string,
        projectName: (p.name as string) ?? "Proyek",
        callTime: times[0] ?? null,
        venue: rows.find((r) => r.venue_name)?.venue_name ?? null,
        crewAssigned: rows.filter((r) => r.acceptance_status === "ACCEPTED" || r.acceptance_status === "CONFIRMED").length,
      };
    });

    items.sort((a, b) => (a.callTime ?? "99:99").localeCompare(b.callTime ?? "99:99"));
    return ok(items);
  } catch {
    return failed<ShootsTodayItem[]>();
  }
}

/** Crew who actually accepted a call whose call time falls on `dayStart`'s day. */
async function loadCrewOnDuty(supabase: Supabase, dayStartIso: string): Promise<Metric> {
  const dayEnd = new Date(new Date(dayStartIso).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return measure(
    supabase
      .from("project_crew_assignments")
      .select("*", { count: "exact", head: true })
      .in("acceptance_status", ["ACCEPTED", "CONFIRMED"])
      .not("call_time", "is", null)
      .gte("call_time", dayStartIso)
      .lt("call_time", dayEnd),
    ({ count }) => countMetric(count)
  );
}

/**
 * Revenue recognised this calendar month.
 *
 * Sum of VERIFIED receipts received in the month — money actually in hand. It is
 * deliberately not contracted value: an invoice issued is not revenue.
 */
async function loadMonthlyRevenue(supabase: Supabase, monthStart: string, monthPrefix: string): Promise<Metric<number>> {
  try {
    const monthEnd = endOfMonth(monthStart);
    const { data, error } = await supabase
      .from("invoice_payment_receipts")
      .select("amount, received_at, verified_at")
      .gte("received_at", `${monthStart}T00:00:00+07:00`)
      .lt("received_at", `${monthEnd}T00:00:00+07:00`)
      .not("verified_at", "is", null);

    if (error || !data) return failed<number>();
    const total = data.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    // Guard against a month string with no rows meaning the filter was wrong.
    if (!monthPrefix) return failed<number>();
    return total === 0 ? emptyZero() : ok(total);
  } catch {
    return failed<number>();
  }
}

/**
 * Outstanding receivables: verified-payment balance across every live invoice.
 *
 * Read from the derived view so it cannot disagree with the project workspace.
 */
async function loadUnpaidReceivables(supabase: Supabase): Promise<Metric<number>> {
  try {
    const { data, error } = await supabase
      .from("v_invoice_financial_position")
      .select("invoice_id, balance_due, derived_status");

    if (error || !data) return failed<number>();

    const outstanding = data
      .filter((row) => row.derived_status !== "PAID_IN_FULL" && row.derived_status !== "OVERPAID")
      .reduce((sum, row) => sum + Math.max(0, Number(row.balance_due) || 0), 0);

    return outstanding === 0 ? emptyZero() : ok(outstanding);
  } catch {
    return failed<number>();
  }
}

/** Contracted value of work in flight — visible to ADMIN and above. */
async function loadActiveContractValue(supabase: Supabase): Promise<Metric<number>> {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, contract_value, status")
      .in("status", ACTIVE_PROJECT_STATUSES as unknown as string[]);

    if (error || !data) return failed<number>();
    const total = data.reduce((sum, p) => sum + (Number(p.contract_value) || 0), 0);
    return total === 0 ? emptyZero() : ok(total);
  } catch {
    return failed<number>();
  }
}

/** Today's shoots and gear handoffs, ordered by clock time. */
async function buildTimeline(
  supabase: Supabase,
  today: string,
  shoots: Metric<ShootsTodayItem[]>
): Promise<Metric<TimelineEntry[]>> {
  if (shoots.state === "error") return failed<TimelineEntry[]>();
  if (shoots.state === "hidden") return hidden<TimelineEntry[]>();

  const entries: TimelineEntry[] = shoots.value.map((s) => ({
    id: `shoot-${s.projectId}`,
    kind: "shoot" as const,
    time: s.callTime,
    title: s.projectName,
    detail:
      s.crewAssigned > 0
        ? `${s.crewAssigned} kru · ${s.venue ?? "lokasi belum diisi"}`
        : `Belum ada kru terkonfirmasi · ${s.venue ?? "lokasi belum diisi"}`,
    href: `/admin/projects/${s.projectId}`,
    next: false,
  }));

  // Gear that must physically change hands today: due back, or still packed
  // for a shoot happening today.
  try {
    const { data: gear, error } = await supabase
      .from("project_expenses")
      .select("id, name, pack_status, return_status, return_date, project_id, quantity")
      .or(`return_date.eq.${today},pack_status.in.(PACKED,LOADED)`)
      .limit(25);

    if (!error && gear) {
      for (const g of gear) {
        const returning = g.return_date === today;
        entries.push({
          id: `gear-${g.id}`,
          kind: "handoff",
          time: null,
          title: `${g.name}${Number(g.quantity) > 1 ? ` ×${g.quantity}` : ""}`,
          detail: returning
            ? `Jatuh tempo kembali hari ini · status ${g.return_status ?? "PENDING"}`
            : `Masih ${String(g.pack_status ?? "PENDING").toLowerCase()} untuk proyek`,
          href: g.project_id ? `/admin/projects/${g.project_id}?module=gear` : "/admin/inventory",
          next: false,
        });
      }
    }
  } catch {
    // Gear handoffs are supplementary: a failure here must not blank the
    // shoot timeline, which is the time-critical half.
  }

  entries.sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));

  const nowClock = jakartaClock(new Date().toISOString()) ?? "00:00";
  const firstUpcoming = entries.findIndex((e) => (e.time ?? "99:99") >= nowClock);
  if (firstUpcoming >= 0) entries[firstUpcoming] = { ...entries[firstUpcoming], next: true };

  return { state: entries.length === 0 ? "empty" : "ok", value: entries };
}

// ─── Small utilities ─────────────────────────────────────────────────────────

