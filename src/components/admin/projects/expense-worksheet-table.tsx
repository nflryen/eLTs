"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Lock,
  Trash2,
  AlertTriangle,
  Receipt,
  FileText,
  Filter,
  CheckCircle2,
  Loader2,
  Info,
  DollarSign,
  Layers,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteProjectExpense } from "@/app/actions/admin-expenses";
import type {
  ExpenseCategory,
  ExpensePaidBy,
  ProjectExpenseRow,
} from "@/types/operations";

interface ExpenseWorksheetTableProps {
  projectId: string;
  initialExpenses: ProjectExpenseRow[];
  contractValue?: number;
  onExpensesChanged?: (expenses: ProjectExpenseRow[]) => void;
}

const CATEGORY_META: Record<
  ExpenseCategory,
  { label: string; badgeClass: string; borderClass: string }
> = {
  CREW_FEE: {
    label: "Honor Kru",
    badgeClass: "bg-[#fafafa] text-[#09090b] ",
    borderClass: "border-[#ececee] ",
  },
  EQUIPMENT_RENTAL: {
    label: "Sewa Alat",
    badgeClass: "bg-[#fafafa] text-[#52525b] ",
    borderClass: "border-[#ececee] ",
  },
  EQUIPMENT_DEPRECIATION: {
    label: "Penyusutan",
    badgeClass: "bg-[#fafafa] text-[#52525b] ",
    borderClass: "border-[#ececee] ",
  },
  TRANSPORT_LOGISTICS: {
    label: "Logistik & Transport",
    badgeClass: "bg-[#fafafa] text-[#52525b] ",
    borderClass: "border-[#ececee] ",
  },
  MEALS_CONSUMPTION: {
    label: "Konsumsi Tim",
    badgeClass: "bg-[#fafafa] text-[#09090b] ",
    borderClass: "border-[#ececee] ",
  },
  BANDWIDTH_SIM: {
    label: "SIM & Kuota",
    badgeClass: "bg-[#fafafa] text-[#52525b] ",
    borderClass: "border-[#ececee] ",
  },
  SUPPLIES_MISC: {
    label: "Supplies & Lakban",
    badgeClass: "bg-[#fafafa] text-[#52525b] ",
    borderClass: "border-[#ececee] ",
  },
  CLIENT_ADDON: {
    label: "Add-on Klien",
    badgeClass: "bg-[#ff5a00]/5 text-[#ff5a00] ",
    borderClass: "border-[#ff5a00]/50 ",
  },
};

const PAID_BY_META: Record<ExpensePaidBy, { label: string; badgeClass: string }> = {
  STUDIO_CASH: {
    label: "Kas Studio",
    badgeClass: "bg-[#fafafa] text-[#09090b] ",
  },
  FOUNDER_A_ADVANCE: {
    label: "Talangan Founder A (Ray)",
    badgeClass: "bg-[#ff5a00]/5 text-[#ff5a00] ",
  },
  FOUNDER_B_ADVANCE: {
    label: "Talangan Founder B (Partner)",
    badgeClass: "bg-[#ff5a00]/5 text-[#ff5a00] ",
  },
  CLIENT_BILLED: {
    label: "Billed to Client",
    badgeClass: "bg-[#fafafa] text-[#52525b] ",
  },
};

