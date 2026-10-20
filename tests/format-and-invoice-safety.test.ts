import test from "node:test";
import assert from "node:assert/strict";
import { idr } from "../src/lib/format";

/*
 * Regression: /admin/invoices crashed with
 *   "Cannot read properties of undefined (reading 'toLocaleString')"
 * at src/lib/format.ts inside idr(), called from invoice-panel.tsx while
 * rendering a line item whose `subtotal` was absent.
 *
 * A formatter is called directly from render, so it must never be able to take
 * a page down. These assertions pin that contract.
 */

test("idr never throws on absent or non-finite amounts", () => {
  /* The exact production failure: undefined from a missing subtotal. */
  assert.doesNotThrow(() => idr(undefined as unknown as number));
  assert.doesNotThrow(() => idr(null as unknown as number));
  assert.doesNotThrow(() => idr(NaN));
  assert.doesNotThrow(() => idr(Infinity));

  assert.equal(idr(undefined as unknown as number), "Rp 0");
  assert.equal(idr(null as unknown as number), "Rp 0");
  assert.equal(idr(NaN), "Rp 0");
  assert.equal(idr(Infinity), "Rp 0");
});

test("idr formats real amounts unchanged", () => {
  assert.equal(idr(0), "Rp 0");
  assert.equal(idr(15000000), "Rp 15.000.000");
  assert.equal(idr(350000), "Rp 350.000");
  assert.equal(idr(1234.56), "Rp 1.234,56");
});

test("a line item without subtotal still produces a complete render model", () => {
  /*
   * Mirrors the read-side normalisation in invoice-actions.ts: subtotal is
   * derived from quantity x unit_price when the stored row omits it.
   */
  const raw = [{ description: "Baseline editorial coverage", quantity: 1, unit_price: 15000000 }];

  const normalised = raw.map((li) => {
    const quantity = Number(li.quantity ?? 0);
    const unitPrice = Number(li.unit_price ?? 0);
    const stored = Number((li as { subtotal?: number }).subtotal);
    return {
      ...li,
      subtotal: Number.isFinite(stored) ? stored : Math.round(quantity * unitPrice),
    };
  });

  assert.equal(normalised[0].subtotal, 15000000);
  assert.doesNotThrow(() => idr(normalised[0].subtotal));
  assert.equal(idr(normalised[0].subtotal), "Rp 15.000.000");
});
