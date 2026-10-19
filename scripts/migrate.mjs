#!/usr/bin/env node
/**
 * Applies every SQL migration in supabase/migrations/ to a hosted Supabase
 * Postgres database, in filename order, exactly once.
 *
 * WHY THIS EXISTS
 * ---------------
 * `supabase/migrations/*.sql` is the authoritative schema definition, and the
 * PGlite test-suite proves those migrations work. But that suite runs in memory
 * and never touches the hosted project, so the hosted database can silently
 * drift behind the repository. When it does, PostgREST answers every query for
 * a missing relation with:
 *
 *   "Could not find the table 'public.<name>' in the schema cache"
 *
 * and the admin console quietly degrades to its in-memory fallback seeds.
 * Running this script brings the hosted schema back in line with the repo.
 *
 * USAGE
 * -----
 *   # 1. Get the connection string:
 *   #    Supabase Dashboard -> Project Settings -> Database -> Connection string
 *   #    Prefer the "Session pooler" URI for IPv4 networks.
 *   export DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
 *
 *   # 2. Preview what would run (no writes):
 *   npm run migrate -- --dry-run
 *
 *   # 3. Apply:
 *   npm run migrate
 *
 *   # Apply a single file:
 *   npm run migrate -- --only 202609240007_crew_consent_and_asset_calendar.sql
 *
 *   # Re-apply everything, ignoring the ledger (migrations are idempotent):
 *   npm run migrate -- --force
 *
 * SAFETY
 * ------
 * - Every migration in this repo uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
 *   guards, so re-running is safe.
 * - Applied filenames are recorded in `public.schema_migrations`, so a normal
 *   run only executes files that have never been applied.
 * - --dry-run reports the plan and exits without writing.
 */

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, "..", "supabase", "migrations");

const args = new Set(process.argv.slice(2));
const isDryRun = args.has("--dry-run");
const force = args.has("--force");

/** Reads `--only <filename>` if present. */
function readOnlyFlag(argv) {
  const idx = argv.indexOf("--only");
  if (idx === -1) return null;
  const value = argv[idx + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--only requires a migration filename, e.g. --only 202609240007_crew_consent_and_asset_calendar.sql");
  }
  return value;
}

const only = readOnlyFlag(process.argv);

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename    TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

/**
 * PostgREST caches the exposed schema. After DDL it must be told to reload, or
 * the API keeps reporting the pre-migration schema.
 */
const RELOAD_SCHEMA = `NOTIFY pgrst, 'reload schema';`;

async function loadMigrationFiles() {
  const entries = await readdir(MIGRATIONS_DIR);
  const files = entries.filter((name) => name.endsWith(".sql")).sort();

  if (only) {
    const match = files.filter((name) => name === only || name.includes(only));
    if (match.length === 0) {
      throw new Error(`--only "${only}" matched no migration in ${MIGRATIONS_DIR}`);
    }
    return match;
  }
  return files;
}

async function connect(databaseUrl) {
  let pg;
  try {
    pg = await import("pg");
  } catch {
    throw new Error(
      "The 'pg' driver is required. Install it with:\n" +
        "  npm install --save-dev pg\n" +
        "(Or apply the migrations manually with psql — see docs/migrations.md.)",
    );
  }
  const { Client } = pg.default ?? pg;
  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const files = await loadMigrationFiles();

  console.log(`\n  ELTS migration runner`);
  console.log(`  ${"=".repeat(60)}`);
  console.log(`  Directory : ${path.relative(process.cwd(), MIGRATIONS_DIR)}`);
  console.log(`  Discovered: ${files.length} migration(s)`);
  console.log(`  Mode      : ${isDryRun ? "DRY RUN (no writes)" : force ? "FORCE (re-apply all)" : "apply pending"}\n`);

  if (!databaseUrl) {
    console.error("  ✗ DATABASE_URL is not set.\n");
    console.error("    Supabase Dashboard -> Project Settings -> Database -> Connection string.");
    console.error("    Then re-run:  DATABASE_URL='postgresql://...' npm run migrate\n");
    console.error("  Migrations that WOULD be considered:");
    for (const file of files) console.error(`    - ${file}`);
    console.error("");
    process.exitCode = 1;
    return;
  }

  const client = await connect(databaseUrl);

  try {
    if (!isDryRun) {
      await client.query(LEDGER_DDL);
    }

    let appliedSet = new Set();
    try {
      const { rows } = await client.query("SELECT filename FROM public.schema_migrations");
      appliedSet = new Set(rows.map((row) => row.filename));
    } catch {
      // Ledger absent on a fresh database; the DDL above normally prevents this.
      appliedSet = new Set();
    }

    let applied = 0;
    let skipped = 0;

    for (const file of files) {
      const alreadyApplied = appliedSet.has(file) && !force;

      if (alreadyApplied) {
        console.log(`  • skip   ${file}  (already applied)`);
        skipped += 1;
        continue;
      }

      if (isDryRun) {
        console.log(`  → would apply  ${file}`);
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      process.stdout.write(`  → apply  ${file} ... `);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO public.schema_migrations (filename) VALUES ($1)
           ON CONFLICT (filename) DO UPDATE SET applied_at = now()`,
          [file],
        );
        await client.query("COMMIT");
        console.log("ok");
        applied += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        console.log("FAILED");
        throw new Error(`Migration ${file} failed and was rolled back:\n${error.message}`);
      }
    }

    if (!isDryRun) {
      // Force PostgREST to drop its cached schema so new tables/RPCs appear.
      await client.query(RELOAD_SCHEMA);
      console.log(`\n  ✓ PostgREST schema reload signalled.`);

      const { rows: verify } = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      console.log(`  ✓ public tables now present (${verify.length}):`);
      console.log(`      ${verify.map((r) => r.table_name).join(", ")}\n`);
    }

    console.log(`  Done. applied=${applied} skipped=${skipped} total=${files.length}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\n  ✗ ${error.message}\n`);
  process.exitCode = 1;
});
