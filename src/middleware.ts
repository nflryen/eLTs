import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { normaliseSupabaseUrl, sanitiseReturnPath } from '@/lib/url';

/**
 * Route-level capability enforcement.
 *
 * WHAT THIS FIXES (audit finding B1/B4)
 * -------------------------------------
 * This middleware previously answered only "is anyone signed in?". It never
 * asked "may THIS person open THIS route", so an ADMIN (rank 80) could load
 * `/admin/finance` and `/admin/users` simply by typing the URL — the pages
 * rendered Treasury action buttons and a 15-row user directory with emails and
 * Suspend controls.
 *
 * The map below is the single server-side statement of which rank may open
 * which admin path. It runs BEFORE the page, so a forbidden route never
 * renders and never ships its payload.
 *
 * DEFENCE IN DEPTH
 * ----------------
 * This is a routing guard, not the authorization boundary. Every page and
 * Server Action still calls `requireRole`/`requirePermission`, and RLS decides
 * what data the service layer can see. A middleware bug degrades to "the page
 * 500s", never to "the data leaks".
 */

/** Minimum role rank required to open an admin path prefix. */
const ROUTE_MIN_RANK: ReadonlyArray<{ prefix: string; rank: number }> = [
  // Executive-only: treasury ledger and RBAC/user administration.
  { prefix: '/admin/finance', rank: 100 },
  { prefix: '/admin/users', rank: 100 },
  // Operations: dispatching, scheduling, invoicing, clients, gear.
  { prefix: '/admin', rank: 60 },
];

function requiredRank(pathname: string): number {
  // Longest-prefix wins so /admin/finance is checked before /admin.
  const sorted = [...ROUTE_MIN_RANK].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const rule of sorted) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) return rule.rank;
  }
  return 60;
}

export async function middleware(request: NextRequest) {
  /*
   * Scope: admin UI pages AND admin API routes.
   *
   * The previous matcher was `['/admin/:path*']`, which never ran for
   * `/api/admin/**`. Authorization for those routes lives in `requireAdmin()`
   * — the proxy is a convenience, not the security boundary — but the gap meant
   * an expired session reached the route handler and surfaced as a 500.
   *
   * `/admin/login` short-circuits so the login form is never gated.
   */
  const pathname = request.nextUrl.pathname;
  const isAdminUi = pathname === '/admin' || pathname.startsWith('/admin/');
  const isAdminApi = pathname.startsWith('/api/admin/');
  /*
   * /settings is a guarded staff surface too.
   *
   * It sits OUTSIDE /admin, so the previous matcher never ran here. That meant
   * the Supabase auth cookie was never refreshed on these routes: a session
   * close to expiry could pass on /admin (refreshed) and then read as
   * unauthenticated on /settings/security, which surfaced as an UnauthorizedError
   * even though the user was signed in. Refreshing here keeps one session state
   * across the whole app.
   */
  const isSettings = pathname === '/settings' || pathname.startsWith('/settings/');
  if (pathname === '/admin/login' || (!isAdminUi && !isAdminApi && !isSettings)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  /*
   * Normalise the project URL before the SDK appends `/auth/v1`.
   *
   * A trailing slash in the Vercel environment variable produced
   * `https://<ref>.supabase.co//auth/v1`, and every auth call then failed with
   * "Invalid path specified in request URL" — a message that points at the
   * request, not at the one character in the configuration that caused it.
   *
   * `normaliseSupabaseUrl` returns null for an unusable value; in that case the
   * request is failed explicitly rather than sent to a malformed endpoint.
   */
  const supabaseUrl = normaliseSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!supabaseUrl) {
    return new NextResponse('Supabase is misconfigured (invalid project URL).', {
      status: 500,
    });
  }

  const supabase = createServerClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  /*
   * `getUser()` rather than `getSession()`.
   *
   * `getSession()` trusts whatever is in the cookie without validating it
   * against the auth server, so a stale token from a previous Supabase project
   * (different `sb-<ref>-auth-token` cookie) would look "logged in" here and
   * then fail deeper in the request. `getUser()` performs the real check, so the
   * proxy and `requireAdmin()` agree on who is authenticated.
   */
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/admin/login';
    redirectUrl.search = '';
    /* Sanitised even though `pathname` is server-derived: defence in depth, and
       it guarantees a single-leading-slash path with no dot segments. */
    redirectUrl.searchParams.set(
      'redirectedFrom',
      sanitiseReturnPath(pathname, ['/admin', '/settings']) ?? '/admin',
    );
    return NextResponse.redirect(redirectUrl);
  }

  /*
   * Resolve the caller's effective rank through `public.get_caller_role()`.
   *
   * `private.current_role_rank()` is the helper the RLS policies use, but the
   * `private` schema is deliberately not exposed to PostgREST, so it cannot be
   * reached through `.rpc()`. `get_caller_role()` is the SECURITY DEFINER
   * wrapper that answers exactly this question for the caller — the same
   * function `src/lib/auth/roles.ts` consults, so the guard and the page agree.
   */
  const { data: callerRows, error: rankError } = await supabase.rpc('get_caller_role');
  const rank = rankError
    ? 0
    : Number((callerRows as Array<{ role_rank: number }> | null)?.[0]?.role_rank ?? 0);

  const needed = requiredRank(pathname);
  if (rank < needed) {
    /*
     * ADMIN and WORKER are redirected to the dashboard rather than shown a bare
     * 403: they are legitimate staff who followed a stale bookmark.
     *
     * The flag is the FIXED string `unauthorized`, identical to what
     * `requirePageRole()` emits in `src/lib/auth/roles.ts`. Emitting the refused
     * path instead would tell a low-rank user which hidden routes exist, which
     * is a reconnaissance aid for no operational benefit.
     */
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/admin';
    redirectUrl.search = '';
    redirectUrl.searchParams.set('denied', 'unauthorized');
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  // `:path*` matches one or more segments, so the bare `/admin` is listed too.
  matcher: ['/admin', '/admin/:path*', '/api/admin/:path*', '/settings', '/settings/:path*'],
};
