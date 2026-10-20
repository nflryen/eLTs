/**
 * URL construction and sanitisation helpers.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A production login failed with "Invalid path specified in request URL". The
 * cause is a class of bug, not one typo: values that travel from an environment
 * variable or a query parameter into a URL are concatenated without ever being
 * normalised. Three distinct shapes of that bug were reachable here:
 *
 *   1. `NEXT_PUBLIC_SUPABASE_URL` with a trailing slash. `@supabase/supabase-js`
 *      joins it as `${url}/auth/v1`, so `https://ref.supabase.co/` becomes
 *      `https://ref.supabase.co//auth/v1` — a double-slash path. Normalised here.
 *   2. The same variable with a path suffix already appended
 *      (`.../auth/v1`), which produces `.../auth/v1/auth/v1` and 404s every auth
 *      call with a misleading error.
 *   3. A `redirectedFrom` value containing backslashes, `..` segments, or a
 *      doubled slash. Browsers treat `\` as `/`, so `/admin\..\x` is a traversal
 *      attempt that a naive `startsWith('/admin')` check happily passes.
 *
 * Everything here is pure and dependency-free so it can be unit-tested without
 * a server, a network, or a Supabase project.
 */

/**
 * Normalises a base URL: trims whitespace, drops trailing slashes, and strips a
 * redundant `/auth/v1` suffix that the Supabase SDK appends itself.
 *
 * Returns `null` for anything that is not a valid http(s) origin, so a
 * misconfigured environment fails loudly at the boundary instead of producing a
 * malformed request later.
 */
export function normaliseBaseUrl(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  /*
   * Reject a path that already contains the SDK's own suffix. Accepting it would
   * silently produce `<base>/auth/v1/auth/v1`, where every auth call returns a
   * 404 whose message ("Invalid path specified in request URL") points at the
   * request rather than at the configuration value that caused it.
   */
  const path = parsed.pathname.replace(/\/+$/, "");
  const cleanedPath = path.replace(/\/auth\/v1$/, "").replace(/\/+$/, "");

  return `${parsed.origin}${cleanedPath}`;
}

/**
 * Validates and normalises a Supabase project URL specifically.
 *
 * Rejects a URL that carries a path beyond the project root, because the SDK
 * always appends `/auth/v1` and `/rest/v1` itself. A path here is always a
 * configuration error, never intentional.
 */
export function normaliseSupabaseUrl(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  /*
   * Inspect the ORIGINAL pathname, not the one `normaliseBaseUrl` cleaned.
   *
   * That helper strips a trailing `/auth/v1` because the SDK appends its own —
   * which is the right repair for a non-Supabase base, but here it would make a
   * genuinely wrong configuration look valid. A Supabase project URL carrying a
   * path is always a mistake, and silently "fixing" it hides the mistake while
   * possibly targeting the wrong resource. Reject it so the operator sees it.
   */
  const path = parsed.pathname.replace(/\/+$/, "");
  if (path !== "") return null;

  return parsed.origin;
}

/** Collapses repeated slashes inside a path. Does not touch the scheme. */
function collapseSlashes(path: string): string {
  return path.replace(/\/{2,}/g, "/");
}

/**
 * Resolves a `..`/`.` segment sequence. `URL` does this for us, but only on an
 * absolute URL, so a throwaway origin is used and its pathname returned.
 */
function resolveDotSegments(path: string): string {
  try {
    return new URL(path, "https://internal.invalid").pathname;
  } catch {
    return "/";
  }
}

/**
 * Sanitises a post-login return path.
 *
 * Guarantees:
 *   - result always begins with exactly one `/`
 *   - no backslashes (browsers treat `\` as `/`, so `/\evil.com` is `//evil.com`)
 *   - no `..` or `.` segments
 *   - no doubled slashes
 *   - no scheme, no host, no protocol-relative form
 *
 * Returns `null` when the value cannot be made safe, so the caller falls back
 * to its own default.
 */
export function sanitiseReturnPath(
  raw: string | undefined | null,
  allowedPrefixes: readonly string[] = ["/admin", "/settings"],
): string | null {
  if (typeof raw !== "string") return null;

  let value = raw.trim();
  if (!value) return null;

  /* A percent-encoded leading slash arrives as "%2Fadmin"; decode before checking. */
  if (/^%2f/i.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  /* Absolute or protocol-relative URLs are never valid return paths. */
  if (value.includes("://")) return null;

  /* Normalise backslashes to forward slashes BEFORE the `//` check, because
     `/\evil.com` is protocol-relative to a browser but not to startsWith(). */
  value = value.replace(/\\/g, "/");

  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;

  /* Split query/hash off so dot segments in the path are resolved correctly. */
  const [rawPath, ...rest] = value.split(/(?=[?#])/);
  const suffix = rest.join("");

  const resolved = resolveDotSegments(collapseSlashes(rawPath));

  /* Re-check AFTER resolution: `/admin/../etc` resolves to `/etc`, which is not allowed. */
  if (!resolved.startsWith("/")) return null;
  if (resolved.startsWith("//")) return null;

  const permitted = allowedPrefixes.some(
    (prefix) => resolved === prefix || resolved.startsWith(`${prefix}/`),
  );
  if (!permitted) return null;

  return `${resolved}${suffix}`;
}

/**
 * Builds an absolute URL for `emailRedirectTo` and similar links, without ever
 * producing `https://host//path` or `https://host/path/path`.
 */
export function absoluteUrl(
  base: string | undefined | null,
  path: string,
): string | null {
  const origin = normaliseBaseUrl(base);
  if (!origin) return null;

  const safePath = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${collapseSlashes(safePath)}`;
}
