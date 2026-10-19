import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getGallerySession } from "@/lib/auth/gallery";
import { getAuthenticatedCloudinaryUrl } from "@/services/cloudinary";

export const runtime = "nodejs";

/**
 * Authenticated media gateway.
 *
 * Every request re-validates the gallery session; the media id alone is never
 * authority. Two behaviours were deliberately removed from the previous version:
 *
 *  1. The unsigned public Cloudinary fallback (`getCloudinaryUrl`). If an asset
 *     could not be fetched through authenticated delivery, the gateway used to
 *     retry a public `/upload/` URL — which is exactly the access path private
 *     galleries exist to prevent, and which also dropped the watermark.
 *  2. The `max-age=300` shared cache. Private media must not be cached by an
 *     intermediary that could later serve it to a different session.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getGallerySession().catch(() => null);
  const { id } = await params;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requested = new URL(request.url).searchParams.get("variant");
  const variant = requested === "thumbnail" ? "thumbnail" : "preview";

  const supabase = createServiceSupabase();
  const { data: media } = await supabase
    .from("media")
    .select("id, project_id, type, cloudinary_public_id, cloudinary_delivery_type")
    .eq("id", id)
    .eq("project_id", session.project_id)
    .maybeSingle();

  if (!media?.cloudinary_public_id) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  // Watermark is resolved server-side from the project flag, never inferred
  // from the variant the caller asked for.
  const { data: project } = await supabase
    .from("projects")
    .select("watermark_enabled, status")
    .eq("id", session.project_id)
    .maybeSingle();

  if (!project || project.status !== "ready") {
    return NextResponse.json({ error: "Gallery unavailable" }, { status: 403 });
  }

  const type = media.type === "video" ? "video" : "image";
  const upstreamUrl = getAuthenticatedCloudinaryUrl(
    media.cloudinary_public_id,
    variant,
    type,
    project.watermark_enabled === true,
  );

  const upstream = await fetch(upstreamUrl, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    // Fail closed. Never retry through public delivery.
    await upstream.body?.cancel();
    return NextResponse.json({ error: "Media unavailable" }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ??
        (type === "video" ? "video/mp4" : "image/webp"),
      // Private + session-bound: no shared cache, vary on the session cookie.
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
