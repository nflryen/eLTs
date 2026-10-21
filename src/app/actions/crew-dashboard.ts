"use server";

/*
 * Crew self-service: the assignments of the person who is signed in.
 *
 * WHY THIS IS SEPARATE FROM `crew.ts`
 * ----------------------------------
 * `crew.ts` is the DISPATCH surface: an operator, gated at ADMIN, acting on any
 * crew member. This module is the opposite direction — a WORKER (rank 60)
 * looking at their own work. Two different guards, two different threat models,
 * so they do not share a file: nothing here may ever be reachable from an
 * operator-facing screen, and nothing here may accept a crew id from the client.
 *
 * ZERO-LEAKAGE CONTRACT
 * ---------------------
 * The caller's `crew_members` row is resolved from `auth.uid()` on every call.
 * No action takes a crew id, so there is nothing to tamper with. Ownership is
 * then enforced twice on every write:
 *
 *   1. the SELECT that loads the row filters `crew_member_id = <caller's crew>`;
 *   2. the UPDATE repeats that filter in its WHERE clause, together with the
 *      expected current status, making each write a compare-and-set.
 *
 * A row that belongs to somebody else is reported exactly like a row that does
 * not exist ("Penugasan tidak ditemukan"), so a forged UUID cannot be used to
 * probe for other people's assignments.
 *
 * `check_in_at` IS NOT COMPLETION
 * ------------------------------
 * `check_in_at` is written by `crew_check_in()` when the crew member ARRIVES at
 * the venue (migration 0008). Reusing it for "the shoot is finished" would make
 * a crew member who arrived but never wrapped look complete, and would destroy
 * the attendance record. Completion therefore gets its own column, added by
 * migration 0029.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, type RoleSession } from "@/lib/auth/roles";
import type {
  AssignmentAcceptanceStatus,
  CrewPaymentStatus,
  ProjectCrewAssignmentRow,
} from "@/types/operations";

const uuidSchema = z.string().uuid();

const BOARD_PATH = "/admin/my-assignments";

/**
 * `completed_at` exists in the database (migration 0029) but not yet in the
 * generated `Database` types. Declaring it here keeps the single cast at the
 * read boundary instead of spraying `any` through the mapping below.
 */
type AssignmentRecord = ProjectCrewAssignmentRow & { completed_at?: string | null };

/*
 * The visible state IS `AssignmentAcceptanceStatus` — the same four values, with
 * `EXPIRED` derived at read time instead of stored. A second identical union
 * would only create a conversion point to keep in step.
 */

/**
 * One row as the crew member sees it. Only fields something renders: the card
 * needs the call sheet, the fee, the payment badge and the offer deadline.
 * `accepted_at`, `declined_at` and `check_in_at` are deliberately absent — the
 * card shows the DECISION (`state`, `declined_reason`, `completed_at`) rather
 * than the audit timestamps behind it.
 */
export type MyAssignment = {
  id: string;
  role_title: string;
  call_time: string;
  roll_time: string | null;
  venue_name: string;
  venue_address: string;
  venue_maps_url: string | null;
  dress_code: string;
  technical_notes: string | null;
  allocated_equipment: string[];
  fee_agreed: number;
  payment_status: CrewPaymentStatus;
  raw_drop_url: string | null;
  /** Raw column value, except a lapsed PENDING_OFFER reads as EXPIRED (0008). */
  state: AssignmentAcceptanceStatus;
  /** When the crew member marked the shoot wrapped, if they have. */
  completed_at: string | null;
  declined_reason: string | null;
  offer_expires_at: string | null;
  project: {
    id: string;
    name: string;
    status: string;
    shoot_date: string | null;
  };
};

/**
 * Shared result shape. Operator-fixable failures (wrong state, missing reason)
 * are RETURNED so the card can show the message in place; authorization throws
 * inside `requireStaff`, because there is nothing to recover from.
 */
export type CrewResult = { ok: true } | { ok: false; error: string };

export type MyAssignmentBoard =
  | {
      ok: true;
      /**
       * `null` means this login has no `crew_members` row. A staff member who
       * is not crew is a legitimate state, not an error — the page renders an
       * honest empty state instead of a crash or a fabricated list.
       */
      crewMember: { id: string; crewCode: string; fullName: string } | null;
      assignments: MyAssignment[];
    }
  | { ok: false; error: string };

// ── Private helpers (not exported: a "use server" module may only export
//    async functions, and these are pure) ─────────────────────────────────────

