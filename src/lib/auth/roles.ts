import "server-only";

/*
 * `redirect` throws a control-flow signal that Next.js maps to a 307. It is
 * imported here — not re-exported — because this module is `server-only`, so a
 * Client Component cannot pull it in by accident.
 */
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase, type ServiceSupabaseClient } from "@/lib/supabase/service";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/admin";
import type { User } from "@supabase/supabase-js";

/**
 * Role-aware authorization.
 *
 * WHY THIS IS SEPARATE FROM `admin.ts`
 * ------------------------------------
 * `requireAdmin()` answers "is this person staff?" and is called from 35
 * call-sites. This module answers "is this person allowed to do THIS?" and is
 * additive, so the existing guards keep working while call-sites migrate one
 * domain at a time.
 *
 * WHY RANK AND NOT ROLE EQUALITY
 * ------------------------------
 * `requireRole("ADMIN")` would exclude SUPER_ADMIN and FOUNDER, who outrank it.
 * Every guard here is a MINIMUM, resolved against `private.current_role_rank()`
 * in the database — the same function the RLS policies use. There is no second
 * implementation to drift.
 *
 * WHY PERMISSIONS EXIST TOO
 * -------------------------
 * Rank cannot express "ADMIN may issue invoices but not settle them". Those
 * distinctions are checked with `requirePermission()` against
 * `public.role_permissions`, so the policy lives in one table rather than being
 * re-derived in application code.
 *
 * AUTHORIZATION IS NEVER DECIDED ON THE CLIENT. Components receive DTOs; the
 * server decides. Role checks in a `"use client"` file are a bug.
 */

/*
 * Re-exported, not redeclared. `role-meta` is the single source of rank truth
 * (it is dependency-free so Client Components can use it); this module used to
 * keep a second copy, which meant two tables to keep in step with
 * `public.roles.rank`.
 */
import type { RoleKey } from "@/lib/auth/role-meta";
import { ROLE_RANK } from "@/lib/auth/role-meta";

// Re-exported so the 30+ existing imports from this module keep working.
export type { RoleKey };
export { ROLE_RANK };

export type RoleSession = {
  supabase: ServiceSupabaseClient;
  user: User;
  /** Resolved role key, or null when the account has no assignment. */
  role: RoleKey | null;
  /** Effective rank: 0 for an account with no role. */
  rank: number;
  displayName: string;
  /**
   * `requireAdmin()`-compatible shape.
   *
   * Existing call-sites destructure `{ admin }` and use `admin.user_id` for
   * audit attribution. Keeping this alias lets those files switch guards
   * without also rewriting their audit columns.
   */
  admin: { user_id: string; display_name: string };
};

/**
 * Resolves the caller's effective role from the database.
 *
 * Reads through `private.current_role()` / `current_role_rank()`, which 0002
 * defines with a legacy fallback: a member present in `public.admins` but not in
 * `role_assignments` resolves to ADMIN (80). That keeps accounts provisioned
 * before the RBAC migration working.
 */
export async function getRoleSession(): Promise<RoleSession | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const service = createServiceSupabase();

  /*
   * `private` is not an exposed schema, so rank is resolved through a wrapper
   * RPC. If migration 0002 has not been applied to this database yet, the RPC
   * is missing and the call returns a schema-cache error.
   *
   * That case must NOT lock the studio out. Before RBAC, authorization was a
   * binary `public.admins` membership check; we fall back to exactly that, so a
   * deployment without 0002 behaves as it did before this change, while any
   * database WITH 0002 gets the full role model.
   *
   * The fallback is deliberately rank 80 (ADMIN): it grants the pre-RBAC
   * capability set and nothing more. A missing migration can never promote
   * anyone to FOUNDER or SUPER_ADMIN.
   */
  /*
   * MUST run on the user-scoped client, not the service-role client.
   *
   * `get_caller_role()` resolves the actor from `auth.uid()`. A service-role
   * connection carries no user JWT, so `auth.uid()` is NULL and the RPC
   * correctly returns `role_key = null, role_rank = 0`. Calling it on the
   * service client therefore denied every user — including a SUPER_ADMIN —
   * with "Peran Anda (tidak ada)".
   */
  const { data, error } = await supabase.rpc("get_caller_role");

  if (error) {
    const missingRpc =
      error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "");

    if (!missingRpc) {
      // A genuine failure (network, permissions) is not a licence to guess.
      console.error("role_resolution_failed", { code: error.code });
      return null;
    }

    console.warn(
      "rbac_not_applied: migration 0002_rbac_core is missing from this database; " +
        "falling back to legacy public.admins membership (rank 80).",
    );

    // Typed at the query boundary rather than cast at the access site, so the
    // row shape is declared once and every read below is checked.
    const legacyQuery = await service
      .from("admins")
      .select("user_id, display_name")
      .eq("user_id", user.id)
      .maybeSingle<{ user_id: string; display_name: string }>();

    const legacyAdmin = legacyQuery.data;
    const legacyError = legacyQuery.error;

    if (legacyError) {
      console.error("role_legacy_lookup_failed", { code: legacyError.code });
      return null;
    }
    // Not an admin at all → no session.
    if (!legacyAdmin) return null;

    const legacyName = legacyAdmin.display_name || user.email || "Pengguna";
    return {
      supabase: service,
      user,
      role: "ADMIN",
      rank: ROLE_RANK.ADMIN,
      displayName: legacyName,
      admin: { user_id: user.id, display_name: legacyName },
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { role_key: string | null; role_rank: number | null; display_name: string | null }
    | undefined;

  const role = (row?.role_key ?? null) as RoleKey | null;
  const rank = Number(row?.role_rank ?? 0);
  const displayName = row?.display_name ?? user.email ?? "Pengguna";

  return {
    supabase: service,
    user,
    role,
    rank,
    displayName,
    admin: { user_id: user.id, display_name: displayName },
  };
}

