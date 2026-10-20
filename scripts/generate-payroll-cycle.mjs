/**
 * Generate a monthly payroll cycle from approved compensation lines.
 *
 * Groups every line in state APPROVED or READY_FOR_DISBURSEMENT by payee,
 * creates a `payslip_records` row per payee with a gap-free
 * `PAY/YYYY/MM/<CODE>-NNNN` number, and attaches the lines.
 *
 * Idempotent per cycle: re-running skips payees that already have a slip for
 * the period (enforced by `uniq_slip_per_cycle`).
 *
 * Usage:
 *   node --env-file=.env.local scripts/generate-payroll-cycle.mjs --period 2026-10
 *   node --env-file=.env.local scripts/generate-payroll-cycle.mjs --period 2026-10 --dry-run
 */

import { createHmac } from "node:crypto";
import { Client } from "pg";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const periodIdx = args.indexOf("--period");
const PERIOD = periodIdx >= 0 ? args[periodIdx + 1] : new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}$/.test(PERIOD)) {
  throw new Error(`--period must be YYYY-MM, got ${PERIOD}`);
}

const secret = process.env.INVOICE_PDF_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("INVOICE_PDF_SECRET (>= 32 chars) is required to sign payslips");
}

const [year, month] = PERIOD.split("-");
const monthStart = `${year}-${month}-01`;
const nextY = Number(month) === 12 ? Number(year) + 1 : Number(year);
const nextM = Number(month) === 12 ? 1 : Number(month) + 1;
const monthEnd = `${nextY}-${String(nextM).padStart(2, "0")}-01`;

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const log = (...a) => console.log(DRY ? "[dry-run]" : "[apply]  ", ...a);

/** Must match `signSlipVerification` in src/lib/pdf/payslip-token.ts. */
function signSlipVerification(slipId, slipNumber, totalNet) {
  const DOMAIN = "elts-payslip-verify-v1";
  const body = `${slipId}|${slipNumber}|${Number(totalNet).toFixed(2)}`;
  return createHmac("sha256", secret).update(`${DOMAIN}.${body}`).digest("base64url");
}

await db.query("BEGIN");
try {
  // 1. Cycle
  let cycleId;
  const existing = await db.query(`SELECT id, status FROM public.payroll_cycles WHERE period_key=$1`, [PERIOD]);
  if (existing.rowCount) {
    cycleId = existing.rows[0].id;
    log(`cycle ${PERIOD} exists (${existing.rows[0].status}) -> ${cycleId}`);
    if (existing.rows[0].status !== "DRAFT") {
      throw new Error(`cycle ${PERIOD} is ${existing.rows[0].status}; only DRAFT can be regenerated`);
    }
  } else {
    const ins = await db.query(
      `INSERT INTO public.payroll_cycles (period_key) VALUES ($1) RETURNING id`,
      [PERIOD],
    );
    cycleId = ins.rows[0].id;
    log(`created cycle ${PERIOD} -> ${cycleId}`);
  }

  // 2. Eligible lines (unassigned to a slip)
  const { rows: lines } = await db.query(
    `SELECT c.id, c.payee_user_id, c.payee_crew_id, c.gross_amount, c.deduction_amount,
            c.net_amount, c.earned_on
       FROM public.compensation_line_items c
      WHERE c.state IN ('APPROVED','READY_FOR_DISBURSEMENT')
        AND c.payslip_id IS NULL
        AND c.earned_on >= $1 AND c.earned_on < $2
      ORDER BY c.earned_on`,
    [monthStart, monthEnd],
  );

  log(`eligible line items: ${lines.length}`);
  if (lines.length === 0) {
    await db.query("COMMIT");
    console.log("nothing to generate");
    await db.end();
    process.exit(0);
  }

  // 3. Group by payee
  const groups = new Map();
  for (const l of lines) {
    const key = l.payee_user_id ? `u:${l.payee_user_id}` : `c:${l.payee_crew_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        payeeUserId: l.payee_user_id,
        payeeCrewId: l.payee_crew_id,
        items: [],
        gross: 0, ded: 0, net: 0,
      });
    }
    const g = groups.get(key);
    g.items.push(l);
    g.gross += Number(l.gross_amount);
    g.ded += Number(l.deduction_amount);
    g.net += Number(l.net_amount);
  }

  // 4. One slip per payee
  let seq = Number(
    (await db.query(
      `SELECT count(*)::int n FROM public.payslip_records WHERE payroll_cycle_id=$1`,
      [cycleId],
    )).rows[0].n,
  );

  for (const [key, g] of groups) {
    // Suffix: crew_code for freelancers, "STF" for internal staff.
    let suffix = "STF";
    if (g.payeeCrewId) {
      const c = await db.query(`SELECT crew_code FROM public.crew_members WHERE id=$1`, [g.payeeCrewId]);
      suffix = (c.rows[0]?.crew_code ?? "CRW").replace(/^CRW-/, "CRW");
    }
    seq += 1;
    const slipNumber = `PAY/${year}/${month}/${suffix}-${String(seq).padStart(4, "0")}`;

    const dup = await db.query(
      `SELECT id FROM public.payslip_records
        WHERE payroll_cycle_id=$1 AND payee_user_id IS NOT DISTINCT FROM $2
          AND payee_crew_id IS NOT DISTINCT FROM $3`,
      [cycleId, g.payeeUserId, g.payeeCrewId],
    );
    if (dup.rowCount) {
      log(`skip ${key}: slip already exists`);
      seq -= 1;
      continue;
    }

    if (DRY) {
      log(`would create ${slipNumber} for ${key} net=${g.net}`);
      continue;
    }

    // Insert with a provisional hash, then sign the real id and update.
    const inserted = await db.query(
      `INSERT INTO public.payslip_records
         (slip_number, payroll_cycle_id, payee_user_id, payee_crew_id,
          total_gross, total_deduction, total_net, verification_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [slipNumber, cycleId, g.payeeUserId, g.payeeCrewId, g.gross, g.ded, g.net, "pending"],
    );
    const slipId = inserted.rows[0].id;
    const hash = signSlipVerification(slipId, slipNumber, g.net);
    await db.query(`UPDATE public.payslip_records SET verification_hash=$1 WHERE id=$2`, [hash, slipId]);

    await db.query(
      `UPDATE public.compensation_line_items
          SET payslip_id=$1, payroll_cycle_id=$2, updated_at=now()
        WHERE id = ANY($3::uuid[])`,
      [slipId, cycleId, g.items.map((i) => i.id)],
    );

    log(`${slipNumber}  ${key}  net=${g.net}  lines=${g.items.length}`);
  }

  await db.query("COMMIT");
  console.log(`\ncycle ${PERIOD} ready (${cycleId})`);
} catch (err) {
  await db.query("ROLLBACK");
  throw err;
} finally {
  await db.end();
}
