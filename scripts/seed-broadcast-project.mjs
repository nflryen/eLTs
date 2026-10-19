#!/usr/bin/env node
/**
 * seed-broadcast-project.mjs — seed ONE realistic multi-cam broadcast project.
 *
 * WHY THIS EXISTS
 * ---------------
 * Building the Project Workspace Console against an empty database produces
 * screens that render but prove nothing. This script creates a single, fully
 * populated broadcast project — customer, crew with mixed consent states, gear
 * across all three ownership tiers, a vendor PO, an invoice and a verified
 * partial payment — so the workspace can be built and verified against the
 * shape of real work.
 *
 * The numbers are chosen to exercise the hard cases:
 *   • Contract Rp 15.000.000 with a 30% DP floor (Rp 4.500.000)
 *   • Client pays Rp 8.000.000 — ABOVE the floor, BELOW the contract
 *     → balance must be exactly Rp 7.000.000, status PARTIALLY_PAID
 *   • One crew member still PENDING_OFFER → the consent lifecycle is visible
 *   • A vendor PO exists → Stream B of the dual-export has real content
 *
 * IDEMPOTENT: keyed on deterministic UUIDs. Re-running updates in place and
 * never duplicates. Safe against the hosted database.
 *
 * USAGE
 *   node scripts/seed-broadcast-project.mjs
 *   node scripts/seed-broadcast-project.mjs --clean    # remove the seed first
 */

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import process from "node:process";

// ── Deterministic identifiers (stable across re-runs) ──────────────────────
const CUSTOMER_ID = "c1520000-0000-4000-8000-000000000001";
const PROJECT_ID = "b1520000-0000-4000-8000-000000000001";
const INVOICE_ID = "11520000-0000-4000-8000-000000000001";
const RECEIPT_ID = "7c152000-0000-4000-8000-000000000001";
const PO_ID = "f0152000-0000-4000-8000-000000000001";

const CREW = {
  ray: "f0000000-0000-0000-0000-000000000001",
  el: "f0000000-0000-0000-0000-000000000002",
  cahyo: "f0000000-0000-0000-0000-000000000003",
};

const CONTACT_PHONE = "081234567890";

async function loadEnv() {
  const raw = await readFile(".env.local", "utf8");
  const env = Object.fromEntries(
    raw
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase credentials in .env.local");
  }
  return env;
}