type CrewIdentityResult =
  | { ok: true; crew: { id: string; crew_code: string; full_name: string } | null }
  | { ok: false; error: string };

/**
 * Resolves the caller's crew identity from the SESSION, never from a parameter.
 * Deliberately not filtered by `is_active`: a crew member deactivated after the
 * shoot still owns their assignment history.
 */
async function resolveCrewMember(session: RoleSession): Promise<CrewIdentityResult> {
  const { data, error } = await session.supabase
    .from("crew_members")
    .select("id, crew_code, full_name")
    .eq("auth_user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("crew_dashboard_identity_failed", { code: error.code });
    return { ok: false, error: "Gagal memuat profil kru Anda. Coba lagi." };
  }

  return { ok: true, crew: data ?? null };
}

/** Expiry is derived, matching `private.crew_offer_state()` in migration 0008. */
function effectiveState(row: AssignmentRecord, nowMs: number): AssignmentAcceptanceStatus {
  if (row.acceptance_status !== "PENDING_OFFER") return row.acceptance_status;
  if (row.offer_expires_at && new Date(row.offer_expires_at).getTime() <= nowMs) {
    return "EXPIRED";
  }
  return "PENDING_OFFER";
}

function toMyAssignment(
  row: AssignmentRecord,
  project: MyAssignment["project"],
  nowMs: number,
): MyAssignment {
  return {
    id: row.id,
    role_title: row.role_title,
    call_time: row.call_time,
    roll_time: row.roll_time,
    venue_name: row.venue_name,
    venue_address: row.venue_address,
    venue_maps_url: row.venue_maps_url,
    dress_code: row.dress_code,
    technical_notes: row.technical_notes,
    allocated_equipment: row.allocated_equipment ?? [],
    // PostgREST returns `numeric` as a number, but a null or a stringified
    // value must never reach a currency formatter as NaN.
    fee_agreed: Number(row.fee_agreed ?? 0),
    payment_status: row.payment_status,
    raw_drop_url: row.raw_drop_url,
    state: effectiveState(row, nowMs),
    completed_at: row.completed_at ?? null,
    declined_reason: row.declined_reason,
    offer_expires_at: row.offer_expires_at,
    project,
  };
}

type OwnedAssignmentResult =
  | { ok: true; row: AssignmentRecord }
  | { ok: false; error: string };

/**
 * Loads one assignment that belongs to `crewId`. The `crew_member_id` filter is
 * the ownership boundary: a row belonging to another crew member is reported as
 * not found, never as forbidden, so the id space cannot be enumerated.
 */
async function loadOwnedAssignment(
  session: RoleSession,
  crewId: string,
  assignmentId: string,
): Promise<OwnedAssignmentResult> {
  const { data, error } = await session.supabase
    .from("project_crew_assignments")
    .select("*")
    .eq("id", assignmentId)
    .eq("crew_member_id", crewId)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    console.error("crew_dashboard_assignment_failed", { code: error.code });
    return { ok: false, error: "Gagal memuat penugasan. Coba lagi." };
  }
  if (!data) return { ok: false, error: "Penugasan tidak ditemukan." };

  return { ok: true, row: data as unknown as AssignmentRecord };
}

type NormalisedUrl = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * A raw-drop link is optional; an empty field clears it. Anything else must be
 * an absolute http(s) URL — the value is rendered as a clickable link on the
 * crew portal and in the studio console, so `javascript:` must never land here.
 */
function normaliseDropUrl(raw: string | null | undefined): NormalisedUrl {
  if (raw == null) return { ok: true, value: null };

  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > 2048) {
    return { ok: false, error: "Tautan terlalu panjang (maksimal 2048 karakter)." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Tautan tidak valid. Tempel tautan lengkap dari Google Drive." };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Tautan harus diawali http:// atau https://." };
  }

  return { ok: true, value: parsed.toString() };
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Every non-revoked assignment of the signed-in crew member, newest call time
 * first, with the project name and status resolved for display.
 *
 * Two queries rather than a PostgREST embed: `project_crew_assignments` has no
 * declared relationship in the generated types, so an embed would be typed
 * `SelectQueryError` and force a cast on every row. A map lookup is one round
 * trip cheaper at this size and stays fully typed.
 */
