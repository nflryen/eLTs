/**
 * Project lifecycle contracts.
 *
 * Kept out of the `"use server"` module because those files may export only
 * async functions — a const or a type there fails the whole route with
 * "A 'use server' file can only export async functions".
 *
 * Deliberately NOT `server-only`: the status dropdown and the table both import
 * the transition map on the client, and the map is public product knowledge
 * (it is enforced authoritatively by the database trigger, not hidden here).
 */

export type ProjectStatus = "draft" | "editing" | "ready" | "archived" | "expired";

/**
 * The legal edges, mirroring `private.enforce_project_status_transition()`:
 *
 *   draft    -> editing, ready, expired
 *   editing  -> draft, ready, expired
 *   ready    -> editing, archived, draft, expired
 *   archived -> ready
 *   expired  -> archived
 *
 * `expired` is time-driven, not an operator choice, so it is never offered in
 * the dropdown even though the database permits it.
 */
const LEGAL_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  draft: ["ready", "editing"],
  editing: ["draft", "ready"],
  ready: ["editing", "archived", "draft"],
  archived: ["ready"],
  expired: [],
};

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Draft",
  editing: "Editing",
  ready: "Ready",
  archived: "Archived",
  expired: "Expired",
};

/** Transitions offered to the operator for a given current status. */
export function legalNextStatuses(current: ProjectStatus): ProjectStatus[] {
  return [...(LEGAL_TRANSITIONS[current] ?? [])];
}

/** True when the edge exists in the state machine. */
export function isLegalTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export type StatusChangeResult =
  | { ok: true; from: ProjectStatus; to: ProjectStatus }
  | { ok: false; error: string; reason: "invalid" | "illegal" | "forbidden" | "db" };

export type CrewOption = {
  id: string;
  full_name: string;
  crew_code: string;
  member_type: string;
  phone: string | null;
  standard_day_rate: number;
  assignedToThisProject: boolean;
  busySameDay: boolean;
};
