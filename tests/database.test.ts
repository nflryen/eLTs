import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Runs actual PostgreSQL migrations/RLS locally. Auth/Storage fixtures represent
// Supabase-owned schemas; hosted Supabase integration must still be checked.
test("PostgreSQL foundation constraints, RLS and access lifecycle", async (t) => {
  const db = new PGlite();
  const admin = "00000000-0000-0000-0000-000000000001";
  const outsider = "00000000-0000-0000-0000-000000000002";
  const projectA = "10000000-0000-0000-0000-000000000001";
  const projectB = "10000000-0000-0000-0000-000000000002";
  const mediaA = "20000000-0000-0000-0000-000000000001";
  const mediaB = "20000000-0000-0000-0000-000000000002";
  const sessionA = "30000000-0000-0000-0000-000000000001";
  const sessionB = "30000000-0000-0000-0000-000000000002";
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table auth.sessions(id uuid primary key, user_id uuid not null, created_at timestamptz not null default now(), updated_at timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      grant usage on schema auth, public to anon, authenticated, service_role;
      grant execute on function auth.uid() to authenticated, service_role;
    grant execute on function auth.jwt() to authenticated, service_role;
      create schema storage;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
      grant all on storage.objects to anon, authenticated, service_role;
    `);
    const migrationDirectory = new URL(
      "../supabase/migrations/",
      import.meta.url,
    );
    const migrations = (await readdir(migrationDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    assert.ok(migrations.length > 0, "Database tests require SQL migrations");
    for (const migration of migrations) {
      await db.exec(
        await readFile(new URL(migration, migrationDirectory), "utf8"),
      );
    }
    await db.exec(`
      insert into auth.users values ('${admin}'), ('${outsider}');
      insert into public.admins(user_id, display_name) values ('${admin}', 'Studio admin');
      insert into public.customers(id, name) values ('${admin}', 'Customer A'), ('${outsider}', 'Customer B');
      insert into public.projects(id, customer_id, name, slug, photography_type, gallery_code, gallery_pin_hash, access_token, status)
      values ('${projectA}', '${admin}', 'Project A', 'project-a', 'wedding', 'ELTS-AAAAAAAA', 'scrypt-v1$${"A".repeat(22)}$${"A".repeat(43)}', '${"A".repeat(43)}', 'ready'),
      ('${projectB}', '${outsider}', 'Project B', 'project-b', 'couple', 'ELTS-BBBBBBBB', 'scrypt-v1$${"B".repeat(22)}$${"B".repeat(43)}', '${"B".repeat(43)}', 'ready');
      insert into public.media(id, project_id, type, file_name, mime_type, original_key, file_size)
      values ('${mediaA}', '${projectA}', 'image', 'a.jpg', 'image/jpeg', '${projectA}/a.jpg', 1000),
      ('${mediaB}', '${projectB}', 'image', 'b.jpg', 'image/jpeg', '${projectB}/b.jpg', 1000);
      insert into private.gallery_sessions(id, project_id, token_hash, expires_at)
      values ('${sessionA}', '${projectA}', '${"a".repeat(64)}', now() + interval '1 day'),
      ('${sessionB}', '${projectB}', '${"b".repeat(64)}', now() + interval '1 day');
      insert into storage.objects(bucket_id, name) values ('gallery-originals', '${projectA}/a.jpg');
    `);

    await t.test(
      "upload finalization can save authenticated Cloudinary photos and videos",
      async () => {
        await db.exec("set role service_role");
        try {
          for (const [id, type, mime, extension, duration] of [
            [
              "20000000-0000-0000-0000-000000000003",
              "image",
              "image/jpeg",
              "jpg",
              null,
            ],
            [
              "20000000-0000-0000-0000-000000000004",
              "video",
              "video/mp4",
              "mp4",
              12.5,
            ],
          ] as const) {
            const publicId = `elts/${projectA}/${id}`;
            const result = await db.query<{
              id: string;
              type: string;
              cloudinary_delivery_type: string;
              processing_status: string;
            }>(
              `insert into public.media (
                id, project_id, type, file_name, mime_type, storage_provider,
                cloudinary_delivery_type, original_key, thumbnail_key,
                preview_key, cloudinary_public_id, width, height, file_size,
                duration_seconds, processing_status, sort_order
              ) values ($1, $2, $3, $4, $5, 'cloudinary', 'authenticated',
                $6, $7, $8, $6, 1920, 1080, 123456, $9, 'ready', 0)
              returning id, type, cloudinary_delivery_type, processing_status`,
              [
                id,
                projectA,
                type,
                `upload.${extension}`,
                mime,
                publicId,
                `/api/media/${id}/preview?variant=thumbnail`,
                `/api/media/${id}/preview?variant=preview`,
                duration,
              ],
            );
            assert.deepEqual(result.rows, [
              {
                id,
                type,
                cloudinary_delivery_type: "authenticated",
                processing_status: "ready",
              },
            ]);
          }
        } finally {
          await db.exec("reset role");
        }
      },
    );
    await t.test(
      "unsupported Cloudinary delivery types are rejected",
      async () => {
        await assert.rejects(
          db.query(
            "update public.media set cloudinary_delivery_type = 'public' where id = $1",
            [mediaB],
          ),
          /media_cloudinary_delivery_type_check/,
        );
        const legacy = await db.query<{
          cloudinary_delivery_type: string | null;
        }>("select cloudinary_delivery_type from public.media where id = $1", [
          mediaB,
        ]);
        assert.equal(legacy.rows[0].cloudinary_delivery_type, null);
      },
    );
    await t.test(
      "reapplying the delivery migration preserves existing records",
      async () => {
        /*
         * Snapshot only the columns this invariant is actually about:
         * row identity and the delivery columns the migration manages.
         *
         * A whole-row snapshot is too broad. 0001 legitimately backfills
         * `sector_specs` for rows where it is still '{}' (block 20.4) and
         * therefore bumps `updated_at`. Treating an intended backfill as
         * "data was destroyed" makes the test assert something nobody wants.
         */
        const snapshot = async () =>
          Promise.all(
            ["customers", "projects", "media"].map(
              async (table) =>
                (
                  await db.query<Record<string, unknown>>(
                    `select * from public.${table} order by id`,
                  )
                ).rows.map((row) => {
                  /*
                   * Intentionally excluded: columns 0001 may backfill on a
                   * re-run (see the comment above). The rest pattern derives the
                   * exclusion from the column list rather than repeating it, so
                   * a renamed column cannot drift out of sync. The `_` prefix is
                   * exempted by `varsIgnorePattern` in eslint.config.mjs.
                   */
                  const { sector_specs: _specs, updated_at: _updated, ...rest } = row;
                  return rest;
                }),
            ),
          );
        const before = await snapshot();
        /*
         * Re-apply the consolidated schema rather than the retired
         * 202609190001_gallery_access_and_delivery migration.
         *
         * That file now lives in `supabase/migrations-legacy/` because 0001
         * supersedes it and both defined `public.project_status` unguarded.
         * The invariant under test — "re-running the delivery DDL is
         * idempotent and does not destroy records" — is satisfied by 0001,
         * which carries the same `cloudinary_delivery_type` constraint in its
         * ADD COLUMN IF NOT EXISTS block.
         */
        await db.exec(
          await readFile(
            new URL("0001_consolidated_studio_os.sql", migrationDirectory),
            "utf8",
          ),
        );
        assert.deepEqual(await snapshot(), before);
      },
    );

    await t.test(
      "anonymous users cannot read customers, projects or private media",
      async () => {
        await db.exec("set role anon");
        try {
          for (const table of [
            "customers",
            "projects",
            "media",
            "favorites",
            "admins",
          ])
            await assert.rejects(
              db.query(`select * from public.${table}`),
              /permission denied/,
            );
          assert.equal(
            (await db.query("select * from storage.objects")).rows.length,
            0,
          );
        } finally {
          await db.exec("reset role");
        }
      },
    );
    await t.test(
      "normal authenticated users cannot read or mutate studio data or grant admin",
      async () => {
        await db.exec(
          `set role authenticated; set request.jwt.claim.sub = '${outsider}'`,
        );
        try {
          assert.equal(
            (await db.query("select * from public.projects")).rows.length,
            0,
          );
          assert.equal(
            (await db.query("select * from public.customers")).rows.length,
            0,
          );
          assert.equal(
            (await db.query("select * from storage.objects")).rows.length,
            0,
          );
          await assert.rejects(
            db.query("insert into public.customers(name) values ('No access')"),
            /row-level security/,
          );
          await assert.rejects(
            db.query(
              `insert into public.admins(user_id, display_name) values ('${outsider}', 'Self escalation')`,
            ),
            /permission denied/,
          );
          await assert.rejects(
            db.query("select * from private.gallery_sessions"),
            /permission denied/,
          );
          await assert.rejects(
            db.query("select * from public.consume_gallery_attempt('ip:test')"),
            /permission denied/,
          );
        } finally {
          await db.exec("reset role");
        }
      },
    );
    await t.test(
      "verified admin can access studio records but cannot manage admin membership",
      async () => {
        await db.exec(
          `set role authenticated; set request.jwt.claim.sub = '${admin}'`,
        );
        try {
          assert.equal(
            (await db.query("select * from public.projects")).rows.length,
            2,
          );
          assert.equal(
            (await db.query("select * from storage.objects")).rows.length,
            1,
          );
          assert.equal(
            (await db.query("select * from public.admins")).rows.length,
            1,
          );
          await assert.rejects(
            db.query(`delete from public.admins where user_id = '${admin}'`),
            /permission denied/,
          );
        } finally {
          await db.exec("reset role");
        }
      },
    );
    await t.test(
      "favorites cannot mix media or sessions from different projects",
      async () => {
        await assert.rejects(
          db.query(
            `insert into public.favorites(project_id, media_id, session_id) values ('${projectA}', '${mediaB}', '${sessionA}')`,
          ),
          /foreign key/,
        );
        await assert.rejects(
          db.query(
            `insert into public.favorites(project_id, media_id, session_id) values ('${projectA}', '${mediaA}', '${sessionB}')`,
          ),
          /foreign key/,
        );
        await db.query(
          `insert into public.favorites(project_id, media_id, session_id) values ('${projectA}', '${mediaA}', '${sessionA}')`,
        );
        await assert.rejects(
          db.query(
            `insert into public.favorites(project_id, media_id, session_id) values ('${projectA}', '${mediaA}', '${sessionA}')`,
          ),
          /unique constraint/,
        );
      },
    );
    await t.test("cover images cannot belong to another project", async () => {
      await assert.rejects(
        db.query(
          `update public.projects set cover_media_id = '${mediaB}' where id = '${projectA}'`,
        ),
        /foreign key/,
      );
    });
    await t.test(
      "plaintext PINs cannot be inserted into projects",
      async () => {
        await assert.rejects(
          db.query(
            `update public.projects set gallery_pin_hash = '123456' where id = '${projectA}'`,
          ),
          /check constraint/,
        );
      },
    );
    await t.test(
      "persistent rate limit allows only five requests per window",
      async () => {
        await db.exec("set role service_role");
        try {
          for (let i = 1; i <= 7; i++) {
            const result = await db.query<{
              allowed: boolean;
              retry_after_seconds: number;
            }>("select * from public.consume_gallery_attempt('ip:test')");
            assert.equal(result.rows[0].allowed, i <= 5);
            assert.ok(result.rows[0].retry_after_seconds > 0);
          }
        } finally {
          await db.exec("reset role");
        }
        await db.exec(
          "update private.gallery_rate_limits set resets_at = now() - interval '1 minute'",
        );
        assert.equal(
          (
            await db.query<{ allowed: boolean }>(
              "select * from public.consume_gallery_attempt('ip:test')",
            )
          ).rows[0].allowed,
          true,
        );
      },
    );
    await t.test(
      "archiving revokes sessions while preserving favorite selections",
      async () => {
        await db.exec(
          `update public.projects set status = 'archived' where id = '${projectA}'`,
        );
        const result = await db.query<{ revoked_at: string | null }>(
          `select revoked_at from private.gallery_sessions where id = '${sessionA}'`,
        );
        assert.ok(result.rows[0].revoked_at);
        assert.equal(
          (await db.query("select * from public.favorites")).rows.length,
          1,
        );
      },
    );
    await t.test("both media buckets are private", async () => {
      const result = await db.query<{ public: boolean }>(
        "select public from storage.buckets",
      );
      assert.equal(result.rows.length, 2);
      assert.ok(result.rows.every((row) => !row.public));
    });
    await t.test(
      "preview object keys cannot point at a different project",
      async () => {
        await assert.rejects(
          db.query(
            `update public.media set preview_key = '${projectB}/preview.webp' where id = '${mediaA}'`,
          ),
          /check constraint/,
        );
      },
    );
    await t.test(
      "deleting a cover clears only cover_media_id and keeps the project",
      async () => {
        await db.exec(
          `update public.projects set cover_media_id = '${mediaA}' where id = '${projectA}'; delete from public.media where id = '${mediaA}'`,
        );
        const result = await db.query<{
          id: string;
          cover_media_id: string | null;
        }>(
          `select id, cover_media_id from public.projects where id = '${projectA}'`,
        );
        assert.equal(result.rows[0].id, projectA);
        assert.equal(result.rows[0].cover_media_id, null);
      },
    );
    await t.test(
      "crew dispatch, fee sync trigger, and zero-leakage payload verification",
      async () => {
        await db.exec("set role service_role");
        try {
          const crewId = "50000000-0000-0000-0000-000000000001";
          const assignmentId = "60000000-0000-0000-0000-000000000001";
          const token = "a".repeat(43); // 43-character token matching ^[A-Za-z0-9_-]{32,64}$

          // 1. Insert Crew Member
          await db.query(`
            insert into public.crew_members (
              id, crew_code, full_name, phone, bank_name,
              bank_account_number, bank_account_holder, standard_day_rate
            ) values (
              '${crewId}', 'CRW-01', 'Bambang Sudirman', '081234567890',
              'BCA', '1234567890', 'Bambang Sudirman', 500000
            );
          `);

          // 2. Insert Crew Assignment
          await db.query(`
            insert into public.project_crew_assignments (
              id, project_id, crew_member_id, magic_token, role_title,
              call_time, roll_time, venue_name, venue_address, fee_agreed,
              allocated_equipment, technical_notes, acceptance_status
            ) values (
              '${assignmentId}', '${projectA}', '${crewId}', '${token}', 'Lead Cinematographer',
              now() + interval '2 hours', now() + interval '3 hours', 'Grand Ballroom Hotel',
              'Jl. Sudirman No. 1', 500000, array['Sony FX3 Body', 'FE 24-70mm GM II'],
              'Gunakan S-Log3 dan pastikan white balance 5600K', 'ACCEPTED'
            );
          `);

          // 3. Verify Trigger trg_sync_crew_fee synced to public.project_expenses
          const expenseResult = await db.query<{
            category: string;
            unit_cost: string;
            quantity: string;
            total_cost: string;
            crew_assignment_id: string;
          }>(
            `select category, unit_cost, quantity, total_cost, crew_assignment_id from public.project_expenses where crew_assignment_id = '${assignmentId}'`
          );
          assert.equal(expenseResult.rows.length, 1);
          assert.equal(expenseResult.rows[0].category, "CREW_FEE");
          assert.equal(Number(expenseResult.rows[0].total_cost), 500000);

          // 4. Verify get_crew_hub_payload RPC executes and preserves Zero-Leakage Invariant
          const rpcResult = await db.query<{
            get_crew_hub_payload: Record<string, unknown>;
          }>(
            `select public.get_crew_hub_payload('${token}') as get_crew_hub_payload;`
          );
          assert.equal(rpcResult.rows.length, 1);
          const payload = rpcResult.rows[0].get_crew_hub_payload;

          // Permitted fields
          assert.equal(payload.role_title, "Lead Cinematographer");
          assert.equal(payload.venue_name, "Grand Ballroom Hotel");
          assert.equal(payload.fee_agreed, 500000);
          assert.equal(payload.payment_status, "UNPAID");
          assert.deepEqual(payload.allocated_equipment, ["Sony FX3 Body", "FE 24-70mm GM II"]);

          // Zero-Leakage Invariant: Client financial data MUST NOT exist
          assert.equal(payload.contract_value, undefined);
          assert.equal(payload.profit_margin, undefined);
          assert.equal(payload.studio_cut, undefined);
          assert.equal(payload.customer, undefined);
          assert.equal(payload.invoices, undefined);

          // 5. Update Fee and verify trigger update in project_expenses
          await db.query(`
            update public.project_crew_assignments
            set fee_agreed = 650000
            where id = '${assignmentId}';
          `);
          const updatedExpense = await db.query<{ total_cost: string }>(
            `select total_cost from public.project_expenses where crew_assignment_id = '${assignmentId}'`
          );
          assert.equal(Number(updatedExpense.rows[0].total_cost), 650000);

          // 6. Delete Assignment and verify cascading cleanup in project_expenses
          await db.query(`
            delete from public.project_crew_assignments where id = '${assignmentId}';
          `);
          const deletedExpense = await db.query(
            `select id from public.project_expenses where crew_assignment_id = '${assignmentId}'`
          );
          assert.equal(deletedExpense.rows.length, 0);
        } finally {
          await db.exec("set role anon");
        }
      },
    );
  } finally {
    await db.close();
  }
});
