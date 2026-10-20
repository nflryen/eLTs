"use server";

import type { ProjectCrewAssignmentRow } from "@/types/operations";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { requireOps, type RoleSession } from "@/lib/auth/roles";
import {
  STATUS_LABEL,
  isLegalTransition,
  type CrewOption,
  type ProjectStatus,
  type StatusChangeResult,
} from "@/lib/projects/lifecycle";


/**
 * Project lifecycle and crew assignment actions.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The database already enforced two things the UI could not reach: a status
 * state machine (`private.enforce_project_status_transition`) and a
 * revoke-instead-of-delete crew model. The audit found no control for either,
 * so an operator could not move a project forward or staff a shoot.
 *
 * Both actions therefore mirror the DATABASE rules rather than inventing a
 * second set: the legal-transition table below is the same graph the trigger
 * enforces, and the trigger remains the authority if the two ever disagree.
 */

/*
 * `uuidSchema` enforces RFC 9562 version/variant nibbles. Postgres does not: any
 * 8-4-4-4-12 hex string is a valid `uuid`. Seeded demo rows such as
 * f0000000-0000-0000-0000-000000000004 therefore pass the database and fail
 * zod, which surfaced to the operator as "Invalid UUID" on a perfectly valid
 * crew member. Validate the SHAPE the database accepts, not a stricter one.
 */
const uuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "ID tidak valid."
);

// ─── Status transitions ──────────────────────────────────────────────────────

const statusChangeSchema = z.object({
  projectId: uuidSchema,
  from: z.enum(["draft", "editing", "ready", "archived", "expired"]),
  to: z.enum(["draft", "editing", "ready", "archived", "expired"]),
});

/**
 * Move a project along the state machine.
 *
 * `from` is supplied by the client so a stale tab cannot silently apply a
 * transition the operator never saw (the row moved underneath them). A mismatch
 * is reported rather than overwritten.
 */