export async function listMyAssignments(): Promise<MyAssignmentBoard> {
  const session = await requireStaff();

  const identity = await resolveCrewMember(session);
  if (!identity.ok) return { ok: false, error: identity.error };
  if (!identity.crew) return { ok: true, crewMember: null, assignments: [] };

  const crew = identity.crew;

  const { data, error } = await session.supabase
    .from("project_crew_assignments")
    .select("*")
    .eq("crew_member_id", crew.id)
    // A revoked assignment is not the crew member's work any more; it is shown
    // nowhere, exactly as the revoked token behaves on the public portal.
    .is("revoked_at", null)
    .order("call_time", { ascending: false });

  if (error) {
    console.error("crew_dashboard_assignments_failed", { code: error.code });
    return { ok: false, error: "Gagal memuat daftar penugasan Anda. Coba lagi." };
  }

  const rows = (data ?? []) as unknown as AssignmentRecord[];

  const projectIds = Array.from(new Set(rows.map((row) => row.project_id)));
  const projects = new Map<string, MyAssignment["project"]>();

  if (projectIds.length > 0) {
    const { data: projectRows, error: projectError } = await session.supabase
      .from("projects")
      .select("id, name, status, shoot_date")
      .in("id", projectIds);

    if (projectError) {
      console.error("crew_dashboard_projects_failed", { code: projectError.code });
      return { ok: false, error: "Gagal memuat data proyek penugasan Anda. Coba lagi." };
    }

    for (const project of projectRows ?? []) {
      projects.set(project.id, {
        id: project.id,
        name: project.name,
        status: project.status,
        shoot_date: project.shoot_date,
      });
    }
  }

  const nowMs = Date.now();

  return {
    ok: true,
    crewMember: { id: crew.id, crewCode: crew.crew_code, fullName: crew.full_name },
    assignments: rows.map((row) =>
      toMyAssignment(
        row,
        projects.get(row.project_id) ?? {
          id: row.project_id,
          name: "Proyek",
          status: "unknown",
          shoot_date: null,
        },
        nowMs,
      ),
    ),
  };
}

// ── Mutations ───────────────────────────────────────────────────────────────

/** PENDING_OFFER -> ACCEPTED, for the caller's own offer only. */
export async function acceptAssignment(assignmentId: string): Promise<CrewResult> {
  const session = await requireStaff();
  if (!uuidSchema.safeParse(assignmentId).success) {
    return { ok: false, error: "ID penugasan tidak valid." };
  }

  const identity = await resolveCrewMember(session);
  if (!identity.ok) return identity;
  if (!identity.crew) {
    return { ok: false, error: "Akun Anda belum tertaut ke profil kru." };
  }

  const owned = await loadOwnedAssignment(session, identity.crew.id, assignmentId);
  if (!owned.ok) return owned;

  const state = effectiveState(owned.row, Date.now());
  // Accepting twice is harmless: the card simply refreshes into its new group.
  if (state === "ACCEPTED") return { ok: true };
  if (state === "EXPIRED") {
    return { ok: false, error: "Undangan ini sudah kedaluwarsa dan tidak bisa diterima." };
  }
  if (state !== "PENDING_OFFER") {
    return { ok: false, error: "Penugasan ini sudah Anda tolak sebelumnya." };
  }

  const nowIso = new Date().toISOString();

  /*
   * Compare-and-set. `crew_member_id` is repeated here so the write itself is
   * scoped to the caller even if the read above were somehow wrong, and
   * `acceptance_status = PENDING_OFFER` makes a concurrent decline (from the
   * public portal, on the same row) fail this write instead of being overwritten.
   */
  const { data: updated, error } = await session.supabase
    .from("project_crew_assignments")
    .update({
      acceptance_status: "ACCEPTED",
      accepted_at: nowIso,
      declined_at: null,
      declined_reason: null,
      updated_at: nowIso,
    })
    .eq("id", assignmentId)
    .eq("crew_member_id", identity.crew.id)
    .eq("acceptance_status", "PENDING_OFFER")
    .select("id");

  if (error) {
    console.error("crew_accept_failed", { code: error.code });
    return { ok: false, error: "Gagal menerima penugasan. Coba lagi." };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: "Status penugasan sudah berubah. Muat ulang halaman." };
  }

  revalidatePath(BOARD_PATH);
  return { ok: true };
}

