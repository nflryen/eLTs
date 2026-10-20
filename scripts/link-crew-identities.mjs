/**
 * Link every crew_members row to a real auth identity, then seed partner
 * equity and task rates.
 *
 * WHY A SCRIPT, NOT A MIGRATION
 * -----------------------------
 * Migrations are schema. Creating auth users is provisioning: it writes to
 * auth.users, sends nothing, and must be idempotent against three different
 * environments (local, preview, prod) where the same email may or may not
 * already exist. Doing this in SQL would put `auth.users` inserts into the
 * migration ledger, where a failure half-way leaves a ledger that disagrees
 * with reality.
 *
 * Safe to re-run: every step is an upsert / guarded update.
 *
 * Usage:
 *   node --env-file=.env.local scripts/link-crew-identities.mjs --dry-run
 *   node --env-file=.env.local scripts/link-crew-identities.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";

const DRY_RUN = process.argv.includes("--dry-run");

/** Deterministic dev password. Real deployments must rotate these. */
const DEV_PASSWORD = process.env.SEED_CREW_PASSWORD ?? "crew-dev-2026";

const db = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function log(...a) {
  console.log(DRY_RUN ? "[dry-run]" : "[apply]  ", ...a);
}

// ── 1. Ensure an auth user exists for every crew member with an email ────────
const { rows: crew } = await db.query(
  `SELECT id, crew_code, full_name, email, auth_user_id
     FROM public.crew_members
    ORDER BY crew_code`,
);

const { data: userList, error: listErr } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);

const byEmail = new Map(
  userList.users.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u.id]),
);

let created = 0;
let linked = 0;
let skipped = 0;

for (const member of crew) {
  if (!member.email) {
    log(`skip ${member.crew_code}: no email`);
    skipped += 1;
    continue;
  }

  let userId = member.auth_user_id ?? byEmail.get(member.email.toLowerCase()) ?? null;

  if (!userId) {
    if (DRY_RUN) {
      log(`would create auth user for ${member.crew_code} <${member.email}>`);
      // Register a placeholder so later steps resolve against the plan instead
      // of reporting a false "no identity" warning.
      byEmail.set(member.email.toLowerCase(), `plan:${member.crew_code}`);
      created += 1;
      continue;
    }
    const { data, error } = await admin.auth.admin.createUser({
      email: member.email,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { crew_code: member.crew_code, full_name: member.full_name },
    });
    if (error) {
      // Another process may have created it between listUsers and here.
      const { data: retry } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const found = retry?.users.find((u) => u.email?.toLowerCase() === member.email.toLowerCase());
      if (!found) throw new Error(`${member.crew_code}: ${error.message}`);
      userId = found.id;
    } else {
      userId = data.user.id;
      created += 1;
    }
  }

  if (member.auth_user_id === userId) {
    log(`ok    ${member.crew_code}: already linked`);
    continue;
  }

  if (DRY_RUN) {
    log(`would link ${member.crew_code} -> ${userId}`);
  } else {
    await db.query(
      `UPDATE public.crew_members SET auth_user_id = $1, updated_at = now() WHERE id = $2`,
      [userId, member.id],
    );
    // A freelancer needs the FREELANCER role so guards recognise them.
    await db.query(
      `INSERT INTO public.role_assignments (user_id, role_key)
       VALUES ($1, 'FREELANCER')
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );
    log(`linked ${member.crew_code} -> ${userId}`);
  }
  linked += 1;
}

// ── 2. Partner equity ────────────────────────────────────────────────────────
/*
 * EXPLICIT, not inferred.
 *
 * An earlier version split 10000 bp evenly across every FOUNDER/SUPER_ADMIN
 * account. That silently assigned 100% to the single existing exec account while
 * the two named partners (El, Cahyo) were still crew rows with no login — a
 * wrong equity register that still satisfied the 10000-bp check.
 *
 * Money-relevant ownership must be stated by a human, so this table is
 * declared literally and validated against the linked identities.
 */
const PARTNERS = [
  { email: "ray@elts.id", display_name: "Rayyan Nufail", equity_bp: 5000 },
  { email: "el@elts.id", display_name: "El", equity_bp: 5000 },
];

const { rows: linkedRows } = await db.query(
  `SELECT cm.email, cm.auth_user_id
     FROM public.crew_members cm
    WHERE cm.auth_user_id IS NOT NULL`,
);
const linkedByEmail = new Map(
  linkedRows.filter((r) => r.email).map((r) => [r.email.toLowerCase(), r.auth_user_id]),
);

let equityTotal = 0;
/*
 * One transaction for the whole register.
 *
 * The equity invariant is a DEFERRED constraint trigger, so it is evaluated at
 * COMMIT. Writing partners individually would leave the table at a partial
 * total after each statement and abort on the first one. Deferring the
 * constraint only helps if all writes share a transaction.
 */
await db.query("BEGIN");
try {
for (const p of PARTNERS) {
  const userId = byEmail.get(p.email.toLowerCase()) ?? linkedByEmail.get(p.email.toLowerCase());
  if (!userId) {
    log(`WARN equity: no auth identity for ${p.email}; skipped (total will not reach 10000)`);
    continue;
  }
  equityTotal += p.equity_bp;
  if (DRY_RUN) {
    log(`would set ${p.display_name} equity_bp=${p.equity_bp}`);
    continue;
  }
  await db.query(
    `INSERT INTO public.partner_accounts (user_id, display_name, equity_bp)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           equity_bp = EXCLUDED.equity_bp,
           updated_at = now()`,
    [userId, p.display_name, p.equity_bp],
  );
  // A partner must be able to act as FOUNDER to draw dividends.
  await db.query(
    `INSERT INTO public.role_assignments (user_id, role_key)
     VALUES ($1, 'FOUNDER')
     ON CONFLICT (user_id) DO UPDATE SET role_key = 'FOUNDER'`,
    [userId],
  );
  await db.query(
    `INSERT INTO public.admins (user_id, display_name)
     VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [userId, p.display_name],
  );
  log(`equity ${p.display_name} = ${p.equity_bp} bp (FOUNDER)`);
}
  if (equityTotal !== 0 && equityTotal !== 10000) {
    throw new Error(`equity_bp must total 10000, declared ${equityTotal}`);
  }
  await db.query("COMMIT");
} catch (err) {
  await db.query("ROLLBACK");
  throw err;
}
log(`equity total declared: ${equityTotal} bp`);

