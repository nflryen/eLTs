import "server-only";

import type { Metric } from "@/lib/dashboard/metric";
import type { AttentionQueue } from "@/types/attention";
import { ROLE_RANK } from "@/lib/auth/roles";

/**
 * Dashboard telemetry contract.
 *
 * Kept OUT of `app/actions/admin-dashboard.ts` because a `"use server"` module
 * may export nothing but async functions — not constants, not types. Exporting
 * `FINANCE_VISIBILITY_RANK` from the action file fails the whole route with
 * "A 'use server' file can only export async functions, found number."
 */

/** Rank at which cash-position figures become visible. */
export const FINANCE_VISIBILITY_RANK = ROLE_RANK.FOUNDER;

export type ShootsTodayItem = {
  projectId: string;
  projectName: string;
  /** First call time today in Jakarta wall clock, "HH:MM"; null when unset. */
  callTime: string | null;
  venue: string | null;
  crewAssigned: number;
};

export type TimelineEntry = {
  id: string;
  kind: "shoot" | "handoff";
  /** "HH:MM" in Jakarta, or null when the time is not yet scheduled. */
  time: string | null;
  title: string;
  detail: string;
  href: string;
  /** True when this is the next entry that has not started yet. */
  next: boolean;
};

export type DashboardTelemetry = {
  displayName: string;
  rank: number;
  /** Whether cash-position tiles are visible to this caller. */
  canSeeFinance: boolean;

  monthlyRevenue: Metric<number>;
  unpaidReceivables: Metric<number>;
  /** Shown to ranks below FINANCE_VISIBILITY_RANK instead of cash figures. */
  activeContractValue: Metric<number>;

  activeProjects: Metric;
  shootsToday: Metric;
  nextCallTime: Metric<string>;
  crewOnDuty: Metric;
  pendingEditing: Metric;
  gearOut: Metric;
  gearInCustody: Metric;

  shootsTodayList: Metric<ShootsTodayItem[]>;
  timeline: Metric<TimelineEntry[]>;
  attention: AttentionQueue;
};