/**
 * Requires at least `minimum` rank. Throws so the caller's error boundary or the
 * proxy decides the response shape — matching `requireAdmin()` semantics.
 */
export async function requireRole(minimum: RoleKey): Promise<RoleSession> {
  const session = await getRoleSession();
  if (!session) throw new UnauthorizedError();

  const required = ROLE_RANK[minimum];
  if (session.rank < required) {
    throw new ForbiddenError(
      `Peran Anda (${session.role ?? "tidak ada"}) tidak memiliki akses ke fitur ini.`,
    );
  }
  return session;
}

/**
 * Requires a specific permission grant. Use where rank alone cannot express the
 * rule — for example issuing an invoice without being able to settle one.
 */
export async function requirePermission(key: string): Promise<RoleSession> {
  const session = await getRoleSession();
  if (!session) throw new UnauthorizedError();

  // Same reason as getRoleSession: `has_permission_for_caller()` reads
  // `auth.uid()`, which only resolves on the user-scoped client.
  //
  // The generated `Database` type has a hand-written `Functions` block that
  // does not model this RPC's argument object, so the call is typed through a
  // narrow local signature rather than `any`. The runtime contract is the
  // function definition in migration 0002.
  const supabase = await createServerSupabase();
  const rpc = supabase.rpc as unknown as (
    fn: "has_permission_for_caller",
    args: { p_permission_key: string },
  ) => PromiseLike<{ data: boolean | null; error: { code?: string } | null }>;
  const { data, error } = await rpc("has_permission_for_caller", {
    p_permission_key: key,
  });
  if (error) {
    console.error("permission_check_failed", { code: error.code });
    // Fail closed: an unreadable permission check is not a grant.
    throw new ForbiddenError("Tidak dapat memverifikasi izin akses.");
  }
  if (data !== true) {
    throw new ForbiddenError(`Izin "${key}" diperlukan untuk tindakan ini.`);
  }
  return session;
}

// ── Named guards for the common cases ────────────────────────────────────────

/** System administration: migrations, integrations, RBAC, audit. */
export const requireSuperAdmin = () => requireRole("SUPER_ADMIN");

/** Business governance: treasury, ledger, waterfall splits, approvals. */
export const requireFounder = () => requireRole("FOUNDER");

/** Operations lead: dispatch, projects, logistics, invoicing. */
export const requireOps = () => requireRole("ADMIN");

/** Any staff member, including a WORKER. */
export const requireStaff = () => requireRole("WORKER");

// ── Page guards: redirect instead of throwing ────────────────────────────────
/*
 * WHY THIS EXISTS SEPARATELY FROM `requireRole`
 * ---------------------------------------------
 * `requireRole` throws so that Server Actions can catch the rejection and return
 * `{ success: false, error }`. An action that called `redirect()` would break its
 * own contract: the form would navigate instead of rendering an inline error.
 *
 * A PAGE has the opposite requirement. A rank refusal is not an exception, it is
 * a routine navigation outcome. Throwing from a page produced an HTTP 500 that
 * rendered the error boundary — which reads to an operator as "the app is
 * broken". `redirect()` yields a real 307, so a bookmark, a browser, and any
 * HTTP client all observe a clean refusal.
 */

/** Where a refused page sends the caller. `?denied=` drives the notice on /admin. */
const DENIED_PATH = "/admin?denied=unauthorized";

/**
 * Page-level guard. Redirects instead of throwing.
 *
 * - No session              → `/admin/login`
 * - Session below `minimum` → `/admin?denied=unauthorized`
 *
 * The denied target is a FIXED string: it cannot echo caller-controlled text,
 * and it does not disclose which tier the surface actually requires.
 */
export async function requirePageRole(minimum: RoleKey): Promise<RoleSession> {
  const session = await getRoleSession();
  if (!session) {
    redirect("/admin/login");
  }
  if (session.rank < ROLE_RANK[minimum]) {
    redirect(DENIED_PATH);
  }
  return session;
}

/**
 * Page guard for a permission grant rather than a rank.
 *
 * A failed permission LOOKUP (database unreachable) also redirects: an operator
 * cannot act on "cannot verify permission", and failing closed into the denied
 * screen is the correct outcome.
 */
export async function requirePagePermission(key: string): Promise<RoleSession> {
  const session = await getRoleSession();
  if (!session) {
    redirect("/admin/login");
  }

  const supabase = await createServerSupabase();
  const rpc = supabase.rpc as unknown as (
    fn: "has_permission_for_caller",
    args: { p_permission_key: string },
  ) => PromiseLike<{ data: boolean | null; error: { code?: string } | null }>;
  const { data, error } = await rpc("has_permission_for_caller", {
    p_permission_key: key,
  });
  if (error || data !== true) {
    redirect(DENIED_PATH);
  }
  return session;
}

/** Named page guards. Keep in step with the action guards above. */
export const requirePageSuperAdmin = () => requirePageRole("SUPER_ADMIN");
export const requirePageFounder = () => requirePageRole("FOUNDER");
export const requirePageOps = () => requirePageRole("ADMIN");
export const requirePageStaff = () => requirePageRole("WORKER");
