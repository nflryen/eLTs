import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error pg types not installed
import { Client } from "pg";
import { generateGalleryCredentials, hashGalleryPin, createOpaqueSession } from "../src/lib/security/credentials";

test("hybrid proofing workflow: magic token, quota enforcement, and Google Drive gate", async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("Skipping DB test: no DATABASE_URL");
    return;
  }

  const pg = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const testCustId = "a0000000-0000-0000-0000-000000000077";
  const testProjId = "b0000000-0000-0000-0000-000000000077";

  try {
    // 1. Clean prior remnants
    await pg.query("delete from public.projects where id = $1", [testProjId]);
    await pg.query("delete from public.customers where id = $1", [testCustId]);

    // 2. Insert customer
    await pg.query(
      "insert into public.customers (id, name, email, phone) values ($1, $2, $3, $4)",
      [testCustId, "Proofing Test Client", "proofing@example.com", "08123456789"]
    );

    const creds = generateGalleryCredentials();
    const pinHash = await hashGalleryPin(creds.pin, "a".repeat(45));

    // 3. Insert project with quotas and Google Drive URL
    await pg.query(
      `insert into public.projects (
        id, customer_id, name, slug, service_pillar, photography_type, gallery_code, gallery_pin_hash,
        access_token, shoot_date, status, contract_value, dp_amount, selection_quota_min, selection_quota_max,
        sector_specs, is_fully_paid
      ) values ($1, $2, $3, $4, 'EVENT_GRADUATION_PHOTO', 'graduation', $5, $6, $7, '2026-11-20', 'ready', 1500000, 750000, 2, 4, $8, false)`,
      [
        testProjId,
        testCustId,
        "Proofing Quota & Drive Test",
        "proofing-quota-test",
        creds.galleryCode,
        pinHash,
        creds.accessToken,
        JSON.stringify({ googleDriveUrl: "https://drive.google.com/drive/folders/test12345" }),
      ]
    );

    // 4. Verify access_token lookup works
    const projQuery = await pg.query("select id, access_token, sector_specs from public.projects where access_token = $1", [creds.accessToken]);
    assert.equal(projQuery.rows.length, 1);
    assert.equal(projQuery.rows[0].id, testProjId);
    assert.equal(projQuery.rows[0].sector_specs.googleDriveUrl, "https://drive.google.com/drive/folders/test12345");

    // 5. Test session creation via RPC create_gallery_session (Magic Link Backend)
    const { token: _sessionToken, tokenHash } = createOpaqueSession();
    const sessionRes = await pg.query(
      "select * from public.create_gallery_session($1, $2, $3, null)",
      [testProjId, pinHash, tokenHash]
    );
    assert.ok(sessionRes.rows.length > 0);
    const sessionId = sessionRes.rows[0].session_id;
    assert.ok(sessionId, "Session ID must be returned");

    // 6. Insert 5 mock photos for this project
    const mediaIds: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const mRes = await pg.query(
        `insert into public.media (
          project_id, type, file_name, mime_type, storage_provider, original_key, file_size
        ) values ($1, 'image', $2, 'image/jpeg', 'cloudinary', $3, 2500000) returning id`,
        [testProjId, `DSC_${1000 + i}.jpg`, `test/photo_${i}.jpg`]
      );
      mediaIds.push(mRes.rows[0].id);
    }
    assert.equal(mediaIds.length, 5);

    // 7. Test Quota Enforcement: Client with 0 photos (< quota_min 2) -> submit MUST fail
    await assert.rejects(
      async () => {
        await pg.query("select public.submit_photo_selection($1, $2)", [testProjId, sessionId]);
      },
      (err: unknown) => {
        const pgErr = err as { message?: string };
        assert.match(pgErr.message ?? "", /below minimum quota/i);
        return true;
      }
    );

    // 8. Client selects 3 photos (satisfies min 2 and max 4) -> submit MUST succeed
    await pg.query(
      "insert into public.favorites (project_id, media_id, session_id) values ($1, $2, $4), ($1, $3, $4), ($1, $5, $4)",
      [testProjId, mediaIds[0], mediaIds[1], sessionId, mediaIds[2]]
    );
    const submitRes = await pg.query("select public.submit_photo_selection($1, $2)", [testProjId, sessionId]);
    assert.ok(submitRes.rows[0].submit_photo_selection.success);
    assert.equal(submitRes.rows[0].submit_photo_selection.deliverable_count, 3);

    // Verify project is locked
    const lockedProject = await pg.query("select selection_locked_at from public.projects where id = $1", [testProjId]);
    assert.ok(lockedProject.rows[0].selection_locked_at, "Project must be locked");

    // Verify editor_tasks row created with manifest
    const taskRes = await pg.query("select id, deliverable_count, manifest_json from public.editor_tasks where project_id = $1", [testProjId]);
    assert.equal(taskRes.rows.length, 1);
    assert.equal(taskRes.rows[0].deliverable_count, 3);
    assert.equal(taskRes.rows[0].manifest_json.length, 3);

    // 9. Verify Google Drive Gate: when unpaid, gated; when fully paid, unlocked
    const unpaidCheck = await pg.query("select is_fully_paid, sector_specs->>'googleDriveUrl' as drive_url from public.projects where id = $1", [testProjId]);
    assert.equal(unpaidCheck.rows[0].is_fully_paid, false);

    // Flip to paid
    await pg.query("update public.projects set is_fully_paid = true where id = $1", [testProjId]);
    const paidCheck = await pg.query("select is_fully_paid, sector_specs->>'googleDriveUrl' as drive_url from public.projects where id = $1", [testProjId]);
    assert.equal(paidCheck.rows[0].is_fully_paid, true);
    assert.ok(paidCheck.rows[0].drive_url.startsWith("https://drive.google.com"));
  } finally {
    await pg.query("delete from public.projects where id = $1", [testProjId]);
    await pg.query("delete from public.customers where id = $1", [testCustId]);
    await pg.end();
  }
});
