"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  FileText,
  Sliders,
  Users,
  Package,
  Receipt,
  ArrowLeft,
  Upload,
  CalendarDays,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Printer,
  Send,
  Copy,
  Lock,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabOverviewCallSheet } from "./tab-overview-callsheet";
import { TabSectorSpecs } from "./tab-sector-specs";
import { CrewDispatchKanban } from "@/components/admin/projects/crew/crew-dispatch-kanban";
import { ExpenseWorksheetTable } from "@/components/admin/projects/expense-worksheet-table";
import { HardwarePresetToolbar } from "@/components/admin/projects/hardware-preset-toolbar";
import { GearLogisticsBoard } from "@/components/admin/projects/gear/gear-logistics-board";
import { RentalManifestExportModal } from "@/components/admin/projects/rental-manifest-export-modal";
import { syncExpensesToWaterfallSplit } from "@/app/actions/admin-expenses";
import type {
  ProjectRow,
  CustomerRow,
  InvoiceRow,
  MoneySplitRow,
} from "@/types/database";
import type {
  CrewMemberRow,
  ProjectCrewAssignmentWithCrew,
  ProjectExpenseRow,
  EquipmentPresetRow,
} from "@/types/operations";
import type { InventoryAssetRow } from "@/types/inventory";

export type ProjectWorkspaceTab =
 | "overview"
 | "specs"
 | "crew"
 | "gear"
 | "rab";

interface ProjectTabbedWorkspaceProps {
  project: ProjectRow;
 customer: Pick<CustomerRow, "id" | "name" | "email" | "phone"> | null;
  totalMedia: number;
  invoices: InvoiceRow[];
  crewAssignments: ProjectCrewAssignmentWithCrew[];
  availableCrewMembers: CrewMemberRow[];
  initialExpenses: ProjectExpenseRow[];
  presets: EquipmentPresetRow[];
  initialSplit: MoneySplitRow | null;
  inventoryAssets: InventoryAssetRow[];
}