export async function changeProjectStatus(
  projectId: string,
  from: ProjectStatus,
  to: ProjectStatus
): Promise<StatusChangeResult> {
  let session: RoleSession;
  try {
    session = await requireOps();
  } catch {
    return { ok: false, error: "Anda tidak memiliki izin untuk mengubah status proyek.", reason: "forbidden" };
  }
  const { supabase } = session;

  const parsed = statusChangeSchema.safeParse({ projectId, from, to });
  if (!parsed.success) return { ok: false, error: "Status atau proyek tidak valid.", reason: "invalid" };

  // Refuse locally with the same graph the trigger uses, so the operator gets a
  // readable sentence instead of a raw 23514 from Postgres.
  if (from === to) return { ok: false, error: `Proyek sudah berstatus ${STATUS_LABEL[to]}.`, reason: "illegal" };
  if (!isLegalTransition(from, to)) {
    return {
      ok: false,
      reason: "illegal",
      error: `Perubahan dari ${STATUS_LABEL[from]} ke ${STATUS_LABEL[to]} tidak diizinkan. Urutan yang benar: Draft → Editing → Ready → Archived.`,
    };
  }

  const { data: current, error: readError } = await supabase
    .from("projects")
    .select("id, status")
    .eq("id", projectId)
    .maybeSingle();

  if (readError) return { ok: false, error: "Gagal membaca status proyek. Coba lagi.", reason: "db" };
  if (!current) return { ok: false, error: "Proyek tidak ditemukan.", reason: "invalid" };

  // Stale view: the record moved since the page rendered.
  if ((current.status as string) !== from) {
    return {
      ok: false,
      reason: "illegal",
      error: `Status proyek sudah berubah menjadi ${STATUS_LABEL[current.status as ProjectStatus] ?? current.status}. Muat ulang halaman.`,
    };
  }

  const { error } = await supabase.from("projects").update({ status: to }).eq("id", projectId);

  if (error) {
    // Surface the trigger's own message when it is the authority that rejected.
    const isTransitionError = error.code === "23514" || /Invalid project status transition/i.test(error.message);
    return {
      ok: false,
      reason: isTransitionError ? "illegal" : "db",
      error: isTransitionError
        ? `${STATUS_LABEL[from]} → ${STATUS_LABEL[to]} ditolak oleh aturan status proyek.`
        : `Gagal menyimpan status: ${error.message}`,
    };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin/projects");
  revalidatePath("/admin");
  return { ok: true, from, to };
}

// ─── Crew assignment ─────────────────────────────────────────────────────────


/** Active crew available for assignment, with a repeat-booking warning. */
export async function getAssignableCrew(projectId: string): Promise<{
  ok: boolean;
  crew?: CrewOption[];
  error?: string;
}> {
  try {
    if (!uuidSchema.safeParse(projectId).success) return { ok: false, error: "ID proyek tidak valid." };
    const { supabase } = await requireOps();

    const [{ data: members, error: memberError }, { data: project }] = await Promise.all([
      /*
       * `v_crew_identity`, not `crew_members`: 0024 removed the contact columns
       * from the table and the view resolves them per linked/unlinked crew.
       */
      supabase
        .from("v_crew_identity")
        .select(
          "crew_member_id, full_name, crew_code, member_type, phone, standard_day_rate, is_active",
        )
        .eq("is_active", true)
        .order("full_name", { ascending: true }),
      supabase.from("projects").select("id, shoot_date").eq("id", projectId).maybeSingle(),
    ]);

    if (memberError || !members) return { ok: false, error: "Gagal memuat daftar kru." };

    const { data: existing } = await supabase
      .from("project_crew_assignments")
      .select("crew_member_id, project_id, revoked_at, call_time")
      .is("revoked_at", null);

    const assignedHere = new Set(
      (existing ?? []).filter((a) => a.project_id === projectId).map((a) => a.crew_member_id as string)
    );

    const shootDay = (project?.shoot_date as string | null)?.slice(0, 10) ?? null;
    const busy = new Set(
      (existing ?? [])
        .filter((a) => a.project_id !== projectId && shootDay && typeof a.call_time === "string" && (a.call_time as string).slice(0, 10) === shootDay)
        .map((a) => a.crew_member_id as string)
    );

    return {
      ok: true,
      crew: members.map((m) => ({
        id: m.crew_member_id as string,
        full_name: m.full_name as string,
        crew_code: m.crew_code as string,
        member_type: m.member_type as string,
        phone: (m.phone as string | null) ?? null,
        standard_day_rate: Number(m.standard_day_rate ?? 0),
        assignedToThisProject: assignedHere.has(m.crew_member_id as string),
        busySameDay: busy.has(m.crew_member_id as string),
      })),
    };
  } catch {
    return { ok: false, error: "Gagal memuat daftar kru." };
  }
}

const assignSchema = z.object({
  projectId: uuidSchema,
  crewMemberId: uuidSchema,
  roleTitle: z.string().trim().min(2, "Peran minimal 2 karakter.").max(100),
  feeAgreed: z.number().finite().nonnegative(),
  callTime: z.string().min(1, "Waktu call time wajib diisi."),
  venueName: z.string().trim().min(1).max(200).optional(),
  venueAddress: z.string().trim().max(300).optional(),
});

/**
 * Assign a crew member. The schema requires a magic_token and a call time, so
 * both are supplied here; a missing venue falls back to the same placeholder the
 * database default uses rather than failing the insert on a NOT NULL column.
 */
export async function assignCrewToProjectAction(input: {
  projectId: string;
  crewMemberId: string;
  roleTitle: string;
  feeAgreed: number;
  callTime: string;
  venueName?: string;
  venueAddress?: string;
}): Promise<{ ok: boolean; assignmentId?: string; error?: string }> {
  try {
    const { supabase } = await requireOps();
    const parsed = assignSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Data penugasan tidak valid." };
    }
    const v = parsed.data;

    const { data: project } = await supabase
      .from("projects")
      .select("id, name, shoot_date")
      .eq("id", v.projectId)
      .maybeSingle();
    if (!project) return { ok: false, error: "Proyek tidak ditemukan." };

    // Revoked rows still occupy UNIQUE(project_id, crew_member_id), so a
    // re-assignment must reuse the row rather than insert a second one.
    const { data: revoked } = await supabase
      .from("project_crew_assignments")
      .select("id")
      .eq("project_id", v.projectId)
      .eq("crew_member_id", v.crewMemberId)
      .not("revoked_at", "is", null)
      .maybeSingle();

    const callIso = new Date(v.callTime).toISOString();
    if (Number.isNaN(new Date(callIso).getTime())) {
      return { ok: false, error: "Waktu call time tidak valid." };
    }

    // Annotated so the status unions survive instead of widening to `string`.
    const payload: Partial<ProjectCrewAssignmentRow> = {
      role_title: v.roleTitle,
      call_time: callIso,
      fee_agreed: v.feeAgreed,
      venue_name: v.venueName?.trim() || "Lokasi Ditentukan Kemudian",
      venue_address: v.venueAddress?.trim() || "-",
      revoked_at: null,
      acceptance_status: "PENDING_OFFER",
      payment_status: "UNPAID",
    };

    if (revoked) {
      const { error } = await supabase.from("project_crew_assignments").update(payload).eq("id", revoked.id);
      if (error) return { ok: false, error: `Gagal menugaskan ulang: ${error.message}` };
      revalidatePath(`/admin/projects/${v.projectId}`);
      return { ok: true, assignmentId: revoked.id };
    }

    const { data, error } = await supabase
      .from("project_crew_assignments")
      .insert({
        /*
         * Spread `payload` is the UPDATE shape (every field optional, including
         * `id`). Spreading it into an INSERT would carry optional keys the insert
         * overload rejects, so the required columns are restated explicitly.
         */
        role_title: payload.role_title!,
        call_time: payload.call_time!,
        fee_agreed: payload.fee_agreed ?? 0,
        venue_name: payload.venue_name!,
        venue_address: payload.venue_address!,
        revoked_at: null,
        acceptance_status: "PENDING_OFFER",
        payment_status: "UNPAID",
        project_id: v.projectId,
        crew_member_id: v.crewMemberId,
        magic_token: randomBytes(32).toString("base64url"),
      })
      .select("id")
      .single();

    if (error || !data) {
      // 23505 = the partial unique index on ACTIVE assignments.
      if (error?.code === "23505") {
        return { ok: false, error: "Kru ini sudah ditugaskan dan masih aktif di proyek ini." };
      }
      return { ok: false, error: `Gagal menugaskan kru: ${error?.message ?? "tidak diketahui"}` };
    }

    revalidatePath(`/admin/projects/${v.projectId}`);
    revalidatePath("/admin");
    return { ok: true, assignmentId: data.id };
  } catch {
    return { ok: false, error: "Gagal menugaskan kru." };
  }
}

