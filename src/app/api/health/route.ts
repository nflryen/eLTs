import { NextResponse } from "next/server";
import { normaliseSupabaseUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

/**
 * Deployment diagnostic.
 *
 * WHY THIS EXISTS
 * ---------------
 * A production outage was caused by `NEXT_PUBLIC_SUPABASE_URL` holding the REST
 * endpoint (`.../rest/v1/`) instead of the bare project origin. The symptom was
 * a bare 500 with no actionable detail, and the diagnosis required reading
 * middleware source to map the message back to the cause.
 *
 * This endpoint answers that class of question in one request.
 *
 * SHAPE ONLY, NEVER VALUES.
 * It reports whether a variable is present, whether it parses, and a coarse
 * reason when it does not. It must never echo a value, a prefix, a suffix, or a
 * length that could narrow a secret. A key's length IS reported for the anon key
 * only, because that key is public by design (it ships to the browser) and its
 * length is the fastest way to spot a truncated paste.
 */
export async function GET() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const urlValid = Boolean(normaliseSupabaseUrl(rawUrl));

  /*
   * Classify without revealing. The operator needs to know WHICH mistake was
   * made; they already know the value they pasted.
   */
  let urlReason: string | null = null;
  if (!rawUrl) {
    urlReason = "missing";
  } else if (!urlValid) {
    const trimmed = rawUrl.trim();
    if (/\/auth\/v1\/?$/.test(trimmed)) urlReason = "has_auth_path";
    else if (/\/rest\/v1\/?$/.test(trimmed)) urlReason = "has_rest_path";
    else if (!/^https?:\/\//i.test(trimmed)) urlReason = "missing_scheme";
    else if (trimmed !== rawUrl) urlReason = "has_whitespace";
    else urlReason = "not_a_bare_origin";
  }

  const body = {
    ok: urlValid && Boolean(anonKey),
    supabaseUrl: { present: Boolean(rawUrl), valid: urlValid, reason: urlReason },
    anonKey: { present: Boolean(anonKey), length: anonKey?.length ?? 0 },
    serviceRoleKey: { present: Boolean(serviceKey) },
    /* Reminder for whoever reads this during an incident. */
    expectedUrlShape: "https://<project-ref>.supabase.co",
  };

  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
