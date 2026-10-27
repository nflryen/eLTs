import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { normaliseSupabaseUrl, sanitiseReturnPath } from "@/lib/url";
import { ROOT_DOMAIN } from "@/lib/domain";

/**
 * Edge Middleware with Subdomain Multi-Tenancy & Capability Enforcement.
 *
 * MIGRATION TO SUBDOMAIN ISOLATION:
 * ---------------------------------
 *  1. elts.co.id (root / marketing) -> Public brand, showcase, portfolio, pricelist
 *  2. ops.elts.co.id (ops)          -> Internal Studio OS, projects, calendar, crew, finance
 *  3. client.elts.co.id (client)    -> Client portal, magic link proofing, gallery delivery
 *
 * DEFENCE IN DEPTH
 * ----------------
 * Session cookies are scoped to their respective subdomains.
 * Capability and role ranks are enforced BEFORE any RSC payload is computed.
 */

/** Minimum role rank required to open an admin/ops path prefix. */
const ROUTE_MIN_RANK: ReadonlyArray<{ prefix: string; rank: number }> = [
  // Executive-only: treasury ledger and RBAC/user administration.
  { prefix: "/admin/finance", rank: 100 },
  { prefix: "/admin/users", rank: 100 },
  // Operations: dispatching, scheduling, invoicing, clients, gear.
  { prefix: "/admin", rank: 60 },
  { prefix: "/settings", rank: 60 },
];

function requiredRank(pathname: string): number {
  const sorted = [...ROUTE_MIN_RANK].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const rule of sorted) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) return rule.rank;
  }
  return 60;
}

export async function middleware(request: NextRequest) {
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "";
  const hostname = host.split(":")[0].toLowerCase();
  const pathname = request.nextUrl.pathname;
  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");

  // ── 0. Subdomain Host Classification ──────────────────────────────────────
  const isOps =
    hostname === `ops.${ROOT_DOMAIN}` ||
    hostname === `admin.${ROOT_DOMAIN}` ||
    hostname === "ops.localhost" ||
    hostname === "admin.localhost";

  const isClient =
    hostname === `client.${ROOT_DOMAIN}` ||
    hostname === "client.localhost";

  const isDirectIp = hostname === "127.0.0.1";
  const isRoot = !isOps && !isClient && !isDirectIp;

  // ── 1. Root Domain Legacy 301 Permanent Redirects ──────────────────────────
  if (isRoot) {
    // Legacy /admin/* -> ops subdomain
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      const targetPath = pathname.replace(/^\/admin/, "") || "/";
      const redirectUrl = new URL(
        isLocal
          ? `http://ops.localhost:3000${targetPath}${request.nextUrl.search}`
          : `https://ops.${ROOT_DOMAIN}${targetPath}${request.nextUrl.search}`
      );
      return NextResponse.redirect(redirectUrl, { status: 301 });
    }

    // Legacy /client, /proofing/*, /gallery/* -> client subdomain
    if (
      pathname === "/client" ||
      pathname.startsWith("/client/") ||
      pathname.startsWith("/proofing/") ||
      pathname.startsWith("/gallery/")
    ) {
      const targetPath =
        pathname === "/client"
          ? "/"
          : pathname.startsWith("/client/")
          ? pathname.replace(/^\/client/, "") || "/"
          : pathname;
      const redirectUrl = new URL(
        isLocal
          ? `http://client.localhost:3000${targetPath}${request.nextUrl.search}`
          : `https://client.${ROOT_DOMAIN}${targetPath}${request.nextUrl.search}`
      );
      return NextResponse.redirect(redirectUrl, { status: 301 });
    }

    // Normal marketing requests pass through to (marketing) route group
    return NextResponse.next();
  }

  // ── 2. Client Subdomain Handling ───────────────────────────────────────────
  if (isClient) {
    // Root or /login -> client PIN login portal (/client)
    if (pathname === "/" || pathname === "/login") {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = "/client";
      return NextResponse.rewrite(rewriteUrl);
    }
    // /proofing/*, /gallery/*, /invoice/* pass through to (client) route group
    return NextResponse.next();
  }

  // ── 3. Ops / Admin Subdomain Handling & Security Gate ──────────────────────
  let effectivePathname = pathname;
  let isRewritten = false;

  if (isOps) {
    if (pathname === "/") {
      effectivePathname = "/admin";
      isRewritten = true;
    } else if (pathname === "/login") {
      effectivePathname = "/admin/login";
      isRewritten = true;
    } else if (
      !pathname.startsWith("/admin") &&
      !pathname.startsWith("/api") &&
      !pathname.startsWith("/settings")
    ) {
      effectivePathname = `/admin${pathname}`;
      isRewritten = true;
    }
  }

  const isAdminUi = effectivePathname === "/admin" || effectivePathname.startsWith("/admin/");
  const isAdminApi = effectivePathname.startsWith("/api/admin/");
  const isSettings = effectivePathname === "/settings" || effectivePathname.startsWith("/settings/");

  // Allow login page through without auth check
  if (effectivePathname === "/admin/login" || (!isAdminUi && !isAdminApi && !isSettings)) {
    if (isRewritten) {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = effectivePathname;
      return NextResponse.rewrite(rewriteUrl);
    }
    return NextResponse.next();
  }

  // Build base response (with rewrite if needed)
  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = effectivePathname;
  let response = isRewritten
    ? NextResponse.rewrite(rewriteUrl, {
        request: { headers: request.headers },
      })
    : NextResponse.next({
        request: { headers: request.headers },
      });

  // Verify Supabase Auth & Role Ranks
  const supabaseUrl = normaliseSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!supabaseUrl) {
    return new NextResponse("Supabase is misconfigured (invalid project URL).", { status: 500 });
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
          response = isRewritten
            ? NextResponse.rewrite(rewriteUrl, { request })
            : NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, {
              ...options,
              // Strictly isolate staff session cookies to the ops subdomain in production
              domain: isOps && !isLocal ? `ops.${ROOT_DOMAIN}` : undefined,
            })
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL(isOps ? "/login" : "/admin/login", request.url);
    const returnTarget = isOps
      ? effectivePathname.replace(/^\/admin/, "") || "/"
      : effectivePathname;
    loginUrl.searchParams.set(
      "redirectedFrom",
      sanitiseReturnPath(returnTarget, [
        "/admin",
        "/settings",
        "/",
        "/projects",
        "/finance",
        "/calendar",
        "/crew",
        "/inventory",
        "/invoices",
        "/leads",
        "/payroll",
        "/referrals",
        "/users",
      ]) ?? (isOps ? "/" : "/admin"),
    );
    return NextResponse.redirect(loginUrl);
  }

  const { data: callerRows, error: rankError } = await supabase.rpc("get_caller_role");
  const rank = rankError
    ? 0
    : Number((callerRows as Array<{ role_rank: number }> | null)?.[0]?.role_rank ?? 0);

  const needed = requiredRank(effectivePathname);
  if (rank < needed) {
    const deniedUrl = new URL(isOps ? "/" : "/admin", request.url);
    deniedUrl.searchParams.set("denied", "unauthorized");
    return NextResponse.redirect(deniedUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - api (API routes except /api/admin)
     * - _next/static, _next/image
     * - metadata files (favicon.ico, icon.svg, sitemap.xml, robots.txt)
     * - static image/video/doc extensions
     */
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|webp|gif|mp4|pdf)$).*)",
    "/api/admin/:path*",
  ],
};