export function ProjectTabbedWorkspace({
  project,
  customer,
  totalMedia,
  invoices,
  crewAssignments,
  availableCrewMembers,
  initialExpenses,
  presets,
  initialSplit,
  inventoryAssets,
}: ProjectTabbedWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
 const rawTab = searchParams.get("tab") as ProjectWorkspaceTab | null;

 const validTabs: ProjectWorkspaceTab[] = ["overview", "specs", "crew", "gear", "rab"];
  const activeTab: ProjectWorkspaceTab =
 rawTab && validTabs.includes(rawTab) ? rawTab : "overview";

  const [expenses, setExpenses] = useState<ProjectExpenseRow[]>(initialExpenses);
  const [split, setSplit] = useState<MoneySplitRow | null>(initialSplit);
  const [isSyncing, startSyncTransition] = useTransition();
 const [syncNotice, setSyncNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleTabChange = (newTab: ProjectWorkspaceTab) => {
    const params = new URLSearchParams(searchParams.toString());
 params.set("tab", newTab);
 router.replace(`/admin/projects/${project.id}?${params.toString()}`, { scroll: false });
  };

  // Trigger sync from expenses to waterfall split
  const handleSyncToWaterfall = () => {
    setSyncNotice(null);
    startSyncTransition(async () => {
      const res = await syncExpensesToWaterfallSplit(project.id);
      if (res.success && res.split) {
        setSplit(res.split);
        setSyncNotice({
 type: "success",
 message: `Berhasil disinkronkan! Direct Cash Cost Rp ${Number(res.directCosts || 0).toLocaleString("id-ID")}`,
        });
      } else {
        setSyncNotice({
 type: "error",
 message: res.error || "Gagal menyinkronkan pengeluaran.",
        });
      }
    });
  };

  // ── Financial derivation (declared BEFORE handlers to avoid TDZ) ──────────
  const contractVal = Number(project.contract_value) || 0;
  const totalDirectCosts = expenses.reduce((sum, e) => sum + (Number(e.total_cost) || 0), 0);
  const grossProfit = contractVal - totalDirectCosts;
 const grossMarginPct = contractVal > 0 ? ((grossProfit / contractVal) * 100).toFixed(1) : "0";

  /**
   * Real invoice records for this project. The DP milestone is preferred as the
   * primary document; no fabricated invoice number is ever copied to a client.
   */
  const primaryInvoice = useMemo<InvoiceRow | null>(
 () => invoices.find((inv) => inv.milestone === "DP_50") ?? invoices[0] ?? null,
    [invoices]
  );
  const invoiceNumber = primaryInvoice?.invoice_number ?? null;

  const invoiceTotal =
    invoices.length > 0
      ? invoices.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0)
      : contractVal;

  const paidAmount =
    invoices.length > 0
      ? invoices
 .filter((inv) => inv.status === "PAID")
          .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0)
      : project.is_fully_paid
        ? contractVal
        : project.is_dp_paid
          ? Math.round(contractVal * 0.5)
          : 0;

  const balanceDue = Math.max(0, invoiceTotal - paidAmount);

  const [copiedWhatsApp, setCopiedWhatsApp] = useState(false);

  const handleCopyWhatsAppInvoice = async () => {
 const origin = typeof window !== "undefined" ? window.location.origin : "https://elts.id";
 const invoiceRef = invoiceNumber ? `🧾 *No. Invoice:* ${invoiceNumber}\n` : "";
    const invoiceUrl = invoiceNumber
 ? `${origin}/invoice/${encodeURIComponent(invoiceNumber)}`
      : null;

 const text = `Halo Bapak/Ibu *${customer?.name || "Klien"}*,\nBerikut kami sampaikan rincian tagihan resmi dari *ELTS Creative & Digital Studio*:\n\n📋 *Proyek:* ${project.name}\n${invoiceRef}\n💰 *Nilai Kontrak:* Rp ${invoiceTotal.toLocaleString("id-ID")}\n${
      paidAmount > 0
 ? `✅ *Sudah Dibayar:* Rp ${paidAmount.toLocaleString("id-ID")}\n⏳ *Sisa Pelunasan:* Rp ${balanceDue.toLocaleString("id-ID")}`
 : `💳 *Total Tagihan:* Rp ${invoiceTotal.toLocaleString("id-ID")}`
    }\n\nRekening Pembayaran:\n• BCA: 3581216520 a.n. Emri Luthfan A.\n• Mandiri: 1560023148218 a.n. Muhammad Rayyan Nufail\n${
 invoiceUrl ? `\n📄 Unduh / Cetak Invoice Resmi:\n${invoiceUrl}\n` : ""
 }\nTerima kasih atas kerja samanya! 🙏`;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedWhatsApp(true);
      setTimeout(() => setCopiedWhatsApp(false), 2500);
    } catch {
      // Clipboard unavailable (insecure context) — fail silently.
    }
  };

  const tabs = [
 { id: "overview" as ProjectWorkspaceTab, label: "1. Call Sheet & Overview", icon: FileText },
 { id: "specs" as ProjectWorkspaceTab, label: "2. Staging & Specs", icon: Sliders },
 { id: "crew" as ProjectWorkspaceTab, label: "3. Tim Kru", icon: Users, badge: crewAssignments.length },
 { id: "gear" as ProjectWorkspaceTab, label: "4. Alat & Logistik", icon: Package },
 { id: "rab" as ProjectWorkspaceTab, label: "5. Keuangan (Invoices & RAB)", icon: Receipt },
  ];

  return (
 <div className="max-w-5xl mx-auto space-y-6">
      {/* 1. Header & Breadcrumbs */}
      <div>
        <Link
 href="/admin/projects"
 className="inline-flex items-center gap-1.5 text-xs text-[#71717a] hover:text-[#09090b] transition-colors mb-3"
        >
          <ArrowLeft size={14} /> Semua Proyek
        </Link>

 <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
 <div className="flex items-center gap-2 mb-1.5">
 <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-[#fafafa] text-[#3f3f46] font-bold uppercase">
 {project.service_pillar || "PRODUCTION"}
              </span>
 <span className="text-xs text-[#71717a] font-medium">
 • {customer?.name || "Klien Tanpa Nama"}
              </span>
            </div>
 <h1 className="font-bold text-2xl sm:text-3xl tracking-tight text-[#09090b] font-serif">
              {project.name}
            </h1>
          </div>

 <div className="flex items-center gap-2 shrink-0">
            {project.is_dp_paid ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-[#fafafa] text-[#3f3f46] border border-[#ececee]">
                <CheckCircle2 size={13} /> DP Lunas
              </span>
            ) : (
 <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-[#fafafa] text-[#52525b] border border-[#ececee] ">
                Belum DP
              </span>
            )}

            {project.is_fully_paid ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-[#fafafa] text-[#3f3f46] border border-[#ececee]">
                <CheckCircle2 size={13} /> Lunas 100%
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border border-[#ff5a00]/30 bg-[#ff5a00]/10 text-[#c2410c]">
                Sisa Tagihan
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Glassmorphic Tab Container */}
 <div className="w-full overflow-x-auto no-scrollbar pb-2">
        <div className="inline-flex items-center gap-1.5 p-1.5 rounded-[10000px] bg-[#fafafa] border border-[#ececee]">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
 type="button"
                onClick={() => handleTabChange(tab.id)}
 aria-current={isActive ? "page" : undefined}
                className={`min-h-11 px-4 rounded-[10000px] text-xs font-semibold tracking-tight transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  isActive
                    ? "rounded-[10000px] bg-[#09090b] text-white font-bold"
                    : "rounded-[10000px] border border-[#ececee] bg-white text-[#3f3f46] hover:bg-[#fafafa]"
                }`}
              >
                <tab.icon className={`w-3.5 h-3.5 ${isActive ? "text-white" : "text-[#3f3f46]"}`} />
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
 <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono border ${
                    isActive
                      ? "bg-[#ff5a00] text-white border-transparent"
                      : "bg-[#f4f4f5] text-[#3f3f46] border-transparent"
 }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Tab Contents Canvas */}
      <div>
        {/* TAB 1: OVERVIEW & CALL SHEET */}
 {activeTab === "overview" && (
          <TabOverviewCallSheet
            project={project}
            customer={customer}
            totalMedia={totalMedia}
            invoices={invoices}
          />
        )}

        {/* TAB 2: SECTOR SPECS DYNAMIC RENDERER */}
 {activeTab === "specs" && (
          <TabSectorSpecs project={project} />
        )}

        {/* TAB 3: CREW ROSTER & DISPATCH */}
 {activeTab === "crew" && (
 <div className="space-y-6">
            <CrewDispatchKanban
              projectId={project.id}
              projectName={project.name}
              shootDate={project.shoot_date}
              rehearsalDate={project.rehearsal_date}
              initialAssignments={crewAssignments}
              availableCrewMembers={availableCrewMembers}
            />
          </div>
        )}

        {/* TAB 4: GEAR & LOGISTICS */}
 {activeTab === "gear" && (
 <div className="space-y-6">
        <div className="rounded-[36px] border border-[#ececee] bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
 <h4 className="font-bold text-lg tracking-tight text-[#09090b] ">
                  Alokasi Perangkat &amp; Logistik Sewa Vendor
                </h4>
 <p className="text-xs font-medium text-[#71717a] mt-0.5">
                  Direktori 3-tier, checklist staging, dan ekspor PO vendor dalam satu papan kerja
                </p>
              </div>

              <RentalManifestExportModal
                projectId={project.id}
                projectName={project.name}
                shootDate={project.shoot_date}
                expenses={expenses}
              />
            </div>

            <HardwarePresetToolbar
              projectId={project.id}
              onExpenseAdded={(newExp) => setExpenses((prev) => [...prev, newExp])}
            />

            <GearLogisticsBoard
              projectId={project.id}
              inventoryAssets={inventoryAssets}
              expenses={expenses}
              onExpenseChanged={(updated) =>
                setExpenses((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
              }
            />
          </div>
        )}

 {activeTab === "rab" && (
 <div className="space-y-8">
            {/* ── CARD 1: TAGIHAN KLIEN (COMMERCIAL INVOICES) ───────────── */}
          <div className="rounded-[36px] border border-[#ececee] bg-white p-6 space-y-5">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
                <div>
 <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-[#fafafa] text-[#3f3f46] font-bold uppercase border border-[#ececee]">
                      TAGIHAN KLIEN RESMI
                    </span>
 <span className="text-xs text-[#71717a]">• Dokumen Komersial Terpisah</span>
                  </div>
 <h4 className="font-serif font-bold text-xl text-[#09090b] ">
                    Commercial Invoice &amp; Penagihan Klien
                  </h4>
 <p className="text-xs text-[#71717a] mt-0.5">
                    Hanya memuat nilai kontrak dan add-on retail; zero-leakage atas biaya dapur studio
                  </p>
                </div>

 <div className="flex items-center gap-2">
                  {invoiceNumber ? (
                    <Button
                      asChild
 size="sm"
 className="bg-[#09090b] hover:bg-[#27272a] text-white text-xs font-semibold h-11 sm:h-9 px-4 rounded-xl shadow-xs transition-colors"
                    >
                      <a
 href={`/invoice/${encodeURIComponent(invoiceNumber)}`}
 target="_blank"
 rel="noreferrer"
                      >
 <Printer size={14} className="mr-1.5" />
                        <span>Cetak / Unduh PDF</span>
                      </a>
                    </Button>
                  ) : (
 <span className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-4 rounded-xl bg-[#fafafa] border border-[#ececee]/80 text-[11px] font-medium text-[#71717a] ">
                      <AlertCircle size={13} /> Belum ada invoice terbit
                    </span>
                  )}

                  <Button
 type="button"
 size="sm"
                    onClick={handleCopyWhatsAppInvoice}
                    className="bg-[#09090b] hover:bg-[#27272a] text-white text-xs font-semibold h-11 px-4 rounded-[14px] transition-colors cursor-pointer"
                  >
 {copiedWhatsApp ? <Check size={14} className="mr-1.5" /> : <Send size={14} className="mr-1.5" />}
 <span>{copiedWhatsApp ? "Tersalin!" : "Salin WhatsApp Tagihan"}</span>
                  </Button>
                </div>
              </div>

              {/* Commercial Invoice Status Ribbon (4 Clean Tiles) */}
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4">
 <span className="text-[#a1a1aa] block text-[10px] font-mono uppercase">NILAI TAGIHAN</span>
 <span className="text-[#09090b] font-mono font-bold text-lg">
 Rp {invoiceTotal.toLocaleString("id-ID")}
                  </span>
                </div>

                <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4">
 <span className="text-[#a1a1aa] block text-[10px] font-mono uppercase">SUDAH DIBAYAR</span>
                  <span className="text-[#09090b] font-mono font-bold text-lg">
 Rp {paidAmount.toLocaleString("id-ID")}
                  </span>
                </div>

                <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4">
 <span className="text-[#a1a1aa] block text-[10px] font-mono uppercase">SISA PELUNASAN</span>
                  <span className="text-[#09090b] font-mono font-bold text-lg">
 Rp {balanceDue.toLocaleString("id-ID")}
                  </span>
                </div>

                <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4">
 <span className="text-[#a1a1aa] block text-[10px] font-mono uppercase">STATUS TAGIHAN</span>
 <div className="pt-1">
                    {balanceDue === 0 && invoiceTotal > 0 ? (
                      <span className="text-[#3f3f46] bg-[#fafafa] border border-[#ececee] px-2 py-0.5 rounded-full text-xs font-semibold">LUNAS 100%</span>
                    ) : paidAmount > 0 ? (
                      <span className="text-[#3f3f46] bg-[#fafafa] border border-[#ececee] px-2 py-0.5 rounded-full text-xs font-semibold">DP LUNAS</span>
                    ) : (
                      <span className="text-[#c2410c] bg-[#ff5a00]/10 border border-[#ff5a00]/20 px-2 py-0.5 rounded-full text-xs font-semibold">BELUM BAYAR</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── CARD 2: RENCANA ANGGARAN BIAYA (RAB DAPUR & SPLIT) ───── */}
 <div className="space-y-6">
              {/* Strict Zero-Leakage Privacy Banner */}
 <div className="bg-[#fafafa]/80 border border-[#ececee]/80 text-[#52525b] rounded-xl px-4 py-3 text-xs flex items-center gap-2.5 shadow-2xs">
                <Lock size={15} className="shrink-0 text-[#3f3f46]" />
 <p className="text-xs leading-relaxed">
 <strong className="text-[#09090b] font-semibold">INTERNAL STUDIO PRIVACY:</strong> Seluruh rincian biaya honorarium kru, vendor rental, dan margin bersih di bawah ini bersifat rahasia dapur studio dan tidak pernah ditampilkan ke invoice klien.
                </p>
              </div>

              {/* Financial Health Ribbon (4 Clean Metric Tiles) */}
 <div className="bg-white/80 backdrop-blur-xl border border-[#ececee]/80 rounded-2xl p-6 shadow-xs">
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
 <div className="bg-[#fafafa]/80 rounded-xl p-4 border border-[#fafafa] ">
 <span className="text-[#a1a1aa] block text-[10px] font-mono uppercase">NILAI KONTRAK</span>
 <span className="text-[#09090b] font-mono font-bold text-lg">
 Rp {contractVal.toLocaleString("id-ID")}
                    </span>
                  </div>

 <div className="bg-[#fafafa]/80 rounded-xl p-4 border border-[#fafafa] ">
 <span className="text-[#a1a1aa] block text-[10px] font-mono uppercase">BIAYA LANGSUNG KAS</span>
                  <span className="text-[#09090b] font-mono font-bold text-lg">
 Rp {totalDirectCosts.toLocaleString("id-ID")}
                    </span>
                  </div>

 <div className="bg-[#fafafa]/80 rounded-xl p-4 border border-[#fafafa] ">
 <span className="text-[#a1a1aa] block text-[10px] font-mono uppercase">GROSS PROFIT</span>
                  <span className="text-[#09090b] font-mono font-bold text-lg">
 Rp {grossProfit.toLocaleString("id-ID")}
                    </span>
                  </div>

 <div className="bg-[#fafafa]/80 rounded-xl p-4 border border-[#fafafa] ">
 <span className="text-[#a1a1aa] block text-[10px] font-mono uppercase">MARGIN BERSIH</span>
 <span className="text-[#09090b] font-mono font-bold text-lg">
                      {grossMarginPct}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Sync Alert Notice */}
              {syncNotice && (
                <div
 className={`p-4 rounded-xl border text-xs flex items-center justify-between ${
 syncNotice.type === "success"
                    ? "bg-[#fafafa] text-[#3f3f46] border-[#ececee]"
                    : "bg-[#ff5a00]/10 text-[#c2410c] border-[#ff5a00]/20"
 }`}
                >
                  <span>{syncNotice.message}</span>
                  <button
 type="button"
                    onClick={() => setSyncNotice(null)}
 className="font-bold underline cursor-pointer"
                  >
                    Tutup
                  </button>
                </div>
              )}

              {/* Actions Bar */}
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white/80 backdrop-blur-md border border-[#ececee]/80 rounded-xl">
                <div>
 <h5 className="font-bold text-sm text-[#09090b] ">
                    Sinkronisasi Otomatis RAB ke Waterfall Split
                  </h5>
 <p className="text-xs font-medium text-[#71717a] ">
                    Hanya biaya kas riil (outflow) yang mengurangi dividen pendiri studio
                  </p>
                </div>

 <div className="flex items-center gap-2">
                  <Button
 type="button"
                    onClick={handleSyncToWaterfall}
                    disabled={isSyncing}
                    className="bg-[#09090b] hover:bg-[#27272a] text-white text-xs gap-1.5 font-semibold"
                  >
 {isSyncing ? "Menyinkronkan..." : "🔄 Sinkronkan ke Waterfall Split"}
                  </Button>
 <Button asChild variant="outline" size="sm" className="text-xs">
 <Link href={`/admin/projects/${project.id}/finance`}>
                      Buka Halaman Finance Lengkap ↗
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Expense Worksheet Table */}
              <ExpenseWorksheetTable
                projectId={project.id}
                initialExpenses={expenses}
                onExpensesChanged={(updated: ProjectExpenseRow[]) => setExpenses(updated)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
