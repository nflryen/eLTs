"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { requirePermission, requireOps } from "@/lib/auth/roles";
import { generateGalleryCredentials, hashGalleryPin } from "@/lib/security/credentials";
import { getPinPepper } from "@/lib/env";

export type InvoiceType = "PROJECT" | "EQUIPMENT_RENTAL";

export interface GlobalInvoiceListItem {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  projectId: string;
  projectName: string;
  customerName: string;
  customerPhone: string;
  customerCompany?: string | null;
  type: InvoiceType;
  grossAmount: number;
  paidAmount: number;
  balanceDue: number;
  status: "UNPAID" | "PARTIALLY_PAID" | "PAID_IN_FULL" | "OVERPAID" | "CANCELLED";
  lineItems: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    duration_days?: number;
    asset_id?: string;
  }>;
  clientNotes: string | null;
  isRental: boolean;
  rentalPeriod?: {
    startDate: string;
    endDate: string;
    durationDays: number;
  } | null;
}

export interface GlobalInvoicesOverview {
  invoices: GlobalInvoiceListItem[];
  metrics: {
    totalInvoiced: number;
    totalCollected: number;
    totalOutstanding: number;
    countTotal: number;
    countUnpaid: number;
    countPartiallyPaid: number;
    countPaid: number;
  };
}

export interface AvailableAsset {
  id: string;
  assetCode: string;
  name: string;
  category: string;
  dailyRentalRate: number;
}

export interface AvailableProject {
  id: string;
  name: string;
  contractValue: number;
  customerName: string;
  customerPhone: string;
}

/** Jakarta today in YYYY-MM period format for document sequence generation */
function jakartaPeriodKey(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  }).format(d);
  return parts.slice(0, 7); // e.g. "2026-10"
}