/** PENDING_OFFER -> DECLINED with a mandatory reason. */
export async function declineAssignment(
  assignmentId: string,
  reason: string,
): Promise<CrewResult> {
  const session = await requireStaff();
  if (!uuidSchema.safeParse(assignmentId).success) {
    return { ok: false, error: "ID penugasan tidak valid." };
  }

  /*
   * A decline without a reason is useless to the studio: it cannot re-dispatch
   * or renegotiate. Enforced here, not only in the form, so a caller that skips
   * the UI still cannot record a silent refusal.
   */
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  if (trimmedReason.length < 3) {
    return { ok: false, error: "Alasan penolakan wajib diisi (minimal 3 karakter)." };
  }
  if (trimmedReason.length > 500) {
    return { ok: false, error: "Alasan penolakan maksimal 500 karakter." };
  }

  const identity = await resolveCrewMember(session);
  if (!identity.ok) return identity;
  if (!identity.crew) {
    return { ok: false, error: "Akun Anda belum tertaut ke profil kru." };
  }

  const owned = await loadOwnedAssignment(session, identity.crew.id, assignmentId);
  if (!owned.ok) return owned;

  const state = effectiveState(owned.row, Date.now());
  if (state === "DECLINED") return { ok: true };
  if (state === "ACCEPTED") {
    return {
      ok: false,
      error: "Penugasan ini sudah Anda terima. Hubungi koordinator lapangan untuk membatalkannya.",
    };
  }
  if (state === "EXPIRED") {
    return { ok: false, error: "Undangan ini sudah kedaluwarsa." };
  }

  const nowIso = new Date().toISOString();

  const { data: updated, error } = await session.supabase
    .from("project_crew_assignments")
    .update({
      acceptance_status: "DECLINED",
      declined_at: nowIso,
      declined_reason: trimmedReason,
      updated_at: nowIso,
    })
    .eq("id", assignmentId)
    .eq("crew_member_id", identity.crew.id)
    .eq("acceptance_status", "PENDING_OFFER")
    .select("id");

  if (error) {
    console.error("crew_decline_failed", { code: error.code });
    return { ok: false, error: "Gagal menolak penugasan. Coba lagi." };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: "Status penugasan sudah berubah. Muat ulang halaman." };
  }

  revalidatePath(BOARD_PATH);
  return { ok: true };
}

/**
 * Records that the shoot is wrapped and, optionally, where the raw files live.
 *
 * `completed_at` is stamped once and never moved: re-submitting only corrects
 * the drop link, it does not rewrite when the work finished.
 */
export async function markShootCompleted(
  assignmentId: string,
  rawDropUrl?: string | null,
): Promise<CrewResult> {
  const session = await requireStaff();
  if (!uuidSchema.safeParse(assignmentId).success) {
    return { ok: false, error: "ID penugasan tidak valid." };
  }

  const identity = await resolveCrewMember(session);
  if (!identity.ok) return identity;
  if (!identity.crew) {
    return { ok: false, error: "Akun Anda belum tertaut ke profil kru." };
  }

  const owned = await loadOwnedAssignment(session, identity.crew.id, assignmentId);
  if (!owned.ok) return owned;

  const state = effectiveState(owned.row, Date.now());
  if (state !== "ACCEPTED") {
    return {
      ok: false,
      error: "Hanya penugasan yang sudah Anda terima yang bisa ditandai selesai.",
    };
  }

  const drop = normaliseDropUrl(rawDropUrl);
  if (!drop.ok) return drop;

  const nowIso = new Date().toISOString();

  /*
   * `completed_at` is added by migration 0029 and is therefore absent from the
   * generated `Database` types. The cast is confined to this single call site
   * and disappears the moment those types are regenerated.
   */
  const patch: Partial<ProjectCrewAssignmentRow> & { completed_at?: string } = {
    raw_drop_url: drop.value,
    updated_at: nowIso,
  };
  if (!owned.row.completed_at) patch.completed_at = nowIso;

  const { data: updated, error } = await session.supabase
    .from("project_crew_assignments")
    .update(patch as unknown as Partial<ProjectCrewAssignmentRow>)
    .eq("id", assignmentId)
    .eq("crew_member_id", identity.crew.id)
    .eq("acceptance_status", "ACCEPTED")
    .select("id");

  if (error) {
    console.error("crew_complete_failed", { code: error.code });
    return { ok: false, error: "Gagal menandai penugasan selesai. Coba lagi." };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: "Status penugasan sudah berubah. Muat ulang halaman." };
  }

  revalidatePath(BOARD_PATH);
  return { ok: true };
}
