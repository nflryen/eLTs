"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOps } from "@/lib/auth/roles";
import { createServiceSupabase } from "@/lib/supabase/service";
import type {
  CrewMemberRow,
  CrewPaymentStatus,
  AssignCrewInput,
  ProjectCrewAssignmentWithCrew,
} from "@/types/operations";

/*
 * The in-process `fallbackMemoryCrew` / `fallbackMemoryAssignments` stores were
 * removed, along with their seeded catalogues.
 *
 * The most serious behaviour was in getCrewAssignmentsForProject: when a query
 * returned no rows, it returned the entire demo assignment list for any
 * `projectId` beginning with "b0000000" — which is the id scheme used by real
 * seeded projects. A project with no crew therefore displayed a fabricated
 * call sheet naming a crew member who was never assigned, with bank details.
 *
 * An empty roster is now empty, and a failed query is an error.
 */

const uuidSchema = z.string().uuid();


/**
 * Returns active crew directory for dispatch selection dropdowns.
 */
export async function getCrewMembersList(): Promise<CrewMemberRow[]> {
  try {
    await requireOps();
    const supabase = createServiceSupabase();

    const { data, error } = await supabase
      .from("crew_members")
      .select("*")
      .eq("is_active", true)
      .order("full_name", { ascending: true });

    if (error) {
      console.error("crew_list_failed", { code: error.code });
      return [];
    }

    return (data ?? []) as CrewMemberRow[];
  } catch (err: unknown) {
    console.error("crew_list_threw", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return [];
  }
}


/**
 * Returns all crew assignments for a specific project, including crew member details.
 */
export async function getCrewAssignmentsForProject(
  projectId: string
): Promise<ProjectCrewAssignmentWithCrew[]> {
  try {
    await requireOps();
    const supabase = createServiceSupabase();

    const { data, error } = await supabase
      .from("project_crew_assignments")
      .select(`
        *,
        crew_member:crew_members (
          id,
          crew_code,
          full_name,
          phone,
          primary_skills,
          bank_name,
          bank_account_number,
          bank_account_holder
        )
      `)
      .eq("project_id", projectId)
      .order("call_time", { ascending: true });

    if (error) {
      console.error("crew_assignments_failed", { code: error.code });
      return [];
    }

    // An empty assignment list is a valid state (no crew booked yet) and is
    // never substituted with demo rows.
    return (data ?? []) as unknown as ProjectCrewAssignmentWithCrew[];
  } catch (err: unknown) {
    console.error("crew_assignments_threw", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return [];
  }
}

/**
 * Assigns a crew member to a project with field call sheet specifications.
 * Automatically generates a 43-character base64url magic token for zero-login crew access.
 * Note: Database trigger `trg_sync_crew_fee` automatically syncs fee to project_expenses.
 */
export async function assignCrewToProject(
  projectIdOrInput: string | AssignCrewInput,
  crewMemberId?: string,
  roleTitle?: string,
  callTime?: string,
  rollTime?: string | null,
  venueName?: string,
  venueAddress?: string,
  venueMapsUrl?: string | null,
  feeAgreed?: number,
  allocatedEquipment?: string[],
  technicalNotes?: string | null
): Promise<{ success: boolean; assignmentId?: string; magicToken?: string; error?: string }> {
  await requireOps();
  const supabase = createServiceSupabase();

  let input: AssignCrewInput;
  if (typeof projectIdOrInput === "object") {
    input = projectIdOrInput;
  } else {
    input = {
      projectId: projectIdOrInput,
      crewMemberId: crewMemberId!,
      roleTitle: roleTitle!,
      callTime: callTime!,
      rollTime: rollTime ?? null,
      venueName: venueName!,
      venueAddress: venueAddress!,
      venueMapsUrl: venueMapsUrl ?? null,
      feeAgreed: Number(feeAgreed ?? 0),
      allocatedEquipment: allocatedEquipment ?? [],
      technicalNotes: technicalNotes ?? null,
    };
  }

  const projectIdParsed = uuidSchema.safeParse(input.projectId);
  const crewMemberIdParsed = uuidSchema.safeParse(input.crewMemberId);

  if (!projectIdParsed.success || !crewMemberIdParsed.success) {
    return { success: false, error: "Invalid Project ID or Crew Member ID" };
  }

  if (!input.roleTitle || input.roleTitle.trim().length < 2) {
    return { success: false, error: "Role title must be at least 2 characters" };
  }

  if (!input.callTime) {
    return { success: false, error: "Call time is required" };
  }

  // Generate 43-char base64url token (32 random bytes)
  const magicToken = randomBytes(32).toString("base64url");

  const insertPayload = {
    project_id: input.projectId,
    crew_member_id: input.crewMemberId,
    magic_token: magicToken,
    role_title: input.roleTitle.trim(),
    call_time: new Date(input.callTime).toISOString(),
    roll_time: input.rollTime ? new Date(input.rollTime).toISOString() : null,
    venue_name: input.venueName || "Lokasi Ditentukan Kemudian",
    venue_address: input.venueAddress || "-",
    venue_maps_url: input.venueMapsUrl || null,
    dress_code: input.dressCode || "Seragam Hitam / Studio Polo",
    technical_notes: input.technicalNotes || null,
    allocated_equipment: input.allocatedEquipment || [],
    raw_drop_url: input.rawDropUrl || null,
    fee_agreed: Math.max(0, Number(input.feeAgreed) || 0),
    payment_status: "UNPAID",
    acceptance_status: "PENDING_OFFER",
  };

  const { data, error } = await supabase
    .from("project_crew_assignments")
    .insert(insertPayload)
    .select("id")
    .single();

  /*
   * A failed insert must not be reported as success.
   *
   * The previous version ignored `error`, minted a synthetic UUID, recorded the
   * assignment in an in-memory array, and returned `success: true` together
   * with a live magic_token. The operator saw a confirmation, the crew member
   * received a link to an assignment that did not exist, and the fee was never
   * synced to project_expenses.
   */
  if (error || !data) {
    console.error("crew_assign_failed", { code: error?.code });
    return {
      success: false,
      error: "Gagal menugaskan kru ke proyek. Silakan coba lagi.",
    };
  }

  revalidatePath(`/admin/projects/${input.projectId}`);
  revalidatePath(`/admin/projects/${input.projectId}/finance`);
  revalidatePath("/admin");

  return {
    success: true,
    assignmentId: data.id,
    magicToken,
  };
}
/**
 * Updates payment status and receipt proof for a crew assignment.
 */
export async function updateCrewPaymentStatus(
  assignmentId: string,
  status: CrewPaymentStatus,
  receiptUrl?: string | null
): Promise<{ success: boolean; error?: string }> {
  await requireOps();
  const supabase = createServiceSupabase();

  const idParsed = uuidSchema.safeParse(assignmentId);
  if (!idParsed.success) {
    return { success: false, error: "Invalid assignment ID" };
  }

  const updates: {
    payment_status: CrewPaymentStatus;
    updated_at: string;
    paid_at?: string | null;
    payment_receipt_url?: string | null;
  } = {
    payment_status: status,
    updated_at: new Date().toISOString(),
  };

  if (status === "PAID") {
    updates.paid_at = new Date().toISOString();
  } else if (status === "UNPAID") {
    updates.paid_at = null;
  }

  if (receiptUrl !== undefined) {
    updates.payment_receipt_url = receiptUrl;
  }

  const { data: assignment, error: updateError } = await supabase
    .from("project_crew_assignments")
    .update(updates)
    .eq("id", assignmentId)
    .select("project_id")
    .single();

  if (updateError) {
    console.error("Error updating crew payment status:", updateError);
    return { success: false, error: updateError.message };
  }

  if (assignment?.project_id) {
    revalidatePath(`/admin/projects/${assignment.project_id}`);
    revalidatePath(`/admin/projects/${assignment.project_id}/finance`);
  }

  return { success: true };
}

/**
 * Public field check-in.
 *
 * SECURITY (audit finding B6): this previously accepted a bare `assignmentId`
 * and wrote through the service-role client. A UUID is not a credential — it
 * appears in admin URLs and attention-queue deep links — so anyone who had seen
 * one could mark that crew member present, or move a colleague's arrival time.
 * The magic token is the only secret a crew member holds, so it is the only
 * thing that authorises the write.
 *
 * The write happens inside `public.crew_check_in()`, which validates the token,
 * requires an ACCEPTED offer, and is idempotent so a re-tap on flaky mobile
 * signal returns the original timestamp instead of overwriting it.
 */
export async function checkInCrewMember(
  magicToken: string
): Promise<{ success: boolean; error?: string; message?: string; checkInAt?: string }> {
  /*
   * Shape check before any database work. The token column is constrained to
   * `[A-Za-z0-9_-]{32,64}`, so anything else cannot be a real token and must
   * not reach the RPC.
   */
  if (typeof magicToken !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(magicToken)) {
    return { success: false, error: "Tautan penugasan tidak valid." };
  }

  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc("crew_check_in", {
    p_magic_token: magicToken,
  });

  if (error) {
    console.error("Error recording crew check-in:", error);
    return { success: false, error: "Gagal melakukan check-in. Silakan coba lagi." };
  }

  const payload = (data ?? {}) as {
    success?: boolean;
    error?: string;
    message?: string;
    check_in_at?: string;
  };

  if (!payload.success) {
    return { success: false, error: payload.message ?? "Check-in ditolak." };
  }

  /*
   * Revalidate both sides: the crew portal shows the arrival, and the admin
   * project console reads `check_in_at` to reconcile the call sheet.
   */
  revalidatePath(`/crew/${magicToken}`);
  const { data: row } = await supabase
    .from("project_crew_assignments")
    .select("project_id")
    .eq("magic_token", magicToken)
    .maybeSingle();
  if (row?.project_id) revalidatePath(`/admin/projects/${row.project_id}`);

  return {
    success: true,
    message: payload.message,
    checkInAt: payload.check_in_at,
  };
}

/**
 * Removes a crew assignment. Database trigger automatically removes the linked expense.
 */
export async function deleteCrewAssignment(
  assignmentId: string,
  projectId: string
): Promise<{ success: boolean; error?: string }> {
  await requireOps();
  const supabase = createServiceSupabase();

  const { error } = await supabase
    .from("project_crew_assignments")
    .delete()
    .eq("id", assignmentId);

  if (error) {
    console.error("Error deleting crew assignment:", error);
    return { success: false, error: error.message };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}/finance`);

  return { success: true };
}

/**
 * Live availability check: queries whether a crew member has conflicting assignments
 * on a specified date (shoot_date or call_time day).
 */
export async function checkCrewAvailability(
  crewMemberId: string,
  targetDate: string,
  excludeProjectId?: string
): Promise<{
  isAvailable: boolean;
  conflictDetails?: string | null;
  conflictingAssignments: Array<{
    id: string;
    projectId: string;
    projectName: string;
    roleTitle: string;
    callTime: string;
    acceptanceStatus: string;
  }>;
}> {
  await requireOps();
  const supabase = createServiceSupabase();

  if (!crewMemberId || !targetDate) {
    return { isAvailable: true, conflictingAssignments: [] };
  }

  const dateStr = targetDate.slice(0, 10);

  const { data, error } = await supabase
    .from("project_crew_assignments")
    .select(`
      id,
      project_id,
      role_title,
      call_time,
      acceptance_status,
      project:projects (
        id,
        name,
        shoot_date
      )
    `)
    .eq("crew_member_id", crewMemberId)
    .neq("acceptance_status", "DECLINED")
    .neq("acceptance_status", "EXPIRED");

  if (error || !data) {
    return { isAvailable: true, conflictingAssignments: [] };
  }

  type RawAssignmentWithProject = {
    id: string;
    project_id: string;
    role_title: string;
    call_time: string;
    acceptance_status: string;
    project: {
      id: string;
      name: string;
      shoot_date: string | null;
    } | null;
  };

  const conflicts: Array<{
    id: string;
    projectId: string;
    projectName: string;
    roleTitle: string;
    callTime: string;
    acceptanceStatus: string;
  }> = [];

  for (const item of data as unknown as RawAssignmentWithProject[]) {
    if (excludeProjectId && item.project_id === excludeProjectId) {
      continue;
    }

    const prjShootDate = item.project?.shoot_date ? item.project.shoot_date.slice(0, 10) : null;
    const callTimeDate = item.call_time ? item.call_time.slice(0, 10) : null;

    if (prjShootDate === dateStr || callTimeDate === dateStr) {
      conflicts.push({
        id: item.id,
        projectId: item.project_id,
        projectName: item.project?.name || "Proyek Lain",
        roleTitle: item.role_title,
        callTime: item.call_time,
        acceptanceStatus: item.acceptance_status,
      });
    }
  }

  if (conflicts.length > 0) {
    const first = conflicts[0];
    return {
      isAvailable: false,
      conflictDetails: `Sudah ditugaskan pada "${first.projectName}" (${first.roleTitle})`,
      conflictingAssignments: conflicts,
    };
  }

  return {
    isAvailable: true,
    conflictDetails: null,
    conflictingAssignments: [],
  };
}
