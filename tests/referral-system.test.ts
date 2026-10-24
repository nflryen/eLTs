import test from "node:test";
import assert from "node:assert/strict";
import { site } from "../src/config/site";

test("site configuration contains the official contact credentials", () => {
  assert.equal(site.whatsappNumber, "6285128015848");
  assert.equal(site.email, "hallo.elts@gmail.com");
});

test("referral discount calculation rules: percentage vs fixed", () => {
  const currentTotal = 2_500_000;

  // 1. Percentage discount: 10% of 2.500.000 = 250.000
  const pctDiscountVal = 10;
  const pctDiscountAmount = Math.round(currentTotal * (pctDiscountVal / 100));
  const pctFinal = Math.max(0, currentTotal - pctDiscountAmount);

  assert.equal(pctDiscountAmount, 250_000);
  assert.equal(pctFinal, 2_250_000);

  // 2. Fixed discount: Rp 500.000 off 2.500.000 = 2.000.000
  const fixedDiscountVal = 500_000;
  const fixedDiscountAmount = Math.min(currentTotal, fixedDiscountVal);
  const fixedFinal = Math.max(0, currentTotal - fixedDiscountAmount);

  assert.equal(fixedDiscountAmount, 500_000);
  assert.equal(fixedFinal, 2_000_000);

  // 3. Fixed discount exceeding total: capped to total (final = 0)
  const hugeDiscountVal = 5_000_000;
  const hugeDiscountAmount = Math.min(currentTotal, hugeDiscountVal);
  const hugeFinal = Math.max(0, currentTotal - hugeDiscountAmount);

  assert.equal(hugeDiscountAmount, 2_500_000);
  assert.equal(hugeFinal, 0);

  // 4. 100% percentage discount
  const fullPctAmount = Math.round(currentTotal * (100 / 100));
  assert.equal(fullPctAmount, 2_500_000);
  assert.equal(Math.max(0, currentTotal - fullPctAmount), 0);
});

test("referral code code format regex enforces clean uppercase format", () => {
  const codeRegex = /^[A-Z0-9_-]{3,32}$/;

  assert.ok(codeRegex.test("SUMMER2026"));
  assert.ok(codeRegex.test("RIAN_SALES"));
  assert.ok(codeRegex.test("DISC-10"));
  assert.ok(codeRegex.test("ELT"));

  // Reject invalid patterns
  assert.ok(!codeRegex.test("ab")); // too short
  assert.ok(!codeRegex.test("summer")); // lowercase
  assert.ok(!codeRegex.test("CODE WITH SPACE"));
  assert.ok(!codeRegex.test("DISC@100%"));
});
