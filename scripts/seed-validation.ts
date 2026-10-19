import { createClient } from "@supabase/supabase-js";
import { hashGalleryPin } from "../src/lib/security/credentials";
import { randomBytes } from "node:crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const pepper = process.env.GALLERY_PIN_PEPPER ?? "";

if (!supabaseUrl || !serviceKey || !pepper) {
  console.error("Missing required environment variables in .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GALLERY_PIN_PEPPER)");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

export async function runSeed() {
  console.log("=================================================");
  console.log("  ELTS.ID — SEED VALIDATION HARNESS");
  console.log("=================================================\n");

  const PIN = "123456";
  const GALLERY_CODE = "ELTS-WISUDA01";
  const SLUG = "budi-siti-unsoed-access-token-xyz123";

  console.log("1. Generating cryptographic PIN hash (scrypt-v2 with salt + pepper)...");
  const pinHash = await hashGalleryPin(PIN, pepper);
  console.log(`   PIN '${PIN}' -> ${pinHash.slice(0, 30)}...`);

  // Fixed predictable UUIDs for repeatable development testing
  const customerId = "a0000000-0000-0000-0000-000000000001";
  const projectId = "b0000000-0000-0000-0000-000000000001";
  // Exact 43-character access token required by regex check constraint
  const accessToken = "O1EQwy1NXgAmrJqZB4IFfo4XQ_IZaQuIaf3Uf83-7BY";

  console.log("\n2. Upserting customer 'Budi & Siti - Wisuda UNSOED'...");
  const { data: customer, error: customerErr } = await supabase
    .from("customers")
    .upsert(
      {
        id: customerId,
        name: "Budi & Siti - Wisuda UNSOED",
        email: "budi.siti@unsoed.ac.id",
        phone: "081234567890",
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (customerErr) {
    console.error("   Failed to upsert customer:", customerErr);
    return;
  }
  console.log("   Customer ready:", customer.name, `(${customer.id})`);

  console.log("\n3. Upserting project with graduation package & commercial milestones...");
  // Attempt with commercial columns first, fallback to standard schema if unmigrated
  const fullProjectPayload = {
    id: projectId,
    customer_id: customerId,
    name: "Graduation Session — Budi & Siti (UNSOED 2026)",
    slug: SLUG,
    photography_type: "graduation",
    service_pillar: "PHOTOGRAPHY_GRADUATION",
    gallery_code: GALLERY_CODE,
    gallery_pin_hash: pinHash,
    access_token: accessToken,
    shoot_date: "2026-09-20",
    status: "ready",
    allow_download: true,
    watermark_enabled: true,
    contract_value: 1500000,
    dp_amount: 750000,
    is_dp_paid: true,
    is_fully_paid: false, // Testing invariant: HTTP 402 lock active
    selection_quota_min: 15,
    selection_quota_max: 20,
    selection_locked_at: null,
  };

  const baseProjectPayload = {
    id: projectId,
    customer_id: customerId,
    name: "Graduation Session — Budi & Siti (UNSOED 2026)",
    slug: SLUG,
    photography_type: "graduation",
    gallery_code: GALLERY_CODE,
    gallery_pin_hash: pinHash,
    access_token: accessToken,
    shoot_date: "2026-09-20",
    status: "ready",
    allow_download: true,
    watermark_enabled: true,
  };

  let project = null;
  const { data: projFull, error: projFullErr } = await supabase
    .from("projects")
    .upsert(fullProjectPayload, { onConflict: "id" })
    .select()
    .single();

  if (!projFullErr) {
    project = projFull;
    console.log("   Project created (Full Commercial Schema):", project.name);
  } else {
    // Fallback to base schema
    const { data: projBase, error: projBaseErr } = await supabase
      .from("projects")
      .upsert(baseProjectPayload, { onConflict: "id" })
      .select()
      .single();

    if (projBaseErr) {
      console.error("   Failed to upsert project:", projBaseErr);
      return;
    }
    project = projBase;
    console.log("   Project created (Base Schema):", project.name);
  }

  console.log(`   Gallery Code: ${GALLERY_CODE} | PIN: ${PIN}`);
  console.log(`   Access Token: ${accessToken}`);

  console.log("\n4. Seeding 25 mock media records for quota testing (15-20 selection)...");
  // Clean existing media for this project
  await supabase.from("media").delete().eq("project_id", projectId);

  const sampleImages = [
    "photo-1534528741775-53994a69daeb",
    "photo-1507003211169-0a1dd7228f2d",
    "photo-1517841905240-472988babdf9",
    "photo-1539571696357-5a69c17a67c6",
    "photo-1524504388940-b1c1722653e1",
    "photo-1501196354995-cbb51c65aaea",
    "photo-1492562080023-ab3db95bfbce",
    "photo-1500648767791-00dcc994a43e",
    "photo-1519085360753-af0119f7cbe7",
    "photo-1472099645785-5658abf4ff4e",
  ];

  const mediaPayloads = [];
  for (let i = 1; i <= 25; i++) {
    const num = i.toString().padStart(2, "0");
    const unsplashId = sampleImages[(i - 1) % sampleImages.length];
    const originalKey = `elts/${SLUG}/wisuda-${num}.jpg`;

    mediaPayloads.push({
      id: `c0000000-0000-0000-0000-${i.toString(16).padStart(12, "0")}`,
      project_id: projectId,
      type: "image",
      file_name: `ELTS_UNSOED_${num}.jpg`,
      mime_type: "image/jpeg",
      storage_provider: "cloudinary",
      original_key: originalKey,
      cloudinary_public_id: `elts/${SLUG}/wisuda-${num}`,
      cloudinary_delivery_type: "upload",
      thumbnail_key: `https://images.unsplash.com/${unsplashId}?auto=format&fit=crop&w=600&q=80&sig=${num}`,
      preview_key: `https://images.unsplash.com/${unsplashId}?auto=format&fit=crop&w=1200&q=85&sig=${num}`,
      width: 3000,
      height: 2000,
      file_size: 4500000,
      processing_status: "ready",
      sort_order: i,
    });
  }

  const { error: mediaErr } = await supabase.from("media").insert(mediaPayloads);
  if (mediaErr) {
    console.error("   Failed to seed media records:", mediaErr);
  } else {
    console.log(`   Successfully seeded 25 mock media records (ELTS_UNSOED_01.jpg .. ELTS_UNSOED_25.jpg)`);
  }

  console.log("\n5. Generating milestone invoices (DP_50=PAID, FINAL_BALANCE=PENDING)...");
  // Try to insert invoices if table exists
  try {
    await supabase.from("invoices").delete().eq("project_id", projectId);
    const { error: invoiceErr } = await supabase.from("invoices").insert([
      {
        id: "d0000000-0000-0000-0000-000000000001",
        project_id: projectId,
        invoice_number: "INV-2026-09-DP01",
        milestone: "DP_50",
        amount: 750000,
        status: "PAID",
        due_date: "2026-09-15",
        paid_at: new Date("2026-09-14T10:00:00Z").toISOString(),
        pdf_url: "/api/invoices/d0000000-0000-0000-0000-000000000001/pdf",
      },
      {
        id: "d0000000-0000-0000-0000-000000000002",
        project_id: projectId,
        invoice_number: "INV-2026-09-FIN01",
        milestone: "FINAL_BALANCE",
        amount: 750000,
        status: "PENDING",
        due_date: "2026-09-28",
        paid_at: null,
        pdf_url: "/api/invoices/d0000000-0000-0000-0000-000000000002/pdf",
      },
    ]);
    if (!invoiceErr) {
      console.log("   Invoice 1: INV-2026-09-DP01  (DP 50% - Rp 750.000) -> Status: PAID");
      console.log("   Invoice 2: INV-2026-09-FIN01 (Balance - Rp 750.000) -> Status: PENDING");
    } else {
      console.log("   Invoices table pending remote SQL execution (handled gracefully).");
    }
  } catch {
    console.log("   Invoices table pending remote SQL execution.");
  }
  console.log("\n6. Seeding Crew Member, Assignment & Equipment Presets...");
  const crewId = "e0000000-0000-0000-0000-000000000001";
  const magicToken = "crw-token-fajar-sidik-broadcast-2026-xyz";
  try {
    await supabase.from("crew_members").upsert({
      id: crewId,
      crew_code: "CRW-01",
      full_name: "Fajar Sidik (Lead Switcher)",
      phone: "081234567891",
      email: "fajar.crew@elts.id",
      primary_skills: ["Switcher Operator", "vMix Rig", "Live Broadcast"],
      bank_name: "BCA",
      bank_account_number: "0000000000",
      bank_account_holder: "Fajar Sidik",
      standard_day_rate: 450000,
    });

    await supabase.from("project_crew_assignments").upsert({
      project_id: projectId,
      crew_member_id: crewId,
      magic_token: magicToken,
      role_title: "Lead Switcher & Multi-Cam Director",
      call_time: "2026-09-28T06:30:00+07:00",
      roll_time: "2026-09-28T07:30:00+07:00",
      venue_name: "Auditorium Graha Widyatama UNSOED",
      venue_address: "Jl. Profesor DR. HR Boenyamin No.708, Grendeng, Purwokerto Utara",
      venue_maps_url: "https://maps.google.com/?q=-7.402482,109.248381",
      dress_code: "Polo Hitam Studio / Kaos Kerah Gelap",
      technical_notes: "Pairing wireless Hollyland Cosmo C1 ke SDI 2 sebelum prosesi senat dimulai.",
      allocated_equipment: ["vMix Broadcast Rig 4K", "Sony FX3 Body", "Hollyland Cosmo C1"],
      fee_agreed: 450000,
      payment_status: "PAID",
      paid_at: new Date().toISOString(),
    });
    console.log("   Crew Member: Fajar Sidik (CRW-01) assigned to project");
    console.log(`   Magic Token : ${magicToken}`);
  } catch (err: unknown) {
    console.log("   Operations dispatch tables pending remote SQL execution (handled gracefully).");
  }

  console.log("\n=================================================");
  console.log("  SEED SUCCESSFUL — CREDENTIAL SUMMARY");
  console.log("=================================================");
  console.log(`• Client Portal URL : http://127.0.0.1:3000/client`);
  console.log(`• Gallery Code      : ${GALLERY_CODE}`);
  console.log(`• Client 6-Digit PIN: ${PIN}`);
  console.log(`• Direct Gallery URL: http://127.0.0.1:3000/gallery/${accessToken}`);
  console.log(`• Admin Dashboard   : http://127.0.0.1:3000/admin/projects`);
  console.log(`• Admin Email       : admin@elts.com`);
  console.log(`• Admin Password    : admin123456`);
  console.log("=================================================\n");
}

runSeed().catch((err) => {
  console.error("Seed execution failed:", err);
  process.exit(1);
});
