"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Package,
  Warehouse,
  Handshake,
  Store,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
  RotateCcw,
  ClipboardCheck,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateProjectExpenseAction } from "@/app/actions/admin-expenses";
import type { InventoryAssetRow, AssetSourceType } from "@/types/inventory";
import type { ProjectExpenseRow } from "@/types/operations";

interface GearLogisticsBoardProps {
  projectId: string;
  inventoryAssets: InventoryAssetRow[];
  expenses: ProjectExpenseRow[];
  onExpenseChanged?: (expense: ProjectExpenseRow) => void;
}

/** The three sourcing tiers defined by public.inventory_assets.source_type. */
const TIERS: {
  id: AssetSourceType;
  label: string;
  subtitle: string;
  icon: typeof Warehouse;
  accent: string;
  ring: string;
}[] = [
  {
 id: "IN_HOUSE",
 label: "Studio In-House Kit",
 subtitle: "Milik Studio Kineva / ELTS",
    icon: Warehouse,
    accent: "text-[#3f3f46]",
    ring: "bg-[#fafafa] border-[#ececee]",
  },
  {
 id: "PARTNER_OWNED",
 label: "Partner Personal Gear",
 subtitle: "Milik Co-Founder (El / Cahyo)",
    icon: Handshake,
    accent: "text-[#3f3f46]",
    ring: "bg-[#fafafa] border-[#ececee]",
  },
  {
 id: "VENDOR_RENTAL",
 label: "Vendor Rentals",
 subtitle: "Sewa eksternal (Koi Rental)",
    icon: Store,
    accent: "text-[#3f3f46]",
    ring: "bg-[#fafafa] border-[#ececee]",
  },
];

