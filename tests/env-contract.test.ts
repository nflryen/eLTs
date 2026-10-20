import test from "node:test";
import assert from "node:assert/strict";
import { normaliseSupabaseUrl } from "../src/lib/url";

/*
 * Environment contract tests.
 *
 * These pin the exact behaviour that caused a production outage: a deployment
 * whose NEXT_PUBLIC_SUPABASE_URL held a non-origin value rendered every admin
 * route as a 500. Each case below is a real shape the Supabase dashboard can
 * put on the clipboard.
 */

test("the bare project origin is accepted", () => {
  assert.equal(normaliseSupabaseUrl("https://ref.supabase.co"), "https://ref.supabase.co");
});

test("a trailing slash is normalised, not rejected", () => {
  /* This is the single most likely paste artefact, and it is harmless. */
  for (const input of [
    "https://ref.supabase.co/",
    "https://ref.supabase.co//",
    "  https://ref.supabase.co/  ",
    "\thttps://ref.supabase.co\n",
  ]) {
    assert.equal(
      normaliseSupabaseUrl(input),
      "https://ref.supabase.co",
      `expected normalisation for ${JSON.stringify(input)}`,
    );
  }
});

test("the REST and Auth endpoints are rejected, not silently repaired", () => {
  /*
   * These are the values the Supabase dashboard offers for API access. They
   * look valid, and the SDK would then append its own `/auth/v1`, producing
   * `.../rest/v1/auth/v1`. Repairing them silently would hide a real
   * misconfiguration, so they must fail loudly.
   */
  assert.equal(normaliseSupabaseUrl("https://ref.supabase.co/rest/v1"), null);
  assert.equal(normaliseSupabaseUrl("https://ref.supabase.co/rest/v1/"), null);
  assert.equal(normaliseSupabaseUrl("https://ref.supabase.co/auth/v1"), null);
  assert.equal(normaliseSupabaseUrl("https://ref.supabase.co/auth/v1/"), null);
});

test("malformed values are rejected", () => {
  assert.equal(normaliseSupabaseUrl(""), null);
  assert.equal(normaliseSupabaseUrl(undefined), null);
  assert.equal(normaliseSupabaseUrl(null), null);
  assert.equal(normaliseSupabaseUrl("ref.supabase.co"), null, "missing scheme");
  assert.equal(normaliseSupabaseUrl("ftp://ref.supabase.co"), null, "wrong scheme");
  assert.equal(normaliseSupabaseUrl("https://"), null);
});

test("the SDK-visible auth URL is well formed for every accepted input", () => {
  /*
   * Mirrors what @supabase/supabase-js builds: `${url}/auth/v1`. If this ever
   * regresses the failure is a runtime login error, so assert it here instead.
   */
  for (const input of [
    "https://ref.supabase.co",
    "https://ref.supabase.co/",
    "https://ref.supabase.co//",
    "  https://ref.supabase.co  ",
  ]) {
    const base = normaliseSupabaseUrl(input);
    assert.ok(base, `expected ${JSON.stringify(input)} to be accepted`);
    const authPath = new URL(`${base}/auth/v1`).pathname;
    assert.equal(authPath, "/auth/v1", `bad auth path for ${JSON.stringify(input)}`);
    assert.doesNotMatch(authPath, /\/\//, "path must not contain a doubled slash");
  }
});