function jakartaTodayString(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Queries all invoices across production projects and dry-hire rentals,
 * joined with financial balances from `v_invoice_financial_position`.
 */
export async function getGlobalInvoicesList(): Promise<{
  success: boolean;
  data?: GlobalInvoicesOverview;
  error?: string;
}> {
  try {
    const { supabase } = await requirePermission("invoice.read");

    // 1. Fetch all invoices with position and project details
    const { data: rawInvoices, error: invError } = await supabase
      .from("project_invoices")
      .select(`
        id,
        invoice_number,
        issue_date,
        due_date,
        gross_contract_value,
        minimum_dp_pct,
        line_items,
        client_notes,
        is_cancelled,
        created_at,
        projects:project_id (
          id,
          name,
          slug,
          service_pillar,
          shoot_date,
          sector_specs,
          customer_id,
          customers:customer_id (
            id,
            name,
            phone,
            email
          )
        )
      `)
      .order("issue_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (invError) {
      console.error("[getGlobalInvoicesList] Failed to load invoices:", invError);
      return { success: false, error: invError.message };
    }

    // 2. Fetch real-time financial positions from derived view
    const { data: positions, error: posError } = await supabase
      .from("v_invoice_financial_position")
      .select("*");

    if (posError) {
      console.error("[getGlobalInvoicesList] Failed to load financial positions:", posError);
    }

    type InvoicePositionRow = NonNullable<typeof positions>[number];
    const posMap = new Map<string, InvoicePositionRow>();
    (positions ?? []).forEach((p) => {
      posMap.set(p.invoice_id, p);
    });

    let totalInvoiced = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;
    let countUnpaid = 0;
    let countPartiallyPaid = 0;
    let countPaid = 0;

    const invoices: GlobalInvoiceListItem[] = (rawInvoices ?? []).map((inv) => {
      const pos = posMap.get(inv.id);
      const proj = inv.projects as unknown as {
        id: string;
        name: string;
        slug: string;
        service_pillar: string;
        shoot_date: string | null;
        sector_specs: Record<string, unknown> | null;
        customers: { id: string; name: string; phone: string | null; email: string | null } | null;
      } | null;

      const specs = proj?.sector_specs ?? {};
      const isRental =
        specs.isRental === true ||
        specs.type === "EQUIPMENT_RENTAL" ||
        (proj?.name ?? "").toLowerCase().includes("sewa alat") ||
        (proj?.name ?? "").toLowerCase().includes("rental");

      const grossAmount = Number(pos?.contract_value ?? inv.gross_contract_value ?? 0);
      const paidAmount = Number(pos?.paid_amount ?? 0);
      const balanceDue = Number(pos?.balance_due ?? grossAmount);
      const status = (pos?.derived_status ?? (inv.is_cancelled ? "CANCELLED" : "UNPAID")) as GlobalInvoiceListItem["status"];

      if (status !== "CANCELLED") {
        totalInvoiced += grossAmount;
        totalCollected += paidAmount;
        totalOutstanding += balanceDue;

        if (status === "UNPAID") countUnpaid++;
        else if (status === "PARTIALLY_PAID") countPartiallyPaid++;
        else if (status === "PAID_IN_FULL" || status === "OVERPAID") countPaid++;
      }

      let rentalPeriod: GlobalInvoiceListItem["rentalPeriod"] = null;
      if (isRental && specs.rentalStartDate && specs.rentalEndDate) {
        rentalPeriod = {
          startDate: String(specs.rentalStartDate),
          endDate: String(specs.rentalEndDate),
          durationDays: Number(specs.durationDays ?? 1),
        };
      }

      /*
       * Normalise line items on READ.
       *
       * `subtotal` is derived data: quantity x unit_price. The write path
       * persists it, but a row created before that field existed (or by an
       * importer) has no `subtotal`, and the renderer calls `idr(li.subtotal)`.
       * Deriving it here means the DTO is always complete regardless of what
       * is stored, instead of pushing a null into a formatter.
       */
      const rawLineItems = (Array.isArray(inv.line_items) ? inv.line_items : []) as unknown as Record<string, unknown>[];
      const lineItems = rawLineItems.map((li: Record<string, unknown>) => {
        const quantity = Number(li.quantity ?? 0);
        const unitPrice = Number(li.unit_price ?? 0);
        const stored = Number(li.subtotal);
        return {
          ...li,
          description: String(li.description ?? ""),
          quantity: Number.isFinite(quantity) ? quantity : 0,
          unit_price: Number.isFinite(unitPrice) ? unitPrice : 0,
          subtotal: Number.isFinite(stored)
            ? stored
            : Math.round((Number.isFinite(quantity) ? quantity : 0) * (Number.isFinite(unitPrice) ? unitPrice : 0)),
        };
      }) as GlobalInvoiceListItem["lineItems"];

      return {
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        issueDate: inv.issue_date,
        dueDate: inv.due_date,
        projectId: proj?.id ?? "",
        projectName: proj?.name ?? "Proyek Tanpa Nama",
        customerName: proj?.customers?.name ?? "Klien Umum",
        customerPhone: proj?.customers?.phone ?? "-",
        customerCompany: (specs.company as string) || null,
        type: isRental ? "EQUIPMENT_RENTAL" : "PROJECT",
        grossAmount,
        paidAmount,
        balanceDue,
        status,
        lineItems,
        clientNotes: inv.client_notes,
        isRental,
        rentalPeriod,
      };
    });

    return {
      success: true,
      data: {
        invoices,
        metrics: {
          totalInvoiced,
          totalCollected,
          totalOutstanding,
          countTotal: invoices.length,
          countUnpaid,
          countPartiallyPaid,
          countPaid,
        },
      },
    };
  } catch (err: unknown) {
    console.error("[getGlobalInvoicesList] Unexpected error:", err);
    return { success: false, error: err instanceof Error ? err.message : "Gagal memuat invoice." };
  }
}

/**
 * Retrieves assets and active projects for the "+ Buat Invoice Baru" modal dropdowns.
 */
export async function getRentalFormPrerequisites(): Promise<{
  success: boolean;
  assets: AvailableAsset[];
  projects: AvailableProject[];
  error?: string;
}> {
  try {
    const { supabase } = await requirePermission("invoice.read");

    const [assetsRes, projectsRes] = await Promise.all([
      supabase
        .from("inventory_assets")
        .select("id, asset_code, name, category, daily_rental_rate")
        .order("name", { ascending: true }),
      supabase
        .from("projects")
        .select(`
          id,
          name,
          contract_value,
          customers:customer_id (
            name,
            phone
          )
        `)
        .order("created_at", { ascending: false })
        .limit(60),
    ]);

    const assets: AvailableAsset[] = (assetsRes.data ?? []).map((a) => ({
      id: a.id,
      assetCode: a.asset_code,
      name: a.name,
      category: a.category,
      dailyRentalRate: Number(a.daily_rental_rate) || 0,
    }));

    const projects: AvailableProject[] = (projectsRes.data ?? []).map((p) => {
      const cust = p.customers as unknown as { name?: string; phone?: string } | null;
      return {
        id: p.id,
        name: p.name,
        contractValue: Number(p.contract_value) || 0,
        customerName: cust?.name || "Klien Umum",
        customerPhone: cust?.phone || "-",
      };
    });

    return { success: true, assets, projects };
  } catch (err: unknown) {
    return {
      success: false,
      assets: [],
      projects: [],
      error: err instanceof Error ? err.message : "Gagal memuat aset & proyek.",
    };
  }
}

// ── Validation Schemas ────────────────────────────────────────────────────────

const rentalLineItemSchema = z.object({
  description: z.string().trim().min(1, "Nama alat/deskripsi wajib diisi"),
  assetId: z.string().uuid().optional().nullable(),
  quantity: z.number().int().min(1, "Jumlah minimal 1"),
  durationDays: z.number().int().min(1, "Durasi minimal 1 hari"),
  unitPrice: z.number().min(0, "Harga satuan tidak boleh negatif"),
  subtotal: z.number().min(0),
});

const createRentalInvoiceSchema = z.object({
  mode: z.enum(["RENTAL", "PROJECT"]),
  // Mode B: Rental Details
  clientName: z.string().trim().optional(),
  company: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  rentalStartDate: z.string().trim().optional(),
  rentalEndDate: z.string().trim().optional(),
  durationDays: z.number().int().min(1).optional(),
  // Mode A: Existing Project
  projectId: z.string().uuid().optional(),
  // Shared Invoice Data
  lineItems: z.array(rentalLineItemSchema).min(1, "Minimal harus ada 1 rincian item"),
  minimumDpPct: z.number().min(0).max(100).default(30),
  dueDate: z.string().trim().min(10, "Tanggal jatuh tempo wajib diisi"),
  clientNotes: z.string().trim().optional(),
});

export type CreateRentalInvoiceInput = z.infer<typeof createRentalInvoiceSchema>;

/**
 * Creates an ad-hoc rental invoice (with client & project bridge) OR attaches
 * an invoice to an existing production project.
 */
export async function createRentalInvoiceAction(input: CreateRentalInvoiceInput): Promise<{
  success: boolean;
  invoiceNumber?: string;
  invoiceId?: string;
  error?: string;
}> {
  try {
    // User-scoped client: `requirePermission("invoice.issue")` authorises the
    // action, and RLS now independently confirms the caller may write invoices.
    // Previously service_role made the permission check the only barrier (B3).
    const { supabase } = await requirePermission("invoice.issue");
    const parsed = createRentalInvoiceSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Input invoice tidak valid.",
      };
    }

    const data = parsed.data;
    const today = jakartaTodayString();
    const periodKey = jakartaPeriodKey();

    // 1. Calculate Gross Contract Total
    const grossContractValue = data.lineItems.reduce(
      (sum, item) => sum + Math.round(item.subtotal),
      0
    );

    if (grossContractValue <= 0) {
      return { success: false, error: "Total nilai tagihan harus lebih besar dari Rp 0." };
    }

    let targetProjectId = data.projectId;

    // 2. Mode B: Ad-Hoc Rental Setup
    if (data.mode === "RENTAL") {
      if (!data.clientName || data.clientName.trim().length < 2) {
        return { success: false, error: "Nama penyewa / klien minimal 2 karakter." };
      }
      if (!data.phone || data.phone.trim().length < 6) {
        return { success: false, error: "Nomor WhatsApp / telepon penyewa wajib diisi." };
      }

      const clientName = data.clientName.trim();
      const phone = data.phone.trim();
      const cleanPhone = phone.replace(/[^0-9+]/g, "").trim();
      const company = data.company?.trim() || null;
      const address = data.address?.trim() || null;
      const startDate = data.rentalStartDate?.trim() || today;
      const endDate = data.rentalEndDate?.trim() || today;
      const durationDays = data.durationDays || 1;

      // Find or create customer (only valid columns: name, phone, email)
      let customerId: string | null = null;

      const { data: existingCustByPhone, error: phoneErr } = await supabase
        .from("customers")
        .select("id, name, phone")
        .eq("phone", cleanPhone)
        .maybeSingle();

      if (phoneErr) {
        console.warn("[createRentalInvoiceAction] Customer phone lookup warning:", phoneErr.message);
      }

      if (existingCustByPhone) {
        customerId = existingCustByPhone.id;
      } else {
        // Check by name as secondary lookup
        const { data: existingCustByName } = await supabase
          .from("customers")
          .select("id, name, phone")
          .ilike("name", clientName)
          .maybeSingle();

        if (existingCustByName) {
          customerId = existingCustByName.id;
          if (!existingCustByName.phone && cleanPhone) {
            await supabase
              .from("customers")
              .update({ phone: cleanPhone, updated_at: new Date().toISOString() })
              .eq("id", customerId);
          }
        } else {
          // Insert new customer cleanly without nonexistent columns
          const { data: newCust, error: custErr } = await supabase
            .from("customers")
            .insert({
              name: clientName,
              phone: cleanPhone || null,
              email: null,
            })
            .select("id")
            .single();

          if (custErr || !newCust) {
            console.error("Customer creation error:", custErr);
            return {
              success: false,
              error: `Gagal mendaftarkan data klien baru: ${custErr?.message || "Kesalahan database"}`,
            };
          }
          customerId = newCust.id;
        }
      }

      // Generate credentials for the rental project bridge
      const creds = generateGalleryCredentials();
      const pepper = getPinPepper();
      const pinHash = await hashGalleryPin(creds.pin, pepper);

      const uniqueSuffix = randomBytes(3).toString("hex").toLowerCase();
      const rentalSlug = `rental-${Date.now().toString(36).toLowerCase()}-${uniqueSuffix}`;
      const projectName = `Sewa Alat - ${clientName} (${startDate})`.slice(0, 190);

      const { data: newProject, error: projErr } = await supabase
        .from("projects")
        .insert({
          name: projectName,
          slug: rentalSlug,
          customer_id: customerId,
          service_pillar: "COMMERCIAL_VIDEO",
          photography_type: "event", // Valid enum in public.photography_type
          contract_value: grossContractValue,
          shoot_date: startDate,
          status: "ready",
          gallery_code: creds.galleryCode,
          gallery_pin_hash: pinHash,
          access_token: creds.accessToken,
          sector_specs: {
            type: "EQUIPMENT_RENTAL",
            isRental: true,
            company,
            address,
            rentalStartDate: startDate,
            rentalEndDate: endDate,
            durationDays,
          },
        })
        .select("id")
        .single();

      if (projErr || !newProject) {
        console.error("Project bridge creation error:", projErr);
        return {
          success: false,
          error: `Gagal membuat proyek sewa: ${projErr?.message || "Kesalahan database"}`,
        };
      }

      targetProjectId = newProject.id;
    }

    if (!targetProjectId) {
      return { success: false, error: "ID proyek tidak valid." };
    }

    // 3. Mint atomic invoice number via Postgres sequence
    const { data: invNum, error: rpcErr } = await supabase.rpc("next_document_number", {
      p_doc_type: "INV",
      p_period_key: periodKey,
    });

    if (rpcErr || !invNum) {
      console.error("[createRentalInvoiceAction] next_document_number failed:", rpcErr);
      return { success: false, error: "Gagal menerbitkan nomor invoice baru." };
    }

    const invoiceNumber = invNum as string;

    // 4. Format line items to standard JSON schema
    const formattedLineItems = data.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      duration_days: item.durationDays,
      subtotal: Math.round(item.subtotal),
      asset_id: item.assetId || undefined,
    }));

    // 5. Insert invoice record into `project_invoices`
    const { data: invoiceRecord, error: invInsertErr } = await supabase
      .from("project_invoices")
      .insert({
        project_id: targetProjectId,
        invoice_number: invoiceNumber,
        issue_date: today,
        due_date: data.dueDate,
        line_items: formattedLineItems,
        gross_contract_value: grossContractValue,
        minimum_dp_pct: data.minimumDpPct,
        client_notes: data.clientNotes?.trim() || null,
      })
      .select("id, invoice_number")
      .single();

    if (invInsertErr || !invoiceRecord) {
      console.error("Invoice creation error:", invInsertErr);
      return {
        success: false,
        error: `Gagal menyimpan data invoice: ${invInsertErr?.message || "Kesalahan database"}`,
      };
    }

    // 6. Cache revalidation
    revalidatePath("/admin/invoices");
    revalidatePath(`/admin/projects/${targetProjectId}`);
    revalidatePath("/admin/finance");

    return {
      success: true,
      invoiceNumber: invoiceRecord.invoice_number,
      invoiceId: invoiceRecord.id,
    };
  } catch (err: unknown) {
    console.error("[createRentalInvoiceAction] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Terjadi kesalahan sistem saat membuat invoice.",
    };
  }
}

