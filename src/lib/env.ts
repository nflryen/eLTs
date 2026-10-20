import "server-only";
import { z } from "zod";
import { normaliseSupabaseUrl } from "@/lib/url";

/*
 * The URL is validated as a bare project origin, NOT merely "a URL".
 *
 * `z.url()` accepts `https://ref.supabase.co/`, `https://ref.supabase.co//`,
 * ` https://ref.supabase.co ` and even `https://ref.supabase.co/auth/v1`.
 * Every one of those produces a malformed auth endpoint once the Supabase SDK
 * appends `/auth/v1`, and the resulting failure ("Invalid path specified in
 * request URL") points at the request rather than at the bad configuration.
 */
const supabaseSchema = z.object({
  url: z
    .string()
    .min(1)
    .transform((value, ctx) => {
      const normalised = normaliseSupabaseUrl(value);
      if (!normalised) {
        ctx.addIssue({
          code: "custom",
          message:
            "NEXT_PUBLIC_SUPABASE_URL must be a bare project origin, e.g. https://<ref>.supabase.co (no path, no trailing slash).",
        });
        return z.NEVER;
      }
      return normalised;
    }),
  anonKey: z.string().min(1),
});

/**
 * True while Next.js is collecting page data / prerendering during `next build`.
 *
 * Used ONLY to improve the diagnostic. It never relaxes validation: a route
 * that reaches Supabase at build time is misconfigured, and silently injecting
 * placeholder credentials would turn a loud build failure into a page that
 * renders, caches, and then breaks for real users.
 */
function isBuildPhase(): boolean {
  return (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PHASE === "phase-export"
  );
}

/**
 * Reports exactly WHICH variable is wrong and WHY, then throws.
 *
 * The previous single message ("Supabase is not configured") was the same for a
 * missing URL, a missing key, and a malformed URL. On Vercel all three look
 * identical in the log, so the operator has to guess. `error.flatten()` names
 * the offending field; the shape hints below cover the mistakes that are common
 * in a dashboard copy-paste.
 */
function describeSupabaseEnvFailure(error: z.ZodError): string {
  const flat = error.flatten();
  const fieldErrors = flat.fieldErrors as Record<string, string[] | undefined>;
  const bad = Object.entries(fieldErrors)
    .filter(([, msgs]) => msgs && msgs.length > 0)
    .map(([field, msgs]) => `  - ${field}: ${msgs!.join("; ")}`);

  const hints: string[] = [];
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) {
    hints.push("  NEXT_PUBLIC_SUPABASE_URL is not set at all.");
  } else if (/\/auth\/v1\/?$/.test(rawUrl.trim())) {
    hints.push(
      `  NEXT_PUBLIC_SUPABASE_URL ends in /auth/v1 (got ${JSON.stringify(rawUrl)}). ` +
        "Use the bare project origin, e.g. https://<ref>.supabase.co",
    );
  } else if (rawUrl.trim().endsWith("/")) {
    hints.push(
      `  NEXT_PUBLIC_SUPABASE_URL has a trailing slash (got ${JSON.stringify(rawUrl)}).`,
    );
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    hints.push("  NEXT_PUBLIC_SUPABASE_ANON_KEY is not set at all.");
  }

  return [
    "Supabase is not configured. Check the server environment.",
    isBuildPhase()
      ? "  (This was thrown during `next build`, which means a per-user route was " +
        "prerendered. Authenticated layouts must declare `export const dynamic = \"force-dynamic\"`.)"
      : "",
    flat.formErrors.length > 0 ? `  errors: ${flat.formErrors.join("; ")}` : "",
    ...bad,
    ...hints,
  ]
    .filter(Boolean)
    .join("\n");
}

export function getSupabaseConfig() {
  const result = supabaseSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!result.success) {
    const detail = describeSupabaseEnvFailure(result.error);
    /*
     * Print to stdout AND stderr: Vercel surfaces build-time stdout in the
     * build log, while runtime errors surface from the thrown exception. Emitting
     * to both means the message is visible whichever phase failed.
     */
    console.error(detail);
    throw new Error(detail);
  }

  return result.data;
}

export function getServiceRoleKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Supabase service credentials are not configured.");
  return key;
}

export function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret)
    throw new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.",
    );
  return { cloudName, apiKey, apiSecret };
}

export function getPinPepper() {
  const pepper = process.env.GALLERY_PIN_PEPPER;
  if (!pepper || pepper.length < 43)
    throw new Error(
      "GALLERY_PIN_PEPPER must contain at least 32 random bytes encoded as base64url.",
    );
  return pepper;
}