// ── 3. Default task rates ────────────────────────────────────────────────────
const rates = [
  { role: "WORKER", kind: "EDITING", label: "Editing foto event (per proyek)", amount: 350000, unit: "PIECE" },
  { role: "WORKER", kind: "VIDEO_EDIT", label: "Editing video highlight (per proyek)", amount: 500000, unit: "PIECE" },
  { role: "WORKER", kind: "PHOTO_RETOUCH", label: "Retouch seleksi klien (per foto)", amount: 7500, unit: "PIECE" },
  { role: "ADMIN", kind: "SALARY_MONTHLY", label: "Gaji operasional bulanan", amount: 4500000, unit: "MONTH" },
];

for (const r of rates) {
  if (DRY_RUN) {
    log(`would seed rate ${r.role}/${r.kind} = ${r.amount}`);
    continue;
  }
  await db.query(
    `INSERT INTO public.compensation_rates (role_key, task_kind, label, amount, unit)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (role_key, task_kind, unit) DO UPDATE
       SET label = EXCLUDED.label, amount = EXCLUDED.amount, updated_at = now()`,
    [r.role, r.kind, r.label, r.amount, r.unit],
  );
  log(`rate ${r.role}/${r.kind} = ${r.amount}`);
}

// ── 4. Report ────────────────────────────────────────────────────────────────
const { rows: report } = await db.query(
  `SELECT
     (SELECT count(*) FROM public.crew_members WHERE auth_user_id IS NOT NULL)::int AS crew_linked,
     (SELECT count(*) FROM public.crew_members)::int AS crew_total,
     (SELECT coalesce(sum(equity_bp),0) FROM public.partner_accounts WHERE is_active)::int AS equity_bp,
     (SELECT count(*) FROM public.compensation_rates WHERE is_active)::int AS rates`,
);

console.log("\n─── summary ───");
console.log(`created auth users : ${created}`);
console.log(`linked crew        : ${linked}`);
console.log(`skipped            : ${skipped}`);
console.log("state              :", JSON.stringify(report[0]));

await db.end();
