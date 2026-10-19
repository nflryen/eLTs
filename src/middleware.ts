import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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
  if (pathname === '/admin/login' || (!isAdminUi && !isAdminApi)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
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
    redirectUrl.searchParams.set('redirectedFrom', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  // `:path*` matches one or more segments, so the bare `/admin` is listed too.
  matcher: ['/admin', '/admin/:path*', '/api/admin/:path*'],
};
