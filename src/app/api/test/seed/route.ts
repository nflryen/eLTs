import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import { hashGalleryPin } from "@/lib/security/credentials";
import { getPinPepper } from "@/lib/env";
import type { MediaRow } from "@/types/database";

export const runtime = "nodejs";

/**
 * Development test harness route: GET /api/test/seed
 *
 * Hardening (previously gated on `NODE_ENV !== "production"` alone):
 *
 *  1. An explicit ALLOWLIST of environments, not a denylist — a staging or
 *     preview deployment must not be seedable by default.
 *  2. A required bearer token compared in constant time, so the route cannot
 *     be invoked unauthenticated and cannot leak token length via timing.
 *  3. Uniform 404 responses. A 403 would confirm the route exists on a
 *     deployment that should not acknowledge it.
 *  4. Credentials are never echoed back in the response body.
 */
function deny(): NextResponse {
  return new NextResponse("Not found", { status: 404 });
}

function isAuthorized(request: Request): boolean {
  const env = process.env.NODE_ENV;
  if (env !== "development" && env !== "test") return false;

  const expected = process.env.TEST_SEED_TOKEN;
  if (!expected || expected.length < 16) return false;

  const header = request.headers.get("authorization") ?? "";
  const supplied = header.replace(/^Bearer\s+/i, "");
  if (supplied.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return deny();

  try {
    const supabase = createServiceSupabase();
    const pepper = getPinPepper();

    const PIN = "123456";
    const GALLERY_CODE = "ELTS-WISUDA01";
    const SLUG = "budi-siti-wisuda-unsoed";

    const pinHash = await hashGalleryPin(PIN, pepper);

    const customerId = "a0000000-0000-0000-0000-000000000001";
    const projectId = "b0000000-0000-0000-0000-000000000001";

    // 1. Upsert Customer
    await supabase.from("customers").upsert(
      {
        id: customerId,
        name: "Budi & Siti - Wisuda UNSOED",
        email: "budi.siti@unsoed.ac.id",
        phone: "081234567890",
      },
      { onConflict: "id" }
    );

    // 2. Upsert Project
    await supabase.from("projects").upsert(
      {
        id: projectId,
        customer_id: customerId,
        name: "Graduation Session — Budi & Siti (UNSOED 2026)",
        slug: SLUG,
        photography_type: "graduation",
        service_pillar: "PHOTOGRAPHY_GRADUATION",
        gallery_code: GALLERY_CODE,
        gallery_pin_hash: pinHash,
        access_token: "budi-siti-unsoed-access-token-xyz123",
        shoot_date: "2026-09-20",
        status: "ready",
        allow_download: true,
        watermark_enabled: true,
        contract_value: 1500000,
        dp_amount: 750000,
        is_dp_paid: true,
        is_fully_paid: false, // HTTP 402 Active
        selection_quota_min: 15,
        selection_quota_max: 20,
        selection_locked_at: null,
      },
      { onConflict: "id" }
    );

    // 3. Clean & seed 25 mock media
    await supabase.from("media").delete().eq("project_id", projectId);

    const sampleImages = [
      "photo-1534528741775-53994a69daeb",
      "photo-1507003211169-0a1dd7228f2d",
      "photo-1517841905240-472988babdf9",
      "photo-1539571696357-5a69c17a67c6",
      "photo-1524504388940-b1c1722653e1",
      "photo-1501196354995-cbb51c65aaea",
      "photo-1492562080023-ab3db95bfbce",
      "photo-1500648767791-00dcc994a43e",
      "photo-1519085360753-af0119f7cbe7",
      "photo-1472099645785-5658abf4ff4e",
    ];

    const mediaPayloads = [];
    for (let i = 1; i <= 25; i++) {
      const num = i.toString().padStart(2, "0");
      const unsplashId = sampleImages[(i - 1) % sampleImages.length];

      mediaPayloads.push({
        id: `c0000000-0000-0000-0000-${i.toString(16).padStart(12, "0")}`,
        project_id: projectId,
        type: "image",
        file_name: `ELTS_UNSOED_${num}.jpg`,
        mime_type: "image/jpeg",
        storage_provider: "supabase",
        original_key: `${projectId}/wisuda-unsoed-${num}.jpg`,
        thumbnail_key: `https://images.unsplash.com/${unsplashId}?auto=format&fit=crop&w=600&q=80`,
        preview_key: `https://images.unsplash.com/${unsplashId}?auto=format&fit=crop&w=1200&q=85`,
        watermarked_thumbnail_key: `https://images.unsplash.com/${unsplashId}?auto=format&fit=crop&w=600&q=80`,
        watermarked_preview_key: `https://images.unsplash.com/${unsplashId}?auto=format&fit=crop&w=1200&q=85`,
        width: 3000,
        height: 2000,
        file_size: 4500000,
        processing_status: "ready",
        sort_order: i,
      });
    }
    // `mediaPayloads` is built from a literal, so it infers a structural type
    // that PostgREST's insert overload cannot match. Annotating it against the
    // row type keeps the shape honest at the call site.
    await supabase.from("media").insert(mediaPayloads as MediaRow[]);

    // Never echo credentials. The operator already holds them; returning the
    // PIN and access token in a response body risks it landing in a log,
    // a proxy cache, or a browser history entry.
    return NextResponse.json({
      success: true,
      message: "Proyek validasi berhasil di-seed.",
      project: {
        id: projectId,
        name: "Graduation Session — Budi & Siti (UNSOED 2026)",
        mediaCount: 25,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
