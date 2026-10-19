import "server-only";

/**
 * Media delivery URL builder.
 *
 * Private media is NEVER addressed by its storage key, public CDN URL, or a
 * signed upstream URL in client-reachable markup. Every variant resolves through
 * the same-origin gateway, which re-validates the gallery session on each
 * request (`/api/media/[id]/preview`).
 *
 * Why this exists: the gallery previously rendered `thumbnail_key` verbatim.
 * That column held a public Unsplash URL in seeded data and an unsigned
 * Cloudinary `/upload/` URL for legacy rows — so the browser loaded the image
 * directly, bypassing session checks, watermarking, expiry and RLS entirely.
 */

export type MediaVariant = "thumbnail" | "preview" | "original";

const ORIGINAL_VARIANT = "preview";

/**
 * Session-validated, same-origin delivery URL for a media row.
 *
 * Only `mediaId` is meaningful. Storage keys are deliberately not accepted as
 * input: a row with no real Cloudinary asset must surface as a gateway 404 and
 * an honest "unavailable" tile, never as an arbitrary external image.
 */
export function mediaGatewayUrl(
  mediaId: string,
  variant: MediaVariant = "thumbnail",
  intent: "preview" | "download" = "preview",
): string {
  if (intent === "download") {
    return `/api/media/${mediaId}/download`;
  }
  const resolved = variant === "original" ? ORIGINAL_VARIANT : variant;
  return `/api/media/${mediaId}/preview?variant=${resolved}`;
}
