import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error pg declaration file not installed in devDependencies
import { Client } from "pg";

test("database trigger enforces updated project status transitions", async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("Skipping DB test: no DATABASE_URL");
    return;
  }

  const pg = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const testCustId = "a0000000-0000-0000-0000-000000000099";
  const testProjId = "b0000000-0000-0000-0000-000000000099";

  try {
    // Clean any prior remnants
    await pg.query("delete from public.projects where id = $1", [testProjId]);
    await pg.query("delete from public.customers where id = $1", [testCustId]);

    // Insert customer
    await pg.query(
      "insert into public.customers (id, name, email, phone) values ($1, $2, $3, $4)",
      [testCustId, "QA Transition Tester", "qa.transition@example.com", "08123456789"]
    );

    // 1. Insert project in 'draft'
    const { generateGalleryCredentials, hashGalleryPin } = await import("../src/lib/security/credentials");
    const creds = generateGalleryCredentials();
    const pinHash = await hashGalleryPin(creds.pin, "a".repeat(45));
    await pg.query(
      `insert into public.projects (
        id, customer_id, name, slug, service_pillar, photography_type, gallery_code, gallery_pin_hash, access_token, shoot_date, status, contract_value, dp_amount
      ) values ($1, $2, $3, $4, 'EVENT_GRADUATION_PHOTO', $5, $6, $7, $8, $9, 'draft', 1000000, 300000)`,
      [testProjId, testCustId, "Draft to Ready Test", "draft-to-ready-test", "wedding", creds.galleryCode, pinHash, creds.accessToken, "2026-11-01"]
    );
    // 2. Direct transition draft -> ready (MUST SUCCEED)
    const updateRes = await pg.query(
      "update public.projects set status = 'ready' where id = $1 returning status",
      [testProjId]
    );
    assert.equal(updateRes.rows[0].status, "ready", "Status should transition to ready");

    // 3. Transition ready -> draft (MUST SUCCEED for corrections)
    const revertRes = await pg.query(
      "update public.projects set status = 'draft' where id = $1 returning status",
      [testProjId]
    );
    assert.equal(revertRes.rows[0].status, "draft", "Status should revert to draft");

    // 4. Illegal transition draft -> archived (MUST FAIL with 23514)
    await assert.rejects(
      async () => {
        await pg.query("update public.projects set status = 'archived' where id = $1", [testProjId]);
      },
      (err: unknown) => {
        const pgErr = err as { code?: string; message?: string };
        assert.equal(pgErr.code, "23514");
        assert.match(pgErr.message ?? "", /Invalid project status transition: draft -> archived/);
        return true;
      }
    );

    // 5. Transition draft -> editing -> ready -> archived (MUST SUCCEED)
    await pg.query("update public.projects set status = 'editing' where id = $1", [testProjId]);
    await pg.query("update public.projects set status = 'ready' where id = $1", [testProjId]);
    await pg.query("update public.projects set status = 'archived' where id = $1", [testProjId]);

    const finalRow = await pg.query("select status from public.projects where id = $1", [testProjId]);
    assert.equal(finalRow.rows[0].status, "archived");
  } finally {
    await pg.query("delete from public.projects where id = $1", [testProjId]);
    await pg.query("delete from public.customers where id = $1", [testCustId]);
    await pg.end();
  }
});