const updateSchema = z.object({
  assignmentId: uuidSchema,
  projectId: uuidSchema,
  roleTitle: z.string().trim().min(2, "Peran minimal 2 karakter.").max(100),
  feeAgreed: z.number().finite().nonnegative(),
});

/** Edit role and fee in place. */
export async function updateCrewAssignmentAction(input: {
  assignmentId: string;
  projectId: string;
  roleTitle: string;
  feeAgreed: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase } = await requireOps();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Data tidak valid." };
    const v = parsed.data;

    const { error } = await supabase
      .from("project_crew_assignments")
      .update({ role_title: v.roleTitle, fee_agreed: v.feeAgreed })
      .eq("id", v.assignmentId)
      .eq("project_id", v.projectId)
      .is("revoked_at", null);

    if (error) return { ok: false, error: `Gagal menyimpan: ${error.message}` };

    revalidatePath(`/admin/projects/${v.projectId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Gagal menyimpan perubahan penugasan." };
  }
}

/**
 * Cancel an assignment by marking `revoked_at`.
 *
 * Never a hard delete: the row is the record of who was booked, at what fee, and
 * what they accepted or declined. Deleting it would erase both the fee history
 * and the reason a slot was reopened.
 */
export async function revokeCrewAssignmentAction(
  assignmentId: string,
  projectId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!uuidSchema.safeParse(assignmentId).success || !uuidSchema.safeParse(projectId).success) {
      return { ok: false, error: "ID penugasan tidak valid." };
    }
    const { supabase } = await requireOps();

    const { error } = await supabase
      .from("project_crew_assignments")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", assignmentId)
      .eq("project_id", projectId)
      .is("revoked_at", null);

    if (error) return { ok: false, error: `Gagal membatalkan penugasan: ${error.message}` };

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath("/admin");
    return { ok: true };
  } catch {
    return { ok: false, error: "Gagal membatalkan penugasan." };
  }
}
