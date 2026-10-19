import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase, type ServiceSupabaseClient } from "@/lib/supabase/service";
import type { User } from "@supabase/supabase-js";

/**
 * Admin authorization.
 *
 * WHY THIS MODULE HAS TWO ENTRY POINTS
 * ------------------------------------
 * `requireAdmin()` is called from two contexts that must fail DIFFERENTLY:
 *
 *   1. Server Components / Pages — an unauthenticated visitor should be sent to
 *      the login page. Throwing lets the page-level error boundary or the proxy
 *      handle it.
 *
 *   2. Route Handlers (`/api/...`) — a fetch or `window.open` receives an HTTP
 *      status. Throwing here produces an unhandled 500 and, in development,
 *      Turbopack's red error overlay. Callers expect 401 (JSON) or a redirect
 *      (HTML print pages).
 *
 * The original single `throw new Error("Unauthorized")` served (1) and crashed
 * (2). Worse, a route wrapping the call in `try/catch` logged it and returned
 * 500 — the exact symptom reported.
 *
 * VERIFYING THE SESSION
 * ---------------------
 * `supabase.auth.getUser()` is used rather than `getSession()` because it
 * validates the JWT against the auth server. `getSession()` trusts the cookie
 * contents, so a forged or stale cookie would pass. Note that the cookie is
 * project-scoped (`sb-<project-ref>-auth-token`); pointing the app at a
 * different Supabase project invalidates every existing session, which is
 * expected and surfaces here as a clean 401 rather than a crash.
 */

export class UnauthorizedError extends Error {
  constructor(message = "Sesi tidak valid atau telah berakhir.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Akun ini tidak memiliki akses admin.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export type AdminSession = {
  supabase: ServiceSupabaseClient;
  admin: { user_id: string; display_name: string };
  user: User;
};

/**
 * Authorizes the caller and returns a SERVICE-ROLE client for data access.
 *
 * Throws `UnauthorizedError` / `ForbiddenError`. Use this in Server Components
 * and Server Actions. In a Route Handler, prefer `withAdmin()` below, which
 * converts the throw into a proper HTTP response.
 */
export async function requireAdmin(): Promise<AdminSession> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) throw new UnauthorizedError();

  /*
   * LEGACY ENTRY POINT — now RBAC-aware.
   *
   * `requireAdmin()` predates the role model and is still used by the five
   * `/api/admin/**` route handlers through `withAdmin()`. Rather than rewrite
   * every handler, this resolves the caller's rank through the same database
   * functions the RLS policies use, and requires ADMIN (80) or above.
   *
   *   1. An account with a role_assignments row uses that rank.
   *   2. An account in `public.admins` with no assignment falls back to 80
   *      (see `private.legacy_admin_rank()`), so pre-RBAC accounts keep working.
   *   3. WORKER (60) and below is rejected — it has no business in an
   *      `/api/admin/**` endpoint.
   *
   * Prefer the explicit guards in `@/lib/auth/roles` for new code:
   *   requireOps() / requireFounder() / requireSuperAdmin() / requirePermission().
   */
  const { data: roleRow, error: roleError } = await supabase.rpc("get_caller_role");

  if (roleError) {
    const missingRpc =
      roleError.code === "PGRST202" ||
      /could not find the function/i.test(roleError.message ?? "");

    /*
     * Migration 0002 not applied to this database yet.
     *
     * Fall back to the pre-RBAC rule this function enforced before the role
     * model existed: membership in `public.admins`. Without this, every
     * `/api/admin/**` route would 403 the moment the code deployed ahead of
     * the migration — an outage caused purely by deploy ordering.
     */
    if (missingRpc) {
      const legacyQuery = await supabase
        .from("admins")
        .select("user_id, display_name")
        .eq("user_id", user.id)
        .maybeSingle<{ user_id: string; display_name: string }>();

      if (legacyQuery.error || !legacyQuery.data) throw new ForbiddenError();

      return {
        supabase: createServiceSupabase(),
        admin: legacyQuery.data,
        user,
      };
    }

    console.error("require_admin_role_lookup_failed", { code: roleError.code });
    // Fail closed: an unreadable role is not a grant.
    throw new ForbiddenError();
  }
  const row = (Array.isArray(roleRow) ? roleRow[0] : roleRow) as
    | { role_key: string | null; role_rank: number | null; display_name: string | null }
    | undefined;

  const rank = Number(row?.role_rank ?? 0);
  const MINIMUM_ADMIN_RANK = 80;

  if (rank < MINIMUM_ADMIN_RANK) throw new ForbiddenError();

  const adminQuery = await supabase
    .from("admins")
    .select("user_id, display_name")
    .eq("user_id", user.id)
    .maybeSingle<{ user_id: string; display_name: string }>();

  return {
    supabase: createServiceSupabase(),
    admin: adminQuery.data ?? {
      user_id: user.id,
      display_name: row?.display_name ?? user.email ?? "Pengguna",
    },
    user,
  };
}

/**
 * Wraps a Route Handler so authentication failures become HTTP responses
 * instead of unhandled exceptions.
 *
 *   export const GET = withAdmin(async (req, { params, supabase }) => { ... });
 *
 * `mode` decides the failure shape:
 *   "json"     → 401 application/json      (fetch / XHR callers)
 *   "redirect" → 307 to /admin/login       (HTML pages opened in a new tab)
 *
 * This is the correct place for the behaviour: putting try/catch in every route
 * is how `export-favorites` came to return a 500 that masked the real cause.
 */
export function withAdmin<T extends Record<string, string>>(
  handler: (ctx: {
    req: Request;
    params: T;
    supabase: AdminSession["supabase"];
    admin: AdminSession["admin"];
    user: User;
  }) => Promise<Response>,
  options: { mode?: "json" | "redirect" } = {},
): (req: Request, ctx: { params: Promise<T> }) => Promise<Response> {
  const mode = options.mode ?? "json";

  return async (req, ctx) => {
    try {
      const { supabase, admin, user } = await requireAdmin();
      const params = await ctx.params;
      return await handler({ req, params, supabase, admin, user });
    } catch (err) {
      const isAuthError = err instanceof UnauthorizedError || err instanceof ForbiddenError;
      if (!isAuthError) throw err; // genuine bugs must still surface

      if (mode === "redirect") {
        const url = new URL(req.url);
        const login = new URL("/admin/login", url.origin);
        login.searchParams.set("redirectedFrom", url.pathname);
        return Response.redirect(login, 307);
      }

      const status = err instanceof ForbiddenError ? 403 : 401;
      return Response.json(
        {
          error: err instanceof ForbiddenError ? "FORBIDDEN" : "UNAUTHORIZED",
          message: err.message,
        },
        { status },
      );
    }
  };
}