/**
 * Generates a commercial invoice directly from a project's configuration,
 * deliverables, and applied referral discounts.
 */
export async function generateProjectInvoiceAction(projectId: string): Promise<{
  success: boolean;
  invoiceNumber?: string;
  invoiceId?: string;
  error?: string;
}> {
  try {
    const { supabase } = await requireOps();
    if (!projectId) {
      return { success: false, error: "ID proyek tidak valid." };
    }

    // 1. Fetch project details
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name, customer_id, contract_value, dp_amount, service_pillar, sector_specs, referral_code, referral_discount_amount")
      .eq("id", projectId)
      .maybeSingle();

    if (projErr || !project) {
      return { success: false, error: "Data proyek tidak ditemukan." };
    }

    // 2. Check if active invoice already exists
    const { data: existingInv } = await supabase
      .from("project_invoices")
      .select("id, invoice_number")
      .eq("project_id", projectId)
      .eq("is_cancelled", false)
      .maybeSingle();

    if (existingInv) {
      return {
        success: false,
        error: `Invoice ${existingInv.invoice_number} sudah aktif untuk proyek ini.`,
      };
    }

    const today = jakartaTodayString();
    const periodKey = jakartaPeriodKey();

    // 3. Mint atomic invoice number
    const { data: invNum, error: rpcErr } = await supabase.rpc("next_document_number", {
      p_doc_type: "INV",
      p_period_key: periodKey,
    });

    if (rpcErr || !invNum) {
      return { success: false, error: "Gagal menerbitkan nomor invoice baru." };
    }

    const invoiceNumber = invNum as string;

    // 4. Calculate line items
    const netContract = Number(project.contract_value) || 0;
    const referralDiscount = Number(project.referral_discount_amount) || 0;
    const baseContract = netContract + referralDiscount;

    const sectorSpecs = (project.sector_specs ?? {}) as Record<string, unknown>;
    const pkg = sectorSpecs.package as { name?: string; categoryName?: string; includes?: string[] } | undefined;
    const mainDesc = pkg?.name
      ? `${pkg.categoryName ? `${pkg.categoryName} — ` : ""}${pkg.name}`
      : `${project.name} (${project.service_pillar || "PRODUKSI"})`;

    const lineItems: Array<{
      description: string;
      quantity: number;
      unit_price: number;
      subtotal: number;
    }> = [
      {
        description: mainDesc,
        quantity: 1,
        unit_price: baseContract,
        subtotal: baseContract,
      },
    ];

    if (referralDiscount > 0) {
      lineItems.push({
        description: `Diskon Referral (${project.referral_code || "KODE"})`,
        quantity: 1,
        unit_price: -referralDiscount,
        subtotal: -referralDiscount,
      });
    }

    const dueDateObj = new Date();
    dueDateObj.setDate(dueDateObj.getDate() + 14);
    const dueDate = dueDateObj.toISOString().slice(0, 10);

    // 5. Insert into project_invoices
    const { data: invRecord, error: insertErr } = await supabase
      .from("project_invoices")
      .insert({
        project_id: projectId,
        invoice_number: invoiceNumber,
        issue_date: today,
        due_date: dueDate,
        line_items: lineItems,
        gross_contract_value: netContract,
        minimum_dp_pct: 50,
        referral_code: project.referral_code || null,
        referral_discount_amount: referralDiscount > 0 ? referralDiscount : undefined,
      })
      .select("id, invoice_number")
      .single();

    if (insertErr || !invRecord) {
      return { success: false, error: `Gagal menyimpan invoice: ${insertErr?.message || "Kesalahan database"}` };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath("/admin/invoices");
    revalidatePath("/admin/finance");

    return {
      success: true,
      invoiceNumber: invRecord.invoice_number,
      invoiceId: invRecord.id,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Terjadi kesalahan sistem saat membuat invoice.",
    };
  }
}
