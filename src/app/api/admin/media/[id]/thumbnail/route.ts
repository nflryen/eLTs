import { z } from "zod";
import { withAdmin } from "@/lib/auth/admin";
import {
  getAuthenticatedCloudinaryUrl,
  getCloudinaryUrl,
} from "@/services/cloudinary";

export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers: privateHeaders });
}

/*
 * Binary image proxy. Serves bytes directly, so authentication failures must
 * answer 401 JSON — never a redirect, which a browser <img> would render as a
 * broken image with no explanation to the operator.
 */
export const GET = withAdmin<{ id: string }>(async ({ params, supabase }) => {
  const { id } = params;
  if (!z.uuid().safeParse(id).success) {
    return errorResponse("Media not found", 404);
  }

  const { data: media, error } = await supabase
    .from("media")
    .select("id, type, cloudinary_public_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return errorResponse("Media unavailable", 503);
  if (!media?.cloudinary_public_id) {
    return errorResponse("Media not found", 404);
  }

  const type = media.type === "video" ? "video" : "image";

  try {
    const authenticatedDelivery = getAuthenticatedCloudinaryUrl(
      media.cloudinary_public_id,
      "thumbnail",
      type,
    );
    const publicDelivery = getCloudinaryUrl(media.cloudinary_public_id, "thumbnail", type);

    let upstream = await fetch(authenticatedDelivery, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      upstream = await fetch(publicDelivery, {
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
    }
    if (!upstream.ok || !upstream.body) {
      return errorResponse("Thumbnail unavailable", 502);
    }

    const contentType =
      upstream.headers.get("content-type") ?? (type === "video" ? "image/jpeg" : "image/webp");
    if (!contentType.toLowerCase().startsWith("image/")) {
      await upstream.body.cancel();
      return errorResponse("Thumbnail unavailable", 502);
    }

    // Stream bytes only after admin authorization; the signed upstream URL is
    // never exposed to the client.
    return new Response(upstream.body, {
      headers: { ...privateHeaders, "Content-Type": contentType },
    });
  } catch {
    return errorResponse("Thumbnail unavailable", 502);
  }
});
