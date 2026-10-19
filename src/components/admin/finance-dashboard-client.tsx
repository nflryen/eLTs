"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import {
  Coins,
  TrendingUp,
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Calculator,
  ExternalLink,
  History,
  X,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createOrUpdateProjectSplit,
  approveSplit,
  createLedgerEntry,
} from "@/app/actions/admin-finance";
import {
  calculateWaterfallSplit,
  type CashLedgerType,
  type CashLedgerCategory,
  type FinanceOverviewData,
} from "@/lib/finance/waterfall";

interface FinanceDashboardClientProps {
  initialData: FinanceOverviewData;
}

function formatIDR(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function FinanceDashboardClient({ initialData }: FinanceDashboardClientProps) {
  const [data, setData] = useState<FinanceOverviewData>(initialData);
  const [activeTab, setActiveTab] = useState<"splits" | "ledger">("splits");
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Split Creator Modal / Drawer State
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [grossInput, setGrossInput] = useState<string>("");
  const [directCostsInput, setDirectCostsInput] = useState<string>("0");
  const [commissionPctInput, setCommissionPctInput] = useState<string>("0");
  const [closerNameInput, setCloserNameInput] = useState<string>("");

  // Ledger Movement Modal State
  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState(false);
  const [ledgerType, setLedgerType] = useState<CashLedgerType>("OUTFLOW");
  const [ledgerCategory, setLedgerCategory] = useState<CashLedgerCategory>("EQUIPMENT_MAINTENANCE");
  const [ledgerAmount, setLedgerAmount] = useState<string>("");
  const [ledgerDescription, setLedgerDescription] = useState<string>("");

  // Approving split tracking
  const [approvingState, setApprovingState] = useState<Record<string, "A" | "B" | null>>({});

  // Real-time calculation preview for Split Modal
  const previewCalculation = useMemo(() => {
    const gross = Number(grossInput) || 0;
    const costs = Number(directCostsInput) || 0;
    const commPct = Number(commissionPctInput) || 0;
    return calculateWaterfallSplit({
      grossRevenue: gross,
      directCosts: costs,
      reservePct: 5.0,
      commissionPct: commPct,
      closerName: closerNameInput,
    });
  }, [grossInput, directCostsInput, commissionPctInput, closerNameInput]);

  // Handle project selection in Split Modal
  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    const proj = data.availableProjects.find((p) => p.id === projectId);
    if (proj && proj.contract_value > 0) {
      setGrossInput(String(proj.contract_value));
    }
    // If project already has a split, load existing values
    const existing = data.splits.find((s) => s.project_id === projectId);
    if (existing) {
      setGrossInput(String(existing.gross_revenue));
      setDirectCostsInput(String(existing.direct_costs));
      setCommissionPctInput(String(existing.commission_pct));
      setCloserNameInput(existing.closer_name || "");
    }
  };

  // Submit Split Creation / Update
  const handleSaveSplit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) {
      setErrorMessage("Please select a project.");
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);

    startTransition(async () => {
      const res = await createOrUpdateProjectSplit(
        selectedProjectId,
        Number(grossInput) || 0,
        Number(directCostsInput) || 0,
        Number(commissionPctInput) || 0,
        closerNameInput.trim() || null
      );

      if (!res.success) {
        setErrorMessage(res.error || "Failed to save split.");
      } else {
        setSuccessMessage("Project split calculated and updated successfully.");
        setIsSplitModalOpen(false);
        // Refresh local state
        if (res.split) {
          const splitItem = res.split;
          const proj = data.availableProjects.find((p) => p.id === selectedProjectId);
          setData((prev) => {
            const index = prev.splits.findIndex((s) => s.project_id === selectedProjectId);
            const enrichedSplit = {
              ...splitItem,
              project: proj ? { id: proj.id, name: proj.name, slug: proj.slug, contract_value: proj.contract_value } : undefined,
            };
            const updatedSplits = index >= 0
              ? prev.splits.map((s, idx) => (idx === index ? enrichedSplit : s))
              : [enrichedSplit, ...prev.splits];

            const totalGross = updatedSplits.reduce((acc, s) => acc + Number(s.gross_revenue || 0), 0);
            const totalReserves = updatedSplits
              .filter((s) => s.status === "APPROVED")
              .reduce((acc, s) => acc + Number(s.reserve_amount || 0), 0);
            const pendingCount = updatedSplits.filter(
              (s) => s.status === "PENDING_APPROVAL" || (s.status === "DRAFT" && (!s.approved_by_a || !s.approved_by_b))
            ).length;

            return {
              ...prev,
              splits: updatedSplits,
              totalGrossRevenue: totalGross,
              totalReserves,
              pendingApprovalsCount: pendingCount,
            };
          });
        }
      }
    });
  };

  // Handle Dual Founder Approval
  const handleApprove = (splitId: string, founder: "A" | "B") => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setApprovingState((prev) => ({ ...prev, [splitId]: founder }));

    startTransition(async () => {
      const res = await approveSplit(splitId, founder);
      setApprovingState((prev) => ({ ...prev, [splitId]: null }));

      if (!res.success) {
        setErrorMessage(res.error || `Failed to approve for Founder ${founder}.`);
      } else {
        const founderName = founder === "A" ? "Founder A (Ray)" : "Founder B (Partner)";
        setSuccessMessage(`Successfully registered approval from ${founderName}.`);

        // Optimistically update local view
        setData((prev) => {
          const updatedSplits = prev.splits.map((s) => {
            if (s.id !== splitId) return s;
            const approvedA = founder === "A" ? true : s.approved_by_a;
            const approvedB = founder === "B" ? true : s.approved_by_b;
            const isFullyApproved = approvedA && approvedB;
            return {
              ...s,
              approved_by_a: approvedA,
              approved_by_b: approvedB,
              status: isFullyApproved ? ("APPROVED" as const) : ("PENDING_APPROVAL" as const),
            };
          });

          const totalReserves = updatedSplits
            .filter((s) => s.status === "APPROVED")
            .reduce((acc, s) => acc + Number(s.reserve_amount || 0), 0);
          const pendingCount = updatedSplits.filter(
            (s) => s.status === "PENDING_APPROVAL" || (s.status === "DRAFT" && (!s.approved_by_a || !s.approved_by_b))
          ).length;

          // If fully approved, also record ledger entry in local state
          const targetSplit = updatedSplits.find((s) => s.id === splitId);
          let newLedger = prev.ledgerEntries;
          if (targetSplit && targetSplit.status === "APPROVED" && Number(targetSplit.reserve_amount) > 0) {
            newLedger = [
              {
                id: `local-${Date.now()}`,
                project_id: targetSplit.project_id,
                type: "INFLOW",
                category: "RESERVE_INFLOW",
                amount: targetSplit.reserve_amount,
                description: `5% Studio Reserve from ${targetSplit.project?.name || "Project"}`,
                created_at: new Date().toISOString(),
              },
              ...prev.ledgerEntries,
            ];
          }

          return {
            ...prev,
            splits: updatedSplits,
            totalReserves,
            pendingApprovalsCount: pendingCount,
            ledgerEntries: newLedger,
          };
        });
      }
    });
  };

  // Submit Manual Cash Movement
  const handleSaveLedger = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = Number(ledgerAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setErrorMessage("Amount must be greater than zero.");
      return;
    }
    if (!ledgerDescription.trim()) {
      setErrorMessage("Description is required.");
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);

    startTransition(async () => {
      const res = await createLedgerEntry({
        type: ledgerType,
        category: ledgerCategory,
        amount: amountNum,
        description: ledgerDescription.trim(),
      });

      if (!res.success) {
        setErrorMessage(res.error || "Failed to record cash movement.");
      } else {
        setSuccessMessage("Cash ledger entry recorded.");
        setIsLedgerModalOpen(false);
        setLedgerAmount("");
        setLedgerDescription("");
        setData((prev) => ({
          ...prev,
          ledgerEntries: [
            {
              id: `temp-${Date.now()}`,
              project_id: null,
              type: ledgerType,
              category: ledgerCategory,
              amount: amountNum,
              description: ledgerDescription.trim(),
              created_at: new Date().toISOString(),
            },
            ...prev.ledgerEntries,
          ],
        }));
      }
    });
  };

  // Calculate total distributed to founders
  const totalFounderADistributed = useMemo(() => {
    return data.splits
      .filter((s) => s.status === "APPROVED")
      .reduce((sum, s) => sum + Number(s.founder_a_share || 0), 0);
  }, [data.splits]);

  const totalFounderBDistributed = useMemo(() => {
    return data.splits
      .filter((s) => s.status === "APPROVED")
      .reduce((sum, s) => sum + Number(s.founder_b_share || 0), 0);
  }, [data.splits]);

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight text-[#09090b]">
            Finance & Waterfall Engine
          </h1>
          <p className="text-sm text-[#52525b] mt-1">
            5% Studio Reserve, Closer Commissions, and 50:50 Dual-Approval Founder Splits
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsLedgerModalOpen(true)}
            className="flex items-center gap-2 border-[#ececee]"
          >
            <History size={16} /> Record Movement
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setSelectedProjectId(data.availableProjects[0]?.id || "");
              if (data.availableProjects[0]?.contract_value) {
                setGrossInput(String(data.availableProjects[0].contract_value));
              }
              setIsSplitModalOpen(true);
            }}
            className="flex items-center gap-2 bg-[#09090b] hover:bg-[#27272a] text-white"
          >
            <Plus size={16} /> New Project Split
          </Button>
        </div>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="p-4 bg-[#ff5a00]/10 border border-[#ff5a00]/30 text-[#ff5a00] rounded-md flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-[#ff5a00] hover:opacity-70">
            <X size={16} />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-[#09090b] border border-[#09090b] text-white rounded-md flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-white/70 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Metrics Cards */}
      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Gross Revenue */}
        <div className="bg-white p-5 rounded-lg border border-[#ececee] shadow-sm flex items-start gap-4">
          <div className="p-3 bg-[#f4f4f5] text-[#09090b] rounded-lg">
            <TrendingUp size={22} />
          </div>
          <div>
            <p className="text-xs font-medium text-[#52525b] uppercase tracking-wider">
              Total Project Gross
            </p>
            <p className="text-2xl font-bold font-serif text-[#09090b] mt-1">
              {formatIDR(data.totalGrossRevenue)}
            </p>
            <p className="text-xs text-[#71717a] mt-1">Across {data.splits.length} project splits</p>
          </div>
        </div>

        {/* Studio Cash Reserve */}
        <div className="bg-white p-5 rounded-lg border border-[#ececee] shadow-sm flex items-start gap-4">
          <div className="p-3 bg-[#09090b] text-white rounded-lg">
            <ShieldCheck size={22} />
          </div>
          <div>
            <p className="text-xs font-medium text-[#52525b] uppercase tracking-wider">
              Studio Cash Reserve (5%)
            </p>
            <p className="text-2xl font-bold font-serif text-[#09090b] mt-1">
              {formatIDR(data.totalReserves)}
            </p>
            <p className="text-xs text-[#71717a] mt-1">Dedicated equipment & buffer fund</p>
          </div>
        </div>

        {/* Pending Founder Approvals */}
        <div className="bg-white p-5 rounded-lg border border-[#ececee] shadow-sm flex items-start gap-4">
          <div className={`p-3 rounded-lg ${data.pendingApprovalsCount > 0 ? "bg-[#ff5a00]/10 text-[#ff5a00]" : "bg-[#f4f4f5] text-[#52525b]"}`}>
            <Clock size={22} />
          </div>
          <div>
            <p className="text-xs font-medium text-[#52525b] uppercase tracking-wider">
              Pending Approvals
            </p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-2xl font-bold font-serif text-[#09090b]">
                {data.pendingApprovalsCount}
              </p>
              {data.pendingApprovalsCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-semibold bg-[#ff5a00]/10 text-[#ff5a00] rounded-full">
                  Action required
                </span>
              )}
            </div>
            <p className="text-xs text-[#71717a] mt-1">Requires dual founder sign-off</p>
          </div>
        </div>

        {/* 50:50 Founder Net Distribution */}
        <div className="bg-white p-5 rounded-lg border border-[#ececee] shadow-sm flex items-start gap-4">
          <div className="p-3 bg-[#f4f4f5] text-[#3f3f46] rounded-lg">
            <Coins size={22} />
          </div>
          <div>
            <p className="text-xs font-medium text-[#52525b] uppercase tracking-wider">
              Approved Founder Payout
            </p>
            <p className="text-2xl font-bold font-serif text-[#09090b] mt-1">
              {formatIDR(totalFounderADistributed + totalFounderBDistributed)}
            </p>
            <p className="text-xs text-[#52525b] mt-1">
              Ray: {formatIDR(totalFounderADistributed)} • Partner: {formatIDR(totalFounderBDistributed)}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs Control */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("splits")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === "splits"
                ? "bg-[#09090b] text-white"
                : "text-[#3f3f46] hover:text-[#09090b] hover:bg-[#fafafa]"
            }`}
          >
            Project Splits ({data.splits.length})
          </button>
          <button
            onClick={() => setActiveTab("ledger")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === "ledger"
                ? "bg-[#09090b] text-white"
                : "text-[#3f3f46] hover:text-[#09090b] hover:bg-[#fafafa]"
            }`}
          >
            Cash Ledger History ({data.ledgerEntries.length})
          </button>
        </div>
      </div>

      {/* Tab Content: Project Splits */}
      {activeTab === "splits" && (
        <div className="bg-white rounded-lg border border-[#ececee] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-[#ececee] flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[#09090b]">Project Profit Splits</h2>
              <p className="text-xs text-[#52525b] mt-0.5">
                Waterfall calculation breakdown and dual-approval status
              </p>
            </div>
            <span className="text-xs text-[#52525b]">
              Rule: Net Profit = Gross - Direct Costs | 5% Reserve | 50:50 Founder Distribution
            </span>
          </div>

          {data.splits.length === 0 ? (
            <div className="p-12 text-center">
              <FileSpreadsheet className="mx-auto text-[#a1a1aa] mb-3" size={36} />
              <h3 className="text-base font-medium text-[#09090b]">No project splits calculated yet</h3>
              <p className="text-sm text-[#52525b] max-w-sm mx-auto mt-1 mb-6">
                Calculate your first waterfall profit split for any active commercial or wedding project.
              </p>
              <Button
                onClick={() => setIsSplitModalOpen(true)}
                className="bg-[#09090b] text-white hover:bg-[#27272a]"
              >
                <Plus size={16} className="mr-2" /> Calculate New Split
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-[#ececee] bg-[#fafafa] text-xs font-semibold text-[#52525b] uppercase tracking-wider">
                    <th className="py-3.5 px-4">Project</th>
                    <th className="py-3.5 px-3 text-right">Gross Revenue</th>
                    <th className="py-3.5 px-3 text-right">Direct Costs</th>
                    <th className="py-3.5 px-3 text-right">5% Reserve</th>
                    <th className="py-3.5 px-3 text-right">Closer Comm.</th>
                    <th className="py-3.5 px-3 text-right">Founder A (Ray)</th>
                    <th className="py-3.5 px-3 text-right">Founder B</th>
                    <th className="py-3.5 px-4 text-center">Status</th>
                    <th className="py-3.5 px-6 text-center">Dual Founder Approval</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ececee]">
                  {data.splits.map((split) => {
                    const isApprovingThis = approvingState[split.id];

                    return (
                      <tr key={split.id} className="hover:bg-[#fafafa] transition-colors [&>td]:h-11">
                        {/* Project Info */}
                        <td className="py-4 px-4 font-medium">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[#09090b]">
                              {split.project?.name || "Unnamed Project"}
                            </span>
                            {split.project?.id && (
                              <Link
                                href={`/admin/projects/${split.project_id}`}
                                className="text-[#a1a1aa] hover:text-[#09090b]"
                                title="Open project details"
                              >
                                <ExternalLink size={14} />
                              </Link>
                            )}
                          </div>
                          <p className="text-xs text-[#a1a1aa] mt-0.5">
                            Created {new Date(split.created_at).toLocaleDateString()}
                          </p>
                        </td>

                        {/* Gross */}
                        <td className="py-4 px-3 text-right font-medium text-[#09090b]">
                          {formatIDR(split.gross_revenue)}
                        </td>

                        {/* Direct Costs */}
                        <td className="py-4 px-3 text-right text-[#52525b]">
                          {Number(split.direct_costs) > 0 ? (
                            <span className="text-[#ff5a00]">
                              -{formatIDR(split.direct_costs)}
                            </span>
                          ) : (
                            <span className="text-[#a1a1aa]">Rp 0</span>
                          )}
                        </td>

                        {/* 5% Studio Reserve */}
                        <td className="py-4 px-3 text-right font-semibold text-[#09090b]">
                          {formatIDR(split.reserve_amount)}
                        </td>

                        {/* Commission */}
                        <td className="py-4 px-3 text-right text-[#3f3f46]">
                          {Number(split.commission_amount) > 0 ? (
                            <div>
                              <p className="font-medium text-[#09090b]">
                                {formatIDR(split.commission_amount)}
                              </p>
                              {split.closer_name && (
                                <p className="text-[11px] text-[#71717a]">
                                  {split.closer_name} ({split.commission_pct}%)
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-[#a1a1aa]">-</span>
                          )}
                        </td>

                        {/* Founder A Share */}
                        <td className="py-4 px-3 text-right font-semibold text-[#09090b]">
                          {formatIDR(split.founder_a_share)}
                        </td>

                        {/* Founder B Share */}
                        <td className="py-4 px-3 text-right font-semibold text-[#3f3f46]">
                          {formatIDR(split.founder_b_share)}
                        </td>

                        {/* Status Badge */}
                        <td className="py-4 px-4 text-center">
                          {split.status === "APPROVED" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-[#09090b] text-white">
                              <CheckCircle2 size={12} /> Approved
                            </span>
                          )}
                          {split.status === "PENDING_APPROVAL" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-[#ff5a00]/10 text-[#ff5a00]">
                              <Clock size={12} /> Pending (1/2)
                            </span>
                          )}
                          {split.status === "DRAFT" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-[#fafafa] text-[#3f3f46] border border-[#ececee]">
                              Draft (0/2)
                            </span>
                          )}
                          {split.status === "REJECTED" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-[#ff5a00] text-white">
                              Rejected
                            </span>
                          )}
                        </td>

                        {/* Dual-Approval Action Buttons */}
                        <td className="py-4 px-6 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {/* Founder A Button / Badge */}
                            {split.approved_by_a ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-[#09090b] text-white border border-[#09090b]">
                                <CheckCircle2 size={12} /> Ray ✓
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isPending || isApprovingThis === "A"}
                                onClick={() => handleApprove(split.id, "A")}
                                className="h-11 px-3 text-xs border-[#ececee] hover:bg-[#09090b] hover:text-white hover:border-[#09090b] transition-colors"
                              >
                                {isApprovingThis === "A" ? "Saving..." : "Approve Ray"}
                              </Button>
                            )}

                            {/* Founder B Button / Badge */}
                            {split.approved_by_b ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-[#09090b] text-white border border-[#09090b]">
                                <CheckCircle2 size={12} /> Partner ✓
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isPending || isApprovingThis === "B"}
                                onClick={() => handleApprove(split.id, "B")}
                                className="h-11 px-3 text-xs border-[#ececee] hover:bg-[#09090b] hover:text-white hover:border-[#09090b] transition-colors"
                              >
                                {isApprovingThis === "B" ? "Saving..." : "Approve Partner"}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Cash Ledger History */}
      {activeTab === "ledger" && (
        <div className="bg-white rounded-lg border border-[#ececee] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[#09090b]">Cash Ledger History</h2>
              <p className="text-xs text-[#52525b] mt-0.5">
                Audit trail of studio reserve inflows, maintenance, and founder advances
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsLedgerModalOpen(true)}
              className="border-[#ececee] text-xs flex items-center gap-1.5"
            >
              <Plus size={14} /> New Entry
            </Button>
          </div>

          {data.ledgerEntries.length === 0 ? (
            <div className="p-12 text-center">
              <History className="mx-auto text-[#a1a1aa] mb-3" size={36} />
              <h3 className="text-base font-medium text-[#09090b]">No cash ledger entries</h3>
              <p className="text-sm text-[#52525b] max-w-sm mx-auto mt-1 mb-6">
                When a project split receives dual founder approval, the 5% Studio Reserve inflow automatically logs here.
              </p>
              <Button
                onClick={() => setIsLedgerModalOpen(true)}
                className="bg-[#09090b] text-white hover:bg-[#27272a]"
              >
                Record Manual Cash Movement
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-[#ececee] bg-[#fafafa] text-xs font-semibold text-[#52525b] uppercase tracking-wider">
                    <th className="py-3 px-6">Date</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-6">Description</th>
                    <th className="py-3 px-6 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ececee]">
                  {data.ledgerEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-[#fafafa] transition-colors [&>td]:h-11">
                      <td className="py-3.5 px-6 text-xs text-[#52525b] whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleDateString()}{" "}
                        <span className="text-[#a1a1aa]">
                          {new Date(entry.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[#f4f4f5] text-[#3f3f46] border border-[#ececee]">
                          {entry.category.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        {entry.type === "INFLOW" ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#09090b]">
                            <ArrowDownRight size={14} /> Inflow
                          </span>
                        ) : entry.type === "OUTFLOW" ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#ff5a00]">
                            <ArrowUpRight size={14} /> Outflow
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#52525b]">
                            Advance
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-6 text-[#09090b] font-medium">
                        {entry.description}
                      </td>
                      <td className={`py-3.5 px-6 text-right font-semibold ${
                        entry.type === "INFLOW" ? "text-[#09090b]" : "text-[#ff5a00]"
                      }`}>
                        {entry.type === "INFLOW" ? "+" : "-"}
                        {formatIDR(entry.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal: Calculate & Create Project Split */}
      {isSplitModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-xl border border-[#ececee] max-w-2xl w-full p-6 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <Calculator className="text-[#3f3f46]" size={20} />
                <h3 className="text-xl font-serif font-bold text-[#09090b]">
                  Calculate Waterfall Profit Split
                </h3>
              </div>
              <button
                onClick={() => setIsSplitModalOpen(false)}
                className="text-[#a1a1aa] hover:text-[#09090b]"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveSplit} className="space-y-5">
              {/* Project Selection */}
              <div>
                <label className="block text-xs font-semibold text-[#3f3f46] uppercase tracking-wider mb-1.5">
                  Select Project
                </label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => handleSelectProject(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-[#ececee] rounded-md focus:outline-none focus:ring-2 focus:ring-[#09090b] bg-white"
                  required
                >
                  <option value="" disabled>
                    -- Choose an existing project --
                  </option>
                  {data.availableProjects.map((proj) => (
                    <option key={proj.id} value={proj.id}>
                      {proj.name} ({proj.photography_type}) • {formatIDR(proj.contract_value)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Financial Inputs Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#3f3f46] uppercase tracking-wider mb-1.5">
                    Gross Project Revenue (IDR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={grossInput}
                    onChange={(e) => setGrossInput(e.target.value)}
                    placeholder="e.g. 15000000"
                    className="w-full px-3 py-2 text-sm border border-[#ececee] rounded-md focus:outline-none focus:ring-2 focus:ring-[#09090b]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3f3f46] uppercase tracking-wider mb-1.5">
                    Direct Production Costs (IDR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={directCostsInput}
                    onChange={(e) => setDirectCostsInput(e.target.value)}
                    placeholder="e.g. 2500000 (travel, rentals)"
                    className="w-full px-3 py-2 text-sm border border-[#ececee] rounded-md focus:outline-none focus:ring-2 focus:ring-[#09090b]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3f3f46] uppercase tracking-wider mb-1.5">
                    Closer Commission (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={commissionPctInput}
                    onChange={(e) => setCommissionPctInput(e.target.value)}
                    placeholder="e.g. 5"
                    className="w-full px-3 py-2 text-sm border border-[#ececee] rounded-md focus:outline-none focus:ring-2 focus:ring-[#09090b]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3f3f46] uppercase tracking-wider mb-1.5">
                    Closer Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={closerNameInput}
                    onChange={(e) => setCloserNameInput(e.target.value)}
                    placeholder="e.g. Alex (Sales Lead)"
                    className="w-full px-3 py-2 text-sm border border-[#ececee] rounded-md focus:outline-none focus:ring-2 focus:ring-[#09090b]"
                  />
                </div>
              </div>

              {/* Real-time Live Calculation Breakdown */}
              <div className="bg-[#fafafa] border border-[#ececee] rounded-lg p-4 space-y-2.5">
                <p className="text-xs font-bold text-[#3f3f46] uppercase tracking-wider mb-2">
                  Live Waterfall Split Preview
                </p>
                <div className="flex justify-between text-sm">
                  <span className="text-[#52525b]">Gross Revenue:</span>
                  <span className="font-semibold text-[#09090b]">
                    {formatIDR(previewCalculation.grossRevenue)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#52525b]">Direct Production Costs:</span>
                  <span className="text-[#ff5a00] font-medium">
                    -{formatIDR(previewCalculation.directCosts)}
                  </span>
                </div>
                <div className="flex justify-between text-sm border-t border-[#ececee] pt-1.5">
                  <span className="font-medium text-[#3f3f46]">Net Profit to Distribute:</span>
                  <span className="font-bold text-[#09090b]">
                    {formatIDR(previewCalculation.netProfit)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#09090b] font-medium">
                    Studio Cash Reserve (5%):
                  </span>
                  <span className="font-semibold text-[#09090b]">
                    {formatIDR(previewCalculation.reserveAmount)}
                  </span>
                </div>
                {previewCalculation.commissionAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#ff5a00] font-medium">
                      Closer Commission ({previewCalculation.commissionPct}%):
                    </span>
                    <span className="font-semibold text-[#ff5a00]">
                      {formatIDR(previewCalculation.commissionAmount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t border-[#ececee] pt-2 bg-white p-2.5 rounded border border-[#ececee]">
                  <div>
                    <p className="text-xs font-bold text-[#09090b]">Founder A (Ray - 50%)</p>
                    <p className="text-base font-bold text-[#09090b] mt-0.5">
                      {formatIDR(previewCalculation.founderAShare)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-[#09090b]">Founder B (Partner - 50%)</p>
                    <p className="text-base font-bold text-[#3f3f46] mt-0.5">
                      {formatIDR(previewCalculation.founderBShare)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsSplitModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending}
                  className="bg-[#09090b] text-white hover:bg-[#27272a]"
                >
                  {isPending ? "Calculating & Saving..." : "Save & Request Approval"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Record Cash Movement */}
      {isLedgerModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-xl border border-[#ececee] max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-lg font-serif font-bold text-[#09090b]">
                Record Studio Cash Movement
              </h3>
              <button
                onClick={() => setIsLedgerModalOpen(false)}
                className="text-[#a1a1aa] hover:text-[#09090b]"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveLedger} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#3f3f46] uppercase tracking-wider mb-1.5">
                  Transaction Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["INFLOW", "OUTFLOW", "FOUNDER_ADVANCE"] as CashLedgerType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setLedgerType(t)}
                      className={`py-2 text-xs font-semibold rounded-md border text-center transition-colors ${
                        ledgerType === t
                          ? "bg-[#09090b] text-white border-[#09090b]"
                          : "bg-white text-[#3f3f46] border-[#ececee] hover:bg-[#fafafa]"
                      }`}
                    >
                      {t.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3f3f46] uppercase tracking-wider mb-1.5">
                  Category
                </label>
                <select
                  value={ledgerCategory}
                  onChange={(e) => setLedgerCategory(e.target.value as CashLedgerCategory)}
                  className="w-full px-3 py-2 text-sm border border-[#ececee] rounded-md focus:outline-none focus:ring-2 focus:ring-[#09090b] bg-white"
                >
                  <option value="EQUIPMENT_MAINTENANCE">Equipment Maintenance</option>
                  <option value="OPERATIONAL">Operational</option>
                  <option value="DIVIDEND_PAYOUT">Dividend Payout</option>
                  <option value="RESERVE_INFLOW">Reserve Inflow</option>
                  <option value="PROJECT_SPLIT">Project Split</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3f3f46] uppercase tracking-wider mb-1.5">
                  Amount (IDR)
                </label>
                <input
                  type="number"
                  min="1"
                  step="1000"
                  value={ledgerAmount}
                  onChange={(e) => setLedgerAmount(e.target.value)}
                  placeholder="e.g. 500000"
                  className="w-full px-3 py-2 text-sm border border-[#ececee] rounded-md focus:outline-none focus:ring-2 focus:ring-[#09090b]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3f3f46] uppercase tracking-wider mb-1.5">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={ledgerDescription}
                  onChange={(e) => setLedgerDescription(e.target.value)}
                  placeholder="e.g. Lens sensor cleaning and calibration"
                  className="w-full px-3 py-2 text-sm border border-[#ececee] rounded-md focus:outline-none focus:ring-2 focus:ring-[#09090b]"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsLedgerModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending}
                  className="bg-[#09090b] text-white hover:bg-[#27272a]"
                >
                  {isPending ? "Recording..." : "Record Entry"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
