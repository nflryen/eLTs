import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceSupabase } from "@/lib/supabase/service";
import { createOpaqueSession } from "@/lib/security/credentials";
import { galleryCookieName } from "@/lib/auth/gallery";

interface RouteParams {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

/**
 * Magic Link Token Authentication Route Handler: GET /proofing/[token]
 *
 * Route Handlers in Next.js App Router have first-class permission to set cookies
 * and issue redirect responses with Set-Cookie headers.
 *
 * Workflow:
 *  1. Verifies the 43-character cryptographic access token.
 *  2. Provisions an authenticated session row in private.gallery_sessions.
 *  3. Sets the secure HTTP-only gallery session cookie on the redirect response.
 *  4. Redirects seamlessly to /gallery/[slug]?proofing=true without prompting for PIN.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { token } = await params;
  const origin = new URL(request.url).origin;

  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return NextResponse.redirect(new URL("/client?error=invalid_token", origin));
  }

  const db = createServiceSupabase();

  // 1. Look up project by access_token
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, slug, gallery_pin_hash, status, expires_at, access_token")
    .eq("access_token", token)
    .maybeSingle();

  if (projErr || !project) {
    return NextResponse.redirect(new URL("/client?error=project_not_found", origin));
  }

  if (project.status !== "ready") {
    return NextResponse.redirect(new URL("/client?error=gallery_not_ready", origin));
  }

  if (project.expires_at && new Date(project.expires_at).getTime() <= Date.now()) {
    return NextResponse.redirect(new URL("/client?error=gallery_expired", origin));
  }

  try {
    // 2. Provision an authenticated session row in private.gallery_sessions
    const { token: sessionToken, tokenHash } = createOpaqueSession();
    const { data: sessions, error: sessionError } = await db.rpc("create_gallery_session", {
      p_project_id: project.id,
      p_verified_pin_hash: project.gallery_pin_hash,
      p_token_hash: tokenHash,
      p_upgraded_pin_hash: null,
    });

    const session = sessions?.[0];
    if (sessionError || !session) {
      console.error("[ProofingMagicLink] Failed to provision session:", sessionError);
      return NextResponse.redirect(new URL(`/client?from=/gallery/${project.slug}`, origin));
    }

    // 3. Create redirect response and set cookie directly on the response
    const destinationUrl = new URL(`/gallery/${project.slug}?proofing=true`, request.url);
    const response = NextResponse.redirect(destinationUrl);

    const isProd = process.env.NODE_ENV === "production" && process.env.VERCEL === "1";
    const cookieStore = await cookies();
    cookieStore.set(galleryCookieName, sessionToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      expires: new Date(session.expires_at),
    });

    response.cookies.set(galleryCookieName, sessionToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      expires: new Date(session.expires_at),
    });
    return response;
  } catch (err: unknown) {
    console.error("[ProofingMagicLink] Unexpected error:", err);
    return NextResponse.redirect(new URL(`/client?from=/gallery/${project.slug}`, origin));
  }
}
