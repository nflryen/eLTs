"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { getRoleSession } from "@/lib/auth/roles";
import { ROLE_RANK } from "@/lib/auth/role-meta";

/*
 * SUPER ADMIN ROLE TIER MANAGEMENT
 * --------------------------------
 * Authorization is enforced TWICE, deliberately:
 *
 *   1. Here, so an unauthorised caller gets a clean FORBIDDEN result instead of
 *      a raw Postgres error leaking through the action boundary.
 *   2. In the database RPCs (`private.assert_role_manager()`), which is the
 *      boundary that actually matters — a Server Action is one caller among
 *      several and can be bypassed by anything holding a JWT.
 *
 * The invariants (never zero roles, never the last SUPER_ADMIN, always audited)
 * live ONLY in the database. Duplicating them here would create two sources of
 * truth that can disagree under concurrency.
 */

/** Postgres `insufficient_privilege`. Returned as the code the brief specifies. */
const FORBIDDEN = "42501" as const;

export type RoleMutationResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

export type ManagedUser = {
  userId: string;
  email: string;
  fullName: string | null;
  displayName: string | null;
  roles: string[];
  baseRole: string | null;
  maxRank: number;
  emailConfirmed: boolean;
  lastSignInAt: string | null;
  createdAt: string;
};

/**
 * Guards every action in this file.
 *
 * Returns the caller's session on success, or a FORBIDDEN result. Note that a
 * non-SUPER_ADMIN who *holds* SUPER_ADMIN as a non-active role is still denied:
 * the check reads `rank`, which is the ACTIVE session role. That is intentional
 * — a hybrid member operating as WORKER must not administer roles.
 */
async function requireSuperAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string; code: string }
> {
  const session = await getRoleSession().catch(() => null);

  if (!session) {
    return { ok: false, error: "Sesi tidak ditemukan.", code: "UNAUTHENTICATED" };
  }

  if (session.rank < ROLE_RANK.SUPER_ADMIN) {
    return {
      ok: false,
      error: "Hanya Super Admin yang dapat mengelola peran.",
      code: FORBIDDEN,
    };
  }

  return { ok: true, userId: session.user.id };
}

/** Maps a Postgres error to the result shape, preserving 42501. */
function toError(err: { message: string; code?: string }): RoleMutationResult {
  return { ok: false, error: err.message, code: err.code };
}

/** Full roster for the management table. */
export async function listManagedUsersAction(): Promise<
  { ok: true; users: ManagedUser[] } | { ok: false; error: string; code: string }
> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("list_users_with_roles");

  if (error) {
    return {
      ok: false,
      error: error.message,
      code: error.code ?? "QUERY_FAILED",
    };
  }

  const rows = (data ?? []) as Array<{
    user_id: string;
    email: string;
    full_name: string | null;
    display_name: string | null;
    roles: string[] | null;
    base_role: string | null;
    max_rank: number;
    email_confirmed: boolean;
    last_sign_in_at: string | null;
    created_at: string;
  }>;

  return {
    ok: true,
    users: rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      fullName: r.full_name,
      displayName: r.display_name,
      roles: r.roles ?? [],
      baseRole: r.base_role,
      maxRank: Number(r.max_rank ?? 0),
      emailConfirmed: Boolean(r.email_confirmed),
      lastSignInAt: r.last_sign_in_at,
      createdAt: r.created_at,
    })),
  };
}

const roleKeySchema = z.string().min(1).max(32);

/** Adds a role to a user. */
export async function grantRoleAction(input: {
  targetUserId: string;
  roleKey: string;
}): Promise<RoleMutationResult> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard;

  const parsed = z
    .object({ targetUserId: z.string().uuid(), roleKey: roleKeySchema })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Permintaan tidak valid.", code: "INVALID_INPUT" };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("grant_user_role", {
    p_target_user: parsed.data.targetUserId,
    p_role_key: parsed.data.roleKey,
  });

  if (error) return toError(error);

  revalidatePath("/admin/users");
  revalidatePath("/admin");
  return { ok: true };
}

/** Removes a role from a user. */
export async function revokeRoleAction(input: {
  targetUserId: string;
  roleKey: string;
}): Promise<RoleMutationResult> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard;

  const parsed = z
    .object({ targetUserId: z.string().uuid(), roleKey: roleKeySchema })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Permintaan tidak valid.", code: "INVALID_INPUT" };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("revoke_user_role", {
    p_target_user: parsed.data.targetUserId,
    p_role_key: parsed.data.roleKey,
  });

  if (error) return toError(error);

  revalidatePath("/admin/users");
  revalidatePath("/admin");
  return { ok: true };
}

/** Changes which role an account resolves to on login. */
export async function setDefaultRoleAction(input: {
  targetUserId: string;
  roleKey: string;
}): Promise<RoleMutationResult> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard;

  const parsed = z
    .object({ targetUserId: z.string().uuid(), roleKey: roleKeySchema })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Permintaan tidak valid.", code: "INVALID_INPUT" };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_default_user_role", {
    p_target_user: parsed.data.targetUserId,
    p_role_key: parsed.data.roleKey,
  });

  if (error) return toError(error);

  revalidatePath("/admin/users");
  revalidatePath("/admin");
  return { ok: true };
}

/** Recent role mutations, for the audit panel. */
export async function listRoleAuditAction(limit = 25): Promise<
  Array<{
    id: number;
    action: string;
    roleKey: string;
    actorEmail: string | null;
    targetEmail: string | null;
    createdAt: string;
  }>
> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return [];

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("role_management_audit")
    .select("id, action, role_key, actor_user_id, target_user_id, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  return (data ?? []).map((r) => ({
    id: Number(r.id),
    action: String(r.action),
    roleKey: String(r.role_key),
    actorEmail: r.actor_user_id ? String(r.actor_user_id).slice(0, 8) : null,
    targetEmail: r.target_user_id ? String(r.target_user_id).slice(0, 8) : null,
    createdAt: String(r.created_at),
  }));
}