function formatIDR(amount: number): string {
 return new Intl.NumberFormat("id-ID", {
 style: "currency",
 currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function ExpenseWorksheetTable({
  projectId,
  initialExpenses,
  contractValue = 0,
  onExpensesChanged,
}: ExpenseWorksheetTableProps) {
  const router = useRouter();
  const [expenses, setExpenses] = useState<ProjectExpenseRow[]>(initialExpenses);
 const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Crew Locked Delete Warning Modal State
  const [crewLockModalExpense, setCrewLockModalExpense] = useState<ProjectExpenseRow | null>(null);

  // Re-sync when the parent supplies a new expense list. Adjusting state during
 // render (rather than in useMemo/useEffect) is React's documented pattern for
  // deriving state from props and avoids an extra render pass.
  const [syncedFrom, setSyncedFrom] = useState(initialExpenses);
  if (initialExpenses !== syncedFrom) {
    setSyncedFrom(initialExpenses);
    setExpenses(initialExpenses);
  }

  // Filtered expenses
  const filteredExpenses = useMemo(() => {
 if (selectedCategory === "ALL") return expenses;
    return expenses.filter((e) => e.category === selectedCategory);
  }, [expenses, selectedCategory]);

  // Computations
  const totalFilteredCost = useMemo(() => {
    return filteredExpenses.reduce((acc, curr) => {
      const cost = Number(curr.total_cost ?? curr.unit_cost * curr.quantity);
      return acc + cost;
    }, 0);
  }, [filteredExpenses]);

  const grandTotalCost = useMemo(() => {
    return expenses.reduce((acc, curr) => {
      const cost = Number(curr.total_cost ?? curr.unit_cost * curr.quantity);
      return acc + cost;
    }, 0);
  }, [expenses]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: expenses.length };
    for (const exp of expenses) {
      counts[exp.category] = (counts[exp.category] || 0) + 1;
    }
    return counts;
  }, [expenses]);

  const handleDeleteItem = async (expense: ProjectExpenseRow, forceDelete: boolean = false) => {
    // If tied to crew assignment and not forcing
    if (expense.crew_assignment_id && !forceDelete) {
      setCrewLockModalExpense(expense);
      return;
    }

    setDeletingId(expense.id);
    setActionError(null);

    startTransition(async () => {
      try {
        const res = await deleteProjectExpense(expense.id, projectId, forceDelete);
        if (res.success) {
          const updated = expenses.filter((e) => e.id !== expense.id);
          setExpenses(updated);
          if (onExpensesChanged) onExpensesChanged(updated);
          setCrewLockModalExpense(null);
          router.refresh();
        } else {
 setActionError(res.error || "Gagal menghapus item.");
        }
      } catch (err: unknown) {
        setActionError(
 err instanceof Error ? err.message : "Terjadi kesalahan saat menghapus item."
        );
      } finally {
        setDeletingId(null);
      }
    });
  };

  return (
 <div className="w-full space-y-4">
      {/* Category Pills Filter Bar */}
 <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
        <button
 type="button"
 onClick={() => setSelectedCategory("ALL")}
          className={`inline-flex min-h-11 items-center px-3.5 rounded-[12px] text-xs font-medium transition whitespace-nowrap cursor-pointer tabular-nums ${
            selectedCategory === "ALL"
              ? "bg-[#09090b] text-white shadow-xs"
              : "bg-white text-[#52525b] hover:bg-[#fafafa] border border-[#ececee] "
          }`}
        >
          Semua Item ({categoryCounts.ALL || 0})
        </button>

        {(Object.keys(CATEGORY_META) as ExpenseCategory[]).map((cat) => {
          const count = categoryCounts[cat] || 0;
          if (count === 0 && selectedCategory !== cat) return null; // hide 0 counts unless active

          const meta = CATEGORY_META[cat];
          const isSelected = selectedCategory === cat;

          return (
            <button
              key={cat}
 type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`inline-flex min-h-11 items-center px-3.5 rounded-[12px] text-xs font-medium transition whitespace-nowrap gap-1.5 cursor-pointer border ${
                isSelected
                  ? "bg-[#09090b] text-white border-[#09090b] shadow-xs"
                  : "bg-white text-[#52525b] border-[#ececee] hover:bg-[#fafafa]"
              }`}
            >
              <span>{meta.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${
                  isSelected
                    ? "bg-[#27272a] text-[#a1a1aa] "
                    : "bg-[#fafafa] text-[#71717a]"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {actionError && (
        <div className="p-3 bg-[#ff5a00]/5 border border-[#ff5a00]/50 rounded-[12px] text-xs text-[#ff5a00] flex items-center justify-between">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="inline-flex min-h-11 items-center text-[#ff5a00] font-semibold ml-2"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Main Worksheet Table */}
      <div className="bg-white rounded-[16px] border border-[#ececee] shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#fafafa] border-b border-[#ececee] text-[#52525b] font-semibold uppercase tracking-wider text-[11px]">
 <th className="py-3 px-4 w-32">Kategori</th>
 <th className="py-3 px-4">Deskripsi / Item Pengeluaran</th>
 <th className="py-3 px-4 text-right w-28">Biaya Satuan</th>
 <th className="py-3 px-4 text-center w-16">Qty</th>
 <th className="py-3 px-4 text-right w-36">Total Biaya</th>
 <th className="py-3 px-4 w-40">Sumber Dana</th>
 <th className="py-3 px-4 text-center w-16">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ececee] ">
              {filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#a1a1aa]">
                    <Receipt className="mx-auto h-8 w-8 mb-2 stroke-1 text-[#a1a1aa] " />
                    <p className="font-medium text-[#52525b] text-sm">
                      Belum ada biaya tercatat
                    </p>
                    <p className="text-xs text-[#a1a1aa] mt-1 max-w-sm mx-auto">
                      Gunakan tombol shortcut hardware di atas atau klik &ldquo;+ Custom Item&rdquo;
                      untuk mencatat pengeluaran proyek.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredExpenses.map((exp) => {
                  const catMeta = CATEGORY_META[exp.category] || {
                    label: exp.category,
                    badgeClass: "bg-[#fafafa] text-[#52525b]",
                    borderClass: "border-[#ececee]",
                  };
                  const paidMeta = PAID_BY_META[exp.paid_by] || {
                    label: exp.paid_by,
                    badgeClass: "bg-[#fafafa] text-[#52525b]",
                  };
                  const isDeleting = deletingId === exp.id;
                  const itemTotal = Number(exp.total_cost ?? exp.unit_cost * exp.quantity);
                  const isCrewSynced = Boolean(exp.crew_assignment_id);

                  return (
                    <tr
                      key={exp.id}
                      className="hover:bg-[#fafafa]/60 transition-colors group"
                    >
                      {/* Category Badge */}
 <td className="py-3.5 px-4 align-top">
                        <span
 className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${catMeta.badgeClass} ${catMeta.borderClass}`}
                        >
                          {catMeta.label}
                        </span>
                      </td>

                      {/* Item Name & Meta */}
 <td className="py-3.5 px-4 align-top">
 <div className="flex flex-col gap-1">
 <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-[#09090b] ">
                              {exp.name}
                            </span>

                            {isCrewSynced && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#fafafa] text-[#52525b] border border-[#ececee] ">
                                <Lock size={10} className="text-[#52525b]" />
                                <span>Disinkronkan dari Penugasan Kru</span>
                              </span>
                            )}
                          </div>

                          {exp.notes && (
                            <p className="text-[11px] text-[#52525b] ">
                              {exp.notes}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Unit Cost */}
                      <td className="py-3.5 px-4 text-right align-top font-mono text-[#52525b] tabular-nums ">
                        {formatIDR(Number(exp.unit_cost))}
                      </td>

                      {/* Quantity */}
                      <td className="py-3.5 px-4 text-center align-top font-mono text-[#09090b] tabular-nums ">
                        {exp.quantity}
                      </td>

                      {/* Total Cost */}
                      <td className="py-3.5 px-4 text-right align-top font-mono font-bold text-[#09090b] tabular-nums ">
                        {formatIDR(itemTotal)}
                      </td>

                      {/* Paid By */}
 <td className="py-3.5 px-4 align-top">
                        <span
 className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${paidMeta.badgeClass}`}
                        >
                          {paidMeta.label}
                        </span>
                      </td>

                      {/* Delete Action */}
 <td className="py-3.5 px-4 text-center align-top">
                        <button
 type="button"
                          disabled={isDeleting || isPending}
                          onClick={() => handleDeleteItem(exp)}
                          title={
                            isCrewSynced
 ? "Item disinkronkan dari Kru (Klik untuk opsi)"
 : "Hapus Pengeluaran"
                          }
                          className="inline-flex min-h-11 min-w-11 items-center justify-center p-1.5 text-[#a1a1aa] hover:text-[#ff5a00] rounded-[10px] hover:bg-[#ff5a00]/5 transition disabled:opacity-40"
                        >
                          {isDeleting ? (
                            <Loader2 size={14} className="animate-spin text-[#ff5a00]" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Table Footer with Subtotals */}
            {filteredExpenses.length > 0 && (
              <tfoot>
                <tr className="bg-[#fafafa] border-t border-[#ececee] font-semibold text-[#09090b] text-xs">
 <td colSpan={2} className="py-3.5 px-4">
                    <span>
 Total {selectedCategory === "ALL" ? "Biaya Langsung" : "Kategori Ini"} (
                      {filteredExpenses.length} item)
                    </span>
                  </td>
                  <td colSpan={2} className="py-3.5 px-4 text-right text-[#52525b] font-normal tabular-nums">
                    {contractValue > 0 && (
 <span className="text-[11px]">
                        {((totalFilteredCost / contractValue) * 100).toFixed(1)}% dari Kontrak
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-bold text-sm text-[#09090b] tabular-nums ">
                    {formatIDR(totalFilteredCost)}
                  </td>
 <td colSpan={2} className="py-3.5 px-4 text-right">
 {selectedCategory !== "ALL" && (
                      <span className="text-[11px] text-[#52525b] tabular-nums">
                        Grand Total: {formatIDR(grandTotalCost)}
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Crew Locked Modal Warning */}
      {crewLockModalExpense && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-[16px] shadow-2xl border border-[#ececee] max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95">
 <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-[#ff5a00]/5 text-[#ff5a00] border border-[#ff5a00]/50 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} />
              </div>
 <div className="space-y-1">
                <h3 className="font-semibold text-base text-[#09090b] ">
                  Item Terhubung dengan Penugasan Kru
                </h3>
                <p className="text-xs text-[#52525b] leading-relaxed">
 Pengeluaran <strong>&ldquo;{crewLockModalExpense.name}&rdquo;</strong>{" "}
                  disinkronkan otomatis dari modul Penugasan Tim Kru.
                </p>
              </div>
            </div>

            <div className="p-3 bg-[#fafafa] rounded-[12px] border border-[#ececee] text-xs text-[#52525b] space-y-1">
 <div className="flex justify-between">
                <span>Nilai Honor:</span>
                  <span className="font-mono font-semibold text-[#09090b] tabular-nums ">
                  {formatIDR(Number(crewLockModalExpense.total_cost))}
                </span>
              </div>
              <p className="text-[11px] text-[#ff5a00] mt-2">
                Disarankan: Batalkan atau edit penugasan di tab Kru agar data status penugasan tetap
                sinkron.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#ececee] ">
              <Button
 type="button"
 variant="outline"
 size="sm"
                onClick={() => setCrewLockModalExpense(null)}
              >
                Batal
              </Button>
              <Button
 type="button"
 size="sm"
 variant="default"
                disabled={isPending}
                onClick={() => handleDeleteItem(crewLockModalExpense, true)}
                className="inline-flex min-h-11 items-center bg-[#ff5a00] hover:bg-[#e65100] text-white"
              >
                {isPending && <Loader2 size={13} className="animate-spin mr-1" />}
                Hapus Paksa Item
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
