import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error pg types not installed
import { Client } from "pg";
import { generateGalleryCredentials, hashGalleryPin } from "../src/lib/security/credentials";

test("database cascades allow clean project deletion with invoices and receipts", async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("Skipping DB test: no DATABASE_URL");
    return;
  }

  const pg = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const testCustId = "a0000000-0000-0000-0000-000000000088";
  const testProjId = "b0000000-0000-0000-0000-000000000088";
  const testInvId = "c0000000-0000-0000-0000-000000000088";
  const testRcpId = "d0000000-0000-0000-0000-000000000088";

  try {
    // Clean any prior remnants
    await pg.query("delete from public.projects where id = $1", [testProjId]);
    await pg.query("delete from public.customers where id = $1", [testCustId]);

    // Insert customer
    await pg.query(
      "insert into public.customers (id, name, email, phone) values ($1, $2, $3, $4)",
      [testCustId, "Cascade Test Client", "cascade@example.com", "08199998888"]
    );

    const creds = generateGalleryCredentials();
    const pinHash = await hashGalleryPin(creds.pin, "a".repeat(45));

    // 1. Insert project with referral code and discount
    await pg.query(
      `insert into public.projects (
        id, customer_id, name, slug, service_pillar, photography_type, gallery_code, gallery_pin_hash, access_token, shoot_date, status, contract_value, dp_amount, referral_code, referral_discount_amount
      ) values ($1, $2, $3, $4, 'EVENT_GRADUATION_PHOTO', 'wedding', $5, $6, $7, '2026-12-01', 'draft', 1485000, 742500, 'SPECIAL10', 165000)`,
      [testProjId, testCustId, "Cascade Project Test", "cascade-project-test", creds.galleryCode, pinHash, creds.accessToken]
    );

    // 2. Insert invoice
    await pg.query(
      `insert into public.project_invoices (
        id, project_id, invoice_number, issue_date, due_date, line_items, gross_contract_value, minimum_dp_pct, referral_code, referral_discount_amount
      ) values ($1, $2, 'INV/2026/10/9999', '2026-10-24', '2026-11-07', '[]'::jsonb, 1485000, 50, 'SPECIAL10', 165000)`,
      [testInvId, testProjId]
    );

    // 3. Insert payment receipt
    await pg.query(
      `insert into public.invoice_payment_receipts (
        id, invoice_id, receipt_number, amount, payment_method, applied_to, verified_at
      ) values ($1, $2, 'RCP/2026/10/9999', 742500, 'BANK_TRANSFER', 'DP', now())`,
      [testRcpId, testInvId]
    );

    // Verify row existence
    const checkBefore = await pg.query("select id from public.invoice_payment_receipts where id = $1", [testRcpId]);
    assert.equal(checkBefore.rows.length, 1);

    // 4. Delete the project directly — MUST CASCADE CLEANLY WITHOUT 23503 RESTRICT ERROR
    await pg.query("delete from public.projects where id = $1", [testProjId]);

    // Verify cascaded deletion
    const checkRcp = await pg.query("select id from public.invoice_payment_receipts where id = $1", [testRcpId]);
    assert.equal(checkRcp.rows.length, 0, "Receipt must be cascaded");

    const checkInv = await pg.query("select id from public.project_invoices where id = $1", [testInvId]);
    assert.equal(checkInv.rows.length, 0, "Invoice must be cascaded");

    const checkProj = await pg.query("select id from public.projects where id = $1", [testProjId]);
    assert.equal(checkProj.rows.length, 0, "Project must be deleted");
  } finally {
    await pg.query("delete from public.projects where id = $1", [testProjId]);
    await pg.query("delete from public.customers where id = $1", [testCustId]);
    await pg.end();
  }
});
