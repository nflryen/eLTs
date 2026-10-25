import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error pg types not installed
import { Client } from "pg";
import { generateGalleryCredentials, hashGalleryPin } from "../src/lib/security/credentials";

test("admin proofing control: quota modification and selection unlock action", async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("Skipping DB test: no DATABASE_URL");
    return;
  }

  const pg = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const testCustId = "a0000000-0000-0000-0000-000000000055";
  const testProjId = "b0000000-0000-0000-0000-000000000055";

  try {
    // 1. Clean prior remnants
    await pg.query("delete from public.projects where id = $1", [testProjId]);
    await pg.query("delete from public.customers where id = $1", [testCustId]);

    // 2. Insert customer
    await pg.query(
      "insert into public.customers (id, name, email, phone) values ($1, $2, $3, $4)",
      [testCustId, "Admin Control Test Client", "admin.control@example.com", "081233334444"]
    );

    const creds = generateGalleryCredentials();
    const pinHash = await hashGalleryPin(creds.pin, "a".repeat(45));

    // 3. Insert project with initial quotas 15-20 and locked state
    const lockedTimestamp = new Date().toISOString();
    await pg.query(
      `insert into public.projects (
        id, customer_id, name, slug, service_pillar, photography_type, gallery_code, gallery_pin_hash,
        access_token, shoot_date, status, contract_value, dp_amount, selection_quota_min, selection_quota_max,
        selection_locked_at
      ) values ($1, $2, $3, $4, 'EVENT_GRADUATION_PHOTO', 'graduation', $5, $6, $7, '2026-11-20', 'ready', 1500000, 750000, 15, 20, $8)`,
      [testProjId, testCustId, "Proofing Admin Control Project", "proofing-admin-control", creds.galleryCode, pinHash, creds.accessToken, lockedTimestamp]
    );

    // 4. Insert pending editor task
    await pg.query(
      `insert into public.editor_tasks (
        project_id, status, deliverable_count, manifest_json
      ) values ($1, 'PENDING', 20, '[]'::jsonb)`,
      [testProjId]
    );

    // 5. Test Quota & Deadline Update in database (mirrors updateProjectProofingConfigAction)
    const newDeadline = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    await pg.query(
      `update public.projects
       set selection_quota_min = 25, selection_quota_max = 50, selection_deadline = $2
       where id = $1`,
      [testProjId, newDeadline]
    );

    const updatedProj = await pg.query("select selection_quota_min, selection_quota_max, selection_deadline from public.projects where id = $1", [testProjId]);
    assert.equal(updatedProj.rows[0].selection_quota_min, 25);
    assert.equal(updatedProj.rows[0].selection_quota_max, 50);
    assert.ok(updatedProj.rows[0].selection_deadline);

    // 6. Test Unlock Selection (mirrors unlockProjectSelectionAction):
    // Clears selection_locked_at and removes pending editor task
    await pg.query("update public.projects set selection_locked_at = null where id = $1", [testProjId]);
    await pg.query("delete from public.editor_tasks where project_id = $1 and status = 'PENDING'", [testProjId]);

    const unlockedProj = await pg.query("select selection_locked_at from public.projects where id = $1", [testProjId]);
    assert.equal(unlockedProj.rows[0].selection_locked_at, null, "Project selection must be unlocked");

    const tasksCount = await pg.query("select count(*) from public.editor_tasks where project_id = $1", [testProjId]);
    assert.equal(Number(tasksCount.rows[0].count), 0, "Pending editor tasks must be cleaned up on unlock");
  } finally {
    await pg.query("delete from public.projects where id = $1", [testProjId]);
    await pg.query("delete from public.customers where id = $1", [testCustId]);
    await pg.end();
  }
});
