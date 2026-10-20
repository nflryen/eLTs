import test from "node:test";
import assert from "node:assert/strict";
import {
  absoluteUrl,
  normaliseBaseUrl,
  normaliseSupabaseUrl,
  sanitiseReturnPath,
} from "../src/lib/url";

/*
 * Regression suite for the production login failure:
 *   "Invalid path specified in request URL"
 *
 * Root cause was a class of bug, not a single typo: values travelling from an
 * environment variable or a query parameter into a URL were concatenated without
 * normalisation.
 */

/* ──────────────────────────────────────────────────────────────────────────
 * 1. Supabase base URL: the trailing-slash matrix
 * ────────────────────────────────────────────────────────────────────────── */
test("normaliseSupabaseUrl strips trailing slashes so the SDK never builds //auth/v1", () => {
  const expected = "https://ref.supabase.co";

  /* The exact three shapes that matter: no slash, one slash, two slashes. */
  assert.equal(normaliseSupabaseUrl("https://ref.supabase.co"), expected);
  assert.equal(normaliseSupabaseUrl("https://ref.supabase.co/"), expected);
  assert.equal(normaliseSupabaseUrl("https://ref.supabase.co//"), expected);

  /* Surrounding whitespace from a copy-pasted dashboard value. */
  assert.equal(normaliseSupabaseUrl("  https://ref.supabase.co  "), expected);
  assert.equal(normaliseSupabaseUrl("\nhttps://ref.supabase.co/\t"), expected);
});

test("normaliseSupabaseUrl rejects a path suffix that would double up with /auth/v1", () => {
  /*
   * The SDK appends `/auth/v1` itself. A stored value that already contains it
   * produced `.../auth/v1/auth/v1`, and every auth call 404'd.
   */
  assert.equal(normaliseSupabaseUrl("https://ref.supabase.co/auth/v1"), null);
  assert.equal(normaliseSupabaseUrl("https://ref.supabase.co/rest/v1"), null);
});

test("normaliseSupabaseUrl rejects non-http(s) and malformed values", () => {
  assert.equal(normaliseSupabaseUrl(""), null);
  assert.equal(normaliseSupabaseUrl(undefined), null);
  assert.equal(normaliseSupabaseUrl(null), null);
  assert.equal(normaliseSupabaseUrl("not a url"), null);
  assert.equal(normaliseSupabaseUrl("ftp://ref.supabase.co"), null);
  assert.equal(normaliseSupabaseUrl("//ref.supabase.co"), null);
});

test("the SDK-visible auth endpoint is well formed for every accepted input", () => {
  /*
   * Mirrors what @supabase/supabase-js does: `${url}/auth/v1`. If normalisation
   * ever regresses, this assertion fails with the malformed path in the message
   * rather than surfacing later as a production login error.
   */
  for (const input of [
    "https://ref.supabase.co",
    "https://ref.supabase.co/",
    "https://ref.supabase.co//",
  ]) {
    const base = normaliseSupabaseUrl(input)!;
    const authUrl = new URL(`${base}/auth/v1`);
    assert.equal(authUrl.pathname, "/auth/v1", `bad auth path for ${JSON.stringify(input)}`);
    assert.equal(authUrl.host, "ref.supabase.co");
    assert.doesNotMatch(authUrl.pathname, /\/\//, "path must not contain a doubled slash");
  }
});

/* ──────────────────────────────────────────────────────────────────────────
 * 2. Return-path sanitisation
 * ────────────────────────────────────────────────────────────────────────── */
test("sanitiseReturnPath accepts clean relative paths", () => {
  assert.equal(sanitiseReturnPath("/admin"), "/admin");
  assert.equal(sanitiseReturnPath("/admin/finance"), "/admin/finance");
  assert.equal(sanitiseReturnPath("/settings/profile"), "/settings/profile");
  assert.equal(
    sanitiseReturnPath("/settings/security?denied=super_admin_required"),
    "/settings/security?denied=super_admin_required",
  );
});

test("sanitiseReturnPath refuses open-redirect and traversal shapes", () => {
  for (const hostile of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example", // browser reads \ as /, so this is protocol-relative
    "/admin\\..\\x",
    "/admin/../etc",
    "/admin/../../etc/passwd",
    "javascript:alert(1)",
    "admin", // no leading slash
    "",
  ]) {
    assert.equal(
      sanitiseReturnPath(hostile),
      null,
      `must refuse ${JSON.stringify(hostile)}`,
    );
  }
});

test("sanitiseReturnPath collapses doubled slashes and resolves dot segments", () => {
  assert.equal(sanitiseReturnPath("/admin//finance"), "/admin/finance");
  assert.equal(sanitiseReturnPath("/admin/./finance"), "/admin/finance");
  assert.equal(sanitiseReturnPath("/admin/finance/"), "/admin/finance/");
});

test("sanitiseReturnPath decodes a percent-encoded leading slash", () => {
  /* `?redirectedFrom=%2Fsettings%2Fsecurity` arrives decoded by Next, but a
     double-encoded value still reaches us as "%2F..." and must be handled. */
  assert.equal(sanitiseReturnPath("%2Fsettings%2Fsecurity"), "/settings/security");
  assert.equal(sanitiseReturnPath("%2fadmin"), "/admin");
});

test("sanitiseReturnPath enforces the allowed prefixes", () => {
  assert.equal(sanitiseReturnPath("/etc/passwd"), null);
  assert.equal(sanitiseReturnPath("/adminfoo"), null, "prefix must be a segment, not a substring");
  assert.equal(sanitiseReturnPath("/settingsfoo"), null);
});

/* ──────────────────────────────────────────────────────────────────────────
 * 3. Absolute URL construction
 * ────────────────────────────────────────────────────────────────────────── */
test("absoluteUrl never produces a doubled slash regardless of base form", () => {
  const expected = "https://elts.id/settings/security?email=confirmed";
  assert.equal(absoluteUrl("https://elts.id", "/settings/security?email=confirmed"), expected);
  assert.equal(absoluteUrl("https://elts.id/", "/settings/security?email=confirmed"), expected);
  assert.equal(absoluteUrl("https://elts.id//", "/settings/security?email=confirmed"), expected);
  assert.equal(
    absoluteUrl("https://elts.id", "settings/security?email=confirmed"),
    expected,
    "path without a leading slash must still work",
  );
});

test("absoluteUrl returns null for an unusable base so the caller can omit the parameter", () => {
  assert.equal(absoluteUrl("", "/x"), null);
  assert.equal(absoluteUrl(undefined, "/x"), null);
  assert.equal(absoluteUrl("not-a-url", "/x"), null);
});

test("normaliseBaseUrl keeps a sub-path for non-Supabase bases", () => {
  /* APP_URL may legitimately be served from a sub-path; only Supabase must be bare. */
  assert.equal(normaliseBaseUrl("https://example.com/app/"), "https://example.com/app");
  assert.equal(normaliseBaseUrl("https://example.com/"), "https://example.com");
});
