import test from "node:test";
import assert from "node:assert/strict";
import { jktTodayIso, jktDayStartUtc, jktDayEndUtc, jktClock, jakartaClock, endOfMonth } from "../src/lib/dashboard/time";
import { failed, hidden, emptyZero, ok, isMeasured, numericOrNull, countMetric, measure } from "../src/lib/dashboard/metric";
import { FINANCE_VISIBILITY_RANK } from "../src/lib/dashboard/types";
import { ROLE_RANK } from "../src/lib/auth/role-meta";

test("today is the Jakarta calendar day, not the UTC day", () => {
  // 17:30 WIB is 10:30Z — same UTC date, but the point is the early-morning case.
  assert.equal(jktTodayIso(new Date("2026-10-19T17:30:00+07:00")), "2026-10-19");
  // 01:00 WIB on the 19th is 18:00Z on the 18th: UTC would say the 18th.
  assert.equal(jktTodayIso(new Date("2026-10-18T18:00:00Z")), "2026-10-19");
  // 23:59 WIB on the 19th is 16:59Z on the 19th.
  assert.equal(jktTodayIso(new Date("2026-10-19T23:59:00+07:00")), "2026-10-19");
});

test("a Jakarta day maps to the correct UTC window", () => {
  assert.equal(jktDayStartUtc("2026-10-19"), "2026-10-18T17:00:00.000Z");
  assert.equal(jktDayEndUtc("2026-10-19"), "2026-10-19T17:00:00.000Z");
  const span = Date.parse(jktDayEndUtc("2026-10-19")) - Date.parse(jktDayStartUtc("2026-10-19"));
  assert.equal(span, 24 * 60 * 60 * 1000);
});

test("jakartaClock renders wall-clock time and rejects junk", () => {
  assert.equal(jakartaClock("2026-10-19T00:30:00Z"), "07:30");
  assert.equal(jakartaClock("2026-10-19T17:30:00Z"), "00:30");
  assert.equal(jakartaClock("not-a-date"), null);
});

test("endOfMonth is an exclusive bound on the first of the next month", () => {
  assert.equal(endOfMonth("2026-10-01"), "2026-11-01");
  assert.equal(endOfMonth("2026-12-01"), "2027-01-01");
  assert.equal(endOfMonth("2026-01-01"), "2026-02-01");
});

test("an unmeasured metric never reads as zero", () => {
  assert.equal(numericOrNull(failed()), null);
  assert.equal(numericOrNull(hidden()), null);
  assert.notEqual(numericOrNull(failed()), 0);
  assert.equal(isMeasured(failed()), false);
  assert.equal(isMeasured(hidden()), false);
});

test("a measured empty keeps its honest zero", () => {
  assert.equal(numericOrNull(emptyZero()), 0);
  assert.equal(isMeasured(emptyZero()), true);
  assert.equal(numericOrNull(ok(7)), 7);
});

test("countMetric distinguishes zero from unknown", () => {
  assert.deepEqual(countMetric(0), { state: "empty", value: 0 });
  assert.deepEqual(countMetric(5), { state: "ok", value: 5 });
  assert.deepEqual(countMetric(null), { state: "error" });
  assert.deepEqual(countMetric(undefined), { state: "error" });
});

test("measure reads a count from a head:true response where data is null", async () => {
  // Regression: a head count resolves { data: null, count: N }. Treating the
  // null payload as failure silently blanked every count tile.
  const result = await measure(
    Promise.resolve({ data: null, count: 8, error: null }),
    ({ count }) => countMetric(count)
  );
  assert.deepEqual(result, { state: "ok", value: 8 });
});

test("measure surfaces a query error instead of returning a zero", async () => {
  const result = await measure(
    Promise.resolve({ data: null, count: null, error: { message: "boom" } }),
    ({ count }) => countMetric(count)
  );
  assert.equal(result.state, "error");
  assert.equal(numericOrNull(result), null);
});

test("measure catches a thrown client error", async () => {
  const result = await measure(Promise.reject(new Error("network")), ({ count }) => countMetric(count));
  assert.equal(result.state, "error");
});

test("finance visibility starts at FOUNDER and excludes ADMIN", () => {
  assert.equal(FINANCE_VISIBILITY_RANK, 100);
  assert.equal(ROLE_RANK.FOUNDER >= FINANCE_VISIBILITY_RANK, true);
  assert.equal(ROLE_RANK.SUPER_ADMIN >= FINANCE_VISIBILITY_RANK, true);
  assert.equal(ROLE_RANK.ADMIN >= FINANCE_VISIBILITY_RANK, false);
  assert.equal(ROLE_RANK.WORKER >= FINANCE_VISIBILITY_RANK, false);
});

test("a restricted payload carries no figure over the wire", () => {
  // Mirrors the server gate: hidden metrics replace the value entirely rather
  // than sending it with a flag the client could flip.
  const gated = (rank: number) => ({
    monthlyRevenue: rank >= FINANCE_VISIBILITY_RANK ? ok(9_999_999) : hidden<number>(),
  });
  const adminPayload = JSON.stringify(gated(ROLE_RANK.ADMIN));
  assert.equal(adminPayload.includes("9999999"), false);
  assert.equal(adminPayload.includes("hidden"), true);
  assert.equal(JSON.stringify(gated(ROLE_RANK.FOUNDER)).includes("9999999"), true);
});

test("jktClock agrees with jakartaClock at the same instant", () => {
  const iso = "2026-10-19T03:15:00Z";
  assert.equal(jktClock(new Date(iso)), jakartaClock(iso));
});

// ─── Fabricated financials (loadWorkspace purge) ────────────────────────────

test("no invented contract values survive in loadWorkspace", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/lib/workspace.ts", import.meta.url), "utf8");
  // The removed fallbacks guessed a price from the project NAME.
  assert.doesNotMatch(src, /fallbackContractValue/);
  assert.doesNotMatch(src, /isKomdigi\s*\?\s*25_?000_?000/);
  assert.doesNotMatch(src, /isWisuda\s*\?\s*15_?000_?000/);
  // A DP must never be derived from the contract again.
  assert.doesNotMatch(src, /Math\.round\(contractVal \* 0\.5\)/);
  // Payment state must come from the record, not the project name.
  assert.doesNotMatch(src, /is_dp_paid:\s*Boolean\(project\.is_dp_paid\)\s*\|\|/);
});

test("unset contract value stays null rather than becoming a number", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/lib/workspace.ts", import.meta.url), "utf8");
  assert.match(src, /function numOrNull/, "nullable money reader must exist");
  assert.match(src, /contract_value: number \| null/);
  assert.match(src, /dp_amount: number \| null/);
});