function formatIDR(amount: number): string {
 return new Intl.NumberFormat("id-ID", {
 style: "currency",
 currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

type ReturnStatus = "PENDING" | "RETURNED" | "OVERDUE";

const RETURN_META: Record<
  ReturnStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  RETURNED: {
 label: "Check-In Selesai",
    className: "bg-[#fafafa] text-[#3f3f46] border-[#ececee]",
    icon: CheckCircle2,
  },
  PENDING: {
 label: "Check-Out Aktif",
    className: "bg-[#ff5a00]/10 text-[#c2410c] border-[#ff5a00]/20",
    icon: Clock,
  },
  OVERDUE: {
 label: "Terlambat Kembali",
    className: "bg-[#ff5a00]/10 text-[#c2410c] border-[#ff5a00]/20",
    icon: AlertTriangle,
  },
};

/**
 * Tab 4 — Alat & Logistik.
 *
 * Three-tier hardware directory (in-house / partner / vendor) plus a
 * check-in & check-out staging checklist backed by `project_expenses.return_status`.
 */
export function GearLogisticsBoard({
  projectId,
  inventoryAssets,
  expenses,
  onExpenseChanged,
}: GearLogisticsBoardProps) {
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
 const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const assetsByTier = useMemo(() => {
    const map: Record<AssetSourceType, InventoryAssetRow[]> = {
      IN_HOUSE: [],
      PARTNER_OWNED: [],
      VENDOR_RENTAL: [],
    };
    for (const asset of inventoryAssets) {
      (map[asset.source_type] ??= []).push(asset);
    }
    return map;
  }, [inventoryAssets]);

  /** Expenses representing physical gear movement (rentals & borrowed kit). */
  const stagingItems = useMemo(
    () =>
      expenses.filter(
        (e) =>
 e.category === "EQUIPMENT_RENTAL" ||
 e.source_type === "VENDOR_RENTAL" ||
 e.source_type === "PARTNER_OWNED"
      ),
    [expenses]
  );

  const stagingSummary = useMemo(() => {
    let out = 0;
    let back = 0;
    for (const item of stagingItems) {
 if (item.return_status === "RETURNED") back += 1;
      else out += 1;
    }
    return { out, back, total: stagingItems.length };
  }, [stagingItems]);

  const handleToggleReturn = (expense: ProjectExpenseRow) => {
    const nextStatus: ReturnStatus =
 expense.return_status === "RETURNED" ? "PENDING" : "RETURNED";

    setPendingId(expense.id);
    setNotice(null);

    startTransition(async () => {
      const res = await updateProjectExpenseAction(expense.id, projectId, {
        returnStatus: nextStatus,
      });

      if (res.success && res.expense) {
        onExpenseChanged?.(res.expense);
        setNotice({
 type: "success",
          message:
 nextStatus === "RETURNED"
 ? `Check-in dicatat untuk ${expense.name}.`
 : `Check-out dibuka kembali untuk ${expense.name}.`,
        });
      } else {
        setNotice({
 type: "error",
 message: res.error || "Gagal memperbarui status logistik.",
        });
      }
      setPendingId(null);
    });
  };

  return (
 <div className="space-y-6">
      {/* ── Three-Tier Hardware Directory ────────────────────────────────── */}
 <section className="space-y-4">
 <header className="flex items-center gap-2.5">
 <Package size={18} className="text-[#71717a] " />
          <div>
 <h4 className="font-bold text-base tracking-tight text-[#09090b] ">
              Direktori Perangkat 3-Tier
            </h4>
 <p className="text-xs font-medium text-[#71717a] ">
              Sumber alokasi: inventaris studio, gear pribadi partner, dan sewa vendor
            </p>
          </div>
        </header>

 <div className="grid gap-4 md:grid-cols-3">
          {TIERS.map((tier) => {
            const rows = assetsByTier[tier.id] ?? [];
            const TierIcon = tier.icon;
            const tierValue = rows.reduce(
              (sum, a) => sum + (Number(a.daily_rental_rate) || 0),
              0
            );

            return (
            <div key={tier.id} className="rounded-[36px] border border-[#ececee] bg-white p-5 space-y-4">
 <div className="flex items-start justify-between gap-3">
 <div className="flex items-center gap-2.5">
                    <span
 className={`h-9 w-9 rounded-xl border flex items-center justify-center ${tier.ring} ${tier.accent}`}
                    >
                      <TierIcon size={16} />
                    </span>
                    <div>
 <h5 className="font-bold text-sm text-[#09090b] ">
                        {tier.label}
                      </h5>
 <p className="text-[11px] font-medium text-[#71717a] ">
                        {tier.subtitle}
                      </p>
                    </div>
                  </div>
 <span className="shrink-0 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#fafafa] text-[#52525b] border border-[#ececee]/60 ">
                    {rows.length}
                  </span>
                </div>

 <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {rows.length > 0 ? (
                    rows.map((asset) => (
                      <div
                        key={asset.id}
                        className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-3 flex items-center justify-between gap-3"
                      >
 <div className="min-w-0">
 <p className="text-xs font-semibold text-[#09090b] truncate">
                            {asset.name}
                          </p>
 <p className="text-[10px] font-mono text-[#71717a] ">
 {asset.asset_code} ·{" "}
 {asset.source_type === "VENDOR_RENTAL"
 ? asset.vendor_name || "Vendor"
                              : asset.owner_name}
                          </p>
                        </div>
 <span className="shrink-0 text-[10px] font-mono font-semibold text-[#3f3f46] ">
                          {formatIDR(asset.daily_rental_rate)}
                        </span>
                      </div>
                    ))
                  ) : (
 <p className="text-[11px] text-[#71717a] bg-[#fafafa]/70 rounded-xl border border-dashed border-[#ececee] px-3 py-4 text-center">
                      Belum ada aset terdaftar pada tier ini.
                    </p>
                  )}
                </div>

                {tierValue > 0 && (
 <p className="text-[10px] font-mono uppercase text-[#a1a1aa] border-t border-[#ececee]/60 pt-3">
                    Nilai sewa harian · {formatIDR(tierValue)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Check-In / Check-Out Staging Checklist ───────────────────────── */}
    <section className="rounded-[36px] border border-[#ececee] bg-white p-5 space-y-4">
 <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
 <div className="flex items-center gap-2.5">
          <ClipboardCheck size={18} className="text-[#3f3f46]" />
            <div>
 <h4 className="font-bold text-base tracking-tight text-[#09090b] ">
                Checklist Staging Check-In / Check-Out
              </h4>
 <p className="text-xs font-medium text-[#71717a] ">
                Verifikasi perangkat keluar-masuk sebelum dan sesudah produksi
              </p>
            </div>
          </div>

 <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-[#fafafa] text-[#3f3f46] border border-[#ececee]">
              <Truck size={12} /> {stagingSummary.out} Keluar
            </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-[#fafafa] text-[#3f3f46] border border-[#ececee]">
              <CheckCircle2 size={12} /> {stagingSummary.back} Kembali
            </span>
          </div>
        </header>

        {notice && (
          <div
 role="status"
 className={`px-4 py-2.5 rounded-xl border text-xs font-medium ${
 notice.type === "success"
                ? "bg-[#fafafa] text-[#3f3f46] border-[#ececee]"
                : "bg-[#ff5a00]/10 text-[#c2410c] border-[#ff5a00]/20"
 }`}
          >
            {notice.message}
          </div>
        )}

 <div className="space-y-2.5">
          {stagingItems.length > 0 ? (
            stagingItems.map((item) => {
 const status: ReturnStatus = item.return_status ?? "PENDING";
              const meta = RETURN_META[status];
              const StatusIcon = meta.icon;
 const isReturned = status === "RETURNED";
              const busy = isPending && pendingId === item.id;

              return (
                <div
                  key={item.id}
                  className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
 <div className="min-w-0 space-y-1">
 <div className="flex items-center gap-2 flex-wrap">
 <p className="text-sm font-semibold text-[#09090b] truncate">
                        {item.name}
                      </p>
                      <span
 className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.className}`}
                      >
                        <StatusIcon size={11} /> {meta.label}
                      </span>
                    </div>
 <p className="text-[11px] font-mono text-[#71717a] ">
 {item.source_type === "VENDOR_RENTAL"
 ? item.vendor_name || "Vendor Rental"
 : item.owner_name || "Partner Gear"}{" "}
                      · {formatIDR(item.total_cost)}
 {item.return_date ? ` · Tempo ${item.return_date}` : ""}
                    </p>
                  </div>

                  <Button
 type="button"
 size="sm"
 variant={isReturned ? "outline" : "default"}
                    disabled={busy}
                    onClick={() => handleToggleReturn(item)}
                    className={
                      isReturned
                        ? "min-h-11 shrink-0 text-xs font-semibold cursor-pointer"
                        : "min-h-11 shrink-0 text-xs font-semibold bg-[#09090b] hover:bg-[#27272a] text-white cursor-pointer"
                    }
                  >
                    {busy ? (
 <Loader2 size={13} className="mr-1.5 animate-spin" />
                    ) : isReturned ? (
 <RotateCcw size={13} className="mr-1.5" />
                    ) : (
 <CheckCircle2 size={13} className="mr-1.5" />
                    )}
 {isReturned ? "Buka Kembali" : "Tandai Check-In"}
                  </Button>
                </div>
              );
            })
          ) : (
 <p className="text-xs text-[#71717a] bg-[#fafafa]/70 rounded-xl border border-dashed border-[#ececee] px-4 py-6 text-center">
              Belum ada perangkat sewa atau pinjaman partner yang tercatat untuk proyek ini.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