/** Local-date helper: N days from today, formatted YYYY-MM-DD (Asia/Jakarta). */
function dateInDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/** WIB wall-clock timestamp for a given date + HH:MM:SS. */
function wib(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}+07:00`).toISOString();
}

async function cleanup(sb) {
  console.log("\n  ── cleaning previous seed ──");
  // Order respects FKs: children before parents.
  const steps = [
    ["invoice_payment_receipts", () => sb.from("invoice_payment_receipts").delete().eq("id", RECEIPT_ID)],
    ["project_invoices", () => sb.from("project_invoices").delete().eq("id", INVOICE_ID)],
    ["vendor_purchase_order_items", () => sb.from("vendor_purchase_order_items").delete().eq("po_id", PO_ID)],
    ["vendor_purchase_orders", () => sb.from("vendor_purchase_orders").delete().eq("id", PO_ID)],
    ["project_expenses", () => sb.from("project_expenses").delete().eq("project_id", PROJECT_ID)],
    ["project_crew_assignments", () => sb.from("project_crew_assignments").delete().eq("project_id", PROJECT_ID)],
    ["projects", () => sb.from("projects").delete().eq("id", PROJECT_ID)],
    ["customers", () => sb.from("customers").delete().eq("id", CUSTOMER_ID)],
  ];
  for (const [label, run] of steps) {
    const { error } = await run();
    console.log(`    ${error ? "•" : "✓"} ${label}${error ? ` (${error.message.slice(0, 50)})` : ""}`);
  }
}

async function main() {
  const env = await loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  console.log(`\n  seeding → ${env.NEXT_PUBLIC_SUPABASE_URL}`);
  await cleanup(sb);

  const shootDate = dateInDays(4);
  const rehearsalDate = dateInDays(3);

  // ── 1. CUSTOMER ─────────────────────────────────────────────────────────
  {
    const { error } = await sb.from("customers").upsert(
      {
        id: CUSTOMER_ID,
        name: "Panitia Wisuda Ke-152 UNSOED",
        email: "wisuda@unsoed.ac.id",
        phone: CONTACT_PHONE,
        archived_at: null,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(`customer: ${error.message}`);
    console.log("  ✓ customer  Panitia Wisuda Ke-152 UNSOED");
  }

  // ── 2. PROJECT ──────────────────────────────────────────────────────────
  const sectorSpecs = {
    signalFlow: {
      cameras: [
        { slot: "CAM 1", body: "Sony FX6", role: "Master Wide Stage", output: "SDI 1080p50", to: "ATEM Mini Pro ISO" },
        { slot: "CAM 2", body: "Sony FX3", role: "Roving / Audience", output: "SDI 1080p50", to: "ATEM Mini Pro ISO" },
        { slot: "CAM 3", body: "Sony A7S III", role: "Podium Close-up", output: "HDMI 1080p50", to: "Capture Card" },
      ],
      switcher: "vMix 4K Broadcast Console (Core i9 + RTX 4080 + DeckLink Quad)",
      routing: "ATEM Mini Pro ISO (CAM 1 + CAM 2) → DeckLink → vMix",
      audio: "Behringer X32 Producer (board feed) → vMix Audio Bus",
      intercom: "Hollyland Solidcom C1 Pro 4-station (TD, SW, CAM1, CAM2)",
      transmission: {
        primary: "YouTube Live 1080p50 CBR 8 Mbps",
        backup: "Telkomsel bonding router (standby)",
        relay: "Videotron Graha Widyatama via SDI distribution",
      },
      recording: "vMix ISO recording per camera + program master (ProRes 422)",
    },
    runOfShow: [
      { time: "06:30", cue: "Load-in selesai · Pairing intercom · Audio line check (tanpa audio publik)", source: "All Cameras" },
      { time: "07:00", cue: "Test bars + tone 1kHz ke stream · Konfirmasi bitrate stabil", source: "vMix Bars" },
      { time: "07:15", cue: "Standby master wide · Opening bumper grafis", source: "CAM 1" },
      { time: "07:30", cue: "Prosesi masuk Senat · Lagu Indonesia Raya", source: "CAM 2 + CAM 1" },
      { time: "08:00", cue: "Sambutan Rektor UNSOED", source: "CAM 3 Podium" },
      { time: "09:00", cue: "Pemberian ijazah per fakultas (close-up panggung)", source: "CAM 3 Podium" },
      { time: "11:30", cue: "Penutupan · Highlight montage roll", source: "Media Player" },
      { time: "12:00", cue: "End of transmission · Rekaman ISO di-verifikasi DIT", source: "vMix" },
    ],
    redundancy: {
      checklist: ["Backup uplink terpasang", "ISO recording aktif sebelum go-live", "Power circuit terpisah untuk switcher"],
      hasBackupUplink: true,
      hasUPS: true,
    },
    rehearsalDate,
  };

  {
    const { error } = await sb.from("projects").upsert(
      {
        id: PROJECT_ID,
        customer_id: CUSTOMER_ID,
        name: "Wisuda Ke-152 UNSOED Broadcast & Live Streaming",
        slug: "wisuda-152-unsoed-broadcast",
        photography_type: "event",
        gallery_code: "ELTS-W152UNSO",
        // Valid scrypt-v1 envelope (seed only — never a real credential).
        gallery_pin_hash:
          "scrypt-v1$WMvBGJLMqZxcRjTHNpKdSA$8fQ2mKpVnXbLdRtYwZcHsJgAfUeIoPqMnBvCxZaSdFg",
        // Exactly 43 URL-safe base64 chars — enforced by projects_access_token_check.
        access_token: "d2bp3lzT4iGKABYn0RdGahQrp_AKnaVc0jaGaeRrvcA",
        shoot_date: shootDate,
        status: "ready",
        allow_download: true,
        watermark_enabled: true,
        contract_value: 15000000,
        dp_amount: 4500000,
        is_dp_paid: false, // derived by the receipt trigger
        is_fully_paid: false,
        service_pillar: "BROADCAST_LIVE_STREAMING",
        selection_quota_min: 15,
        selection_quota_max: 20,
        sector_specs: sectorSpecs,
        rehearsal_date: rehearsalDate,
        expires_at: null,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(`project: ${error.message}`);
    console.log(`  ✓ project   Wisuda Ke-152 UNSOED  (shoot ${shootDate}, rehearsal ${rehearsalDate})`);
  }

  // ── 3. CREW ASSIGNMENTS (mixed consent states) ──────────────────────────
  const assignments = [
    {
      id: "a1520000-0000-4000-8000-000000000001",
      crew_member_id: CREW.ray,
      role_title: "Technical Director",
      fee: 500000,
      status: "ACCEPTED",
    },
    {
      id: "a1520000-0000-4000-8000-000000000002",
      crew_member_id: CREW.el,
      role_title: "Cam 1 Master / DoP",
      fee: 450000,
      status: "ACCEPTED",
    },
    {
      id: "a1520000-0000-4000-8000-000000000003",
      crew_member_id: CREW.cahyo,
      role_title: "Switcher Operator",
      fee: 400000,
      status: "PENDING_OFFER",
    },
  ];

  for (const a of assignments) {
    const { error } = await sb.from("project_crew_assignments").upsert(
      {
        id: a.id,
        project_id: PROJECT_ID,
        crew_member_id: a.crew_member_id,
        // 32-64 chars, URL-safe. Derived from the unique assignment id so
        // re-runs are stable and no two crew collide on the token.
        magic_token: `tok152${a.id.replace(/[^a-z0-9]/gi, "")}x`.slice(0, 40),
        role_title: a.role_title,
        call_time: wib(shootDate, "06:30:00"),
        roll_time: wib(shootDate, "07:30:00"),
        venue_name: "Auditorium Graha Widyatama UNSOED",
        venue_address: "Jl. Dr. Soeparno, Karangwangkal, Purwokerto Utara, Banyumas 53122",
        venue_maps_url: "https://maps.google.com/?q=-7.4036,109.2442",
        dress_code: "Seragam Hitam / Studio Polo",
        technical_notes:
          a.status === "PENDING_OFFER"
            ? "Konfirmasi kehadiran diperlukan. Switcher standby 07:00, go-live 07:30."
            : "Standby di video village 30 menit sebelum roll.",
        allocated_equipment: [],
        fee_agreed: a.fee,
        payment_status: "UNPAID",
        acceptance_status: a.status,
        accepted_at: a.status === "ACCEPTED" ? new Date().toISOString() : null,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(`assignment (${a.role_title}): ${error.message}`);
  }
  console.log(
    `  ✓ crew      Ray (TD, ACCEPTED) · El (Cam 1, ACCEPTED) · Cahyo (Switcher, PENDING_OFFER)`,
  );

  // ── 4. EQUIPMENT: 2 in-house kits + vendor rental lines ─────────────────
  const gear = [
    { asset_code: "AST-CAM-01", category: "EQUIPMENT_RENTAL", source: "IN_HOUSE", name: "Sony FX3 Cinema Line Body (Cam 2 Roving)", cost: 450000, vendor: null, phone: null },
    { asset_code: "AST-SWT-01", category: "EQUIPMENT_RENTAL", source: "IN_HOUSE", name: "vMix 4K Broadcast Rig", cost: 750000, vendor: null, phone: null },
    { asset_code: null, category: "EQUIPMENT_RENTAL", source: "VENDOR_RENTAL", name: "Aputure 300d LED (Stage Wash)", cost: 350000, vendor: "Koi Rental Purwokerto", phone: "081327889900" },
    { asset_code: "AST-AUD-01", category: "EQUIPMENT_RENTAL", source: "VENDOR_RENTAL", name: "Behringer X32 Producer Digital Mixer", cost: 400000, vendor: "Koi Rental Purwokerto", phone: "081327889900" },
  ];

  for (let i = 0; i < gear.length; i += 1) {
    const g = gear[i];
    let assetId = null;
    if (g.asset_code) {
      const { data } = await sb.from("inventory_assets").select("id").eq("asset_code", g.asset_code).maybeSingle();
      assetId = data?.id ?? null;
    }
    const { error } = await sb.from("project_expenses").upsert(
      {
        id: `e1520000-0000-4000-8000-00000000000${i + 1}`,
        project_id: PROJECT_ID,
        category: g.category,
        name: g.name,
        unit_cost: g.cost,
        quantity: 1,
        paid_by: "STUDIO_CASH",
        asset_id: assetId,
        source_type: g.source,
        owner_name: g.source === "IN_HOUSE" ? "Studio" : "Koi Rental",
        vendor_name: g.vendor,
        vendor_phone: g.phone,
        rental_duration_days: 2,
        return_date: null,
        return_status: g.source === "VENDOR_RENTAL" ? "PENDING" : "RETURNED",
        pack_status: "PENDING",
        accessories: g.asset_code === "AST-CAM-01"
          ? { batteries: 4, cards: [{ capacity_gb: 160, qty: 2 }], charger: true }
          : {},
        is_cash_outflow: true,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(`expense (${g.name}): ${error.message}`);
  }
  console.log("  ✓ gear      2 in-house kits · 2 vendor rental lines (Koi Rental)");

  // ── 5. VENDOR PURCHASE ORDER (Stream B source) ──────────────────────────
  {
    const { error: poErr } = await sb.from("vendor_purchase_orders").upsert(
      {
        id: PO_ID,
        po_number: "PO/2026/10/0001",
        project_id: PROJECT_ID,
        vendor_name: "Koi Rental Purwokerto",
        vendor_phone: "081327889900",
        vendor_address: "Jl. Gerilya No. 12, Purwokerto",
        pickup_at: wib(rehearsalDate, "09:00:00"),
        return_due_at: wib(dateInDays(5), "17:00:00"),
        status: "CONFIRMED",
        subtotal: 750000,
        deposit_amount: 300000,
        wa_sent_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        notes: "Ambil H-1 sebelum gladi resik. Kembalikan setelah tear-down.",
      },
      { onConflict: "id" },
    );
    if (poErr) throw new Error(`vendor PO: ${poErr.message}`);

    await sb.from("vendor_purchase_order_items").delete().eq("po_id", PO_ID);
    const { error: itemErr } = await sb.from("vendor_purchase_order_items").insert([
      { po_id: PO_ID, description: "Aputure 300d LED", quantity: 1, unit_days: 2, unit_rate: 350000 },
      { po_id: PO_ID, description: "Behringer X32 Producer Digital Mixer", quantity: 1, unit_days: 2, unit_rate: 200000 },
    ]);
    if (itemErr) throw new Error(`vendor PO items: ${itemErr.message}`);
    console.log("  ✓ PO        PO/2026/10/0001 → Koi Rental (subtotal Rp 750.000, deposit Rp 300.000)");
  }

  // ── 6. INVOICE + VERIFIED PARTIAL PAYMENT ───────────────────────────────
  {
    const { error: invErr } = await sb.from("project_invoices").upsert(
      {
        id: INVOICE_ID,
        project_id: PROJECT_ID,
        invoice_number: "INV/2026/10/0001",
        issue_date: dateInDays(-2),
        due_date: dateInDays(2),
        line_items: [
          { description: "Multi-Cam Live Streaming 3 Kamera + FOH", quantity: 1, unit_price: 12000000, subtotal: 12000000 },
          { description: "Rekaman ISO per kamera + Master Program", quantity: 1, unit_price: 3000000, subtotal: 3000000 },
        ],
        gross_contract_value: 15000000,
        minimum_dp_pct: 30,
        client_notes: "Pelunasan sebelum penyerahan master rekaman.",
        is_cancelled: false,
      },
      { onConflict: "id" },
    );
    if (invErr) throw new Error(`invoice: ${invErr.message}`);

    const { error: rcpErr } = await sb.from("invoice_payment_receipts").upsert(
      {
        id: RECEIPT_ID,
        invoice_id: INVOICE_ID,
        receipt_number: "RCP/2026/10/0001",
        amount: 8000000,
        payment_method: "BANK_TRANSFER",
        bank_name: "BCA",
        reference_number: "TRF-8821-UNSOED",
        applied_to: "DP",
        verified_at: new Date().toISOString(),
        notes: "Transfer DP lebih dari minimum 30% — ditransfer sekaligus oleh panitia.",
      },
      { onConflict: "id" },
    );
    if (rcpErr) throw new Error(`receipt: ${rcpErr.message}`);
      console.log("  ✓ invoice   INV/2026/10/0001  Rp 15.000.000");
    console.log("  ✓ receipt   RCP/2026/10/0001  Rp 8.000.000 (BCA, verified)");
  }

  // ── 7. ASSERTIONS ───────────────────────────────────────────────────────
  console.log("\n  ── derived state assertions ──");
  const { data: pos, error: posErr } = await sb
    .from("v_invoice_financial_position")
    .select("contract_value, minimum_dp_required, paid_amount, balance_due, derived_status, dp_floor_satisfied")
    .eq("invoice_id", INVOICE_ID)
    .single();
  if (posErr) throw new Error(`view: ${posErr.message}`);

  const { data: proj } = await sb
    .from("projects")
    .select("is_dp_paid, is_fully_paid")
    .eq("id", PROJECT_ID)
    .single();

  const checks = [
    ["contract_value", Number(pos.contract_value), 15000000],
    ["minimum_dp_required", Number(pos.minimum_dp_required), 4500000],
    ["paid_amount", Number(pos.paid_amount), 8000000],
    ["balance_due", Number(pos.balance_due), 7000000],
    ["dp_floor_satisfied", pos.dp_floor_satisfied, true],
  ];

  let failed = 0;
  for (const [label, actual, expected] of checks) {
    const good = actual === expected;
    if (!good) failed += 1;
    const fmt = (v) => (typeof v === "number" ? `Rp ${v.toLocaleString("id-ID")}` : String(v));
    console.log(`    ${good ? "✓" : "✗"} ${label.padEnd(20)} ${fmt(actual)}${good ? "" : `  (expected ${fmt(expected)})`}`);
  }
  const statusGood = pos.derived_status === "PARTIALLY_PAID";
  if (!statusGood) failed += 1;
  console.log(`    ${statusGood ? "✓" : "✗"} derived_status       ${pos.derived_status}`);
  const dpGood = proj?.is_dp_paid === true;
  if (!dpGood) failed += 1;
  console.log(`    ${dpGood ? "✓" : "✗"} projects.is_dp_paid   ${proj?.is_dp_paid} (trigger sync)`);

  if (failed > 0) {
    console.log(`\n  ✗ ${failed} assertion(s) failed\n`);
    process.exit(1);
  }

  console.log(`\n  ────────────────────────────────────────────────`);
  console.log(`  SEED COMPLETE`);
  console.log(`  Project:  /admin/projects/${PROJECT_ID}`);
  console.log(`  Shoot:    ${shootDate} 07:30 WIB  (D-4)`);
  console.log(`  Rehearsal:${rehearsalDate} 14:00 WIB  (D-3)`);
  console.log(`  Balance:  Rp 7.000.000 outstanding`);
  console.log(`  ────────────────────────────────────────────────\n`);
}

main().catch((err) => {
  console.error(`\n  ✗ seed failed: ${err.message}\n`);
  process.exit(1);
});
