"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Package,
  Layers,
  Building,
  Users,
  Store,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  Camera,
  Radio,
  Tv,
  Mic2,
  Headphones,
  Sun,
  Cable,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssetUtilizationDrawer } from "@/components/admin/inventory/asset-utilization-drawer";
import {
  createInventoryAsset,
  toggleOutgoingRental,
} from "@/app/actions/admin-inventory";
import type { CreateInventoryAssetInput } from "@/types/inventory";
import type {
  AssetCategory,
  AssetSourceType,
  ConditionStatus,
  InventoryAssetRow,
} from "@/types/inventory";

interface InventoryDirectoryClientProps {
  initialAssets: InventoryAssetRow[];
}

type FilterSource = "ALL" | "IN_HOUSE" | "PARTNER_OWNED" | "VENDOR_RENTAL";

const CATEGORY_CONFIG: Record<
  AssetCategory,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; badgeClass: string }
> = {
  CAMERA: {
    label: "Kamera",
    icon: Camera,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  LENS: {
    label: "Lensa",
    icon: Layers,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  WIRELESS_VIDEO: {
    label: "Wireless Video",
    icon: Radio,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  BROADCAST_SWITCHER: {
    label: "Switcher / vMix",
    icon: Tv,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  AUDIO: {
    label: "Audio & Mixer",
    icon: Mic2,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  INTERCOM: {
    label: "Intercom Headset",
    icon: Headphones,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  LIGHTING: {
    label: "Lighting",
    icon: Sun,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  SUPPORT_RIG: {
    label: "Tripod & Rig",
    icon: Wrench,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  CABLE_ACCESSORY: {
    label: "Kabel & Aksesori",
    icon: Cable,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
};

const CONDITION_CONFIG: Record<
  ConditionStatus,
  { label: string; badgeClass: string }
> = {
  EXCELLENT: {
    label: "Prima (Like New)",
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#09090b]",
  },
  GOOD: {
    label: "Baik (Siap Pakai)",
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#09090b]",
  },
  FAIR: {
    label: "Cukup (Ada Bekas Pakai)",
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  MAINTENANCE: {
    label: "Servis / Perbaikan",
    badgeClass: "border-[#ff5a00]/30 bg-[#ff5a00]/10 text-[#c2410c]",
  },
  RETIRED: {
    label: "Tidak Aktif",
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#a1a1aa]",
  },
};

function formatIDR(amount: number): string {
 return new Intl.NumberFormat("id-ID", {
 style: "currency",
 currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function InventoryDirectoryClient({ initialAssets }: InventoryDirectoryClientProps) {
  const router = useRouter();
  const [assets, setAssets] = useState<InventoryAssetRow[]>(initialAssets);
 const [sourceFilter, setSourceFilter] = useState<FilterSource>("ALL");
 const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
 const [searchQuery, setSearchQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  // Feedback Notifications
  const [feedback, setFeedback] = useState<{
 type: "success" | "error";
    message: string;
  } | null>(null);

  // Toggling state per asset
  const [togglingId, setTogglingId] = useState<string | null>(null);


  // Asset Utilization & Calendar Drawer
  const [selectedAssetForDrawer, setSelectedAssetForDrawer] = useState<InventoryAssetRow | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // Add Asset Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<CreateInventoryAssetInput>({
 asset_code: "",
 name: "",
 category: "CAMERA",
 source_type: "IN_HOUSE",
 owner_name: "Studio",
 vendor_name: "",
 vendor_phone: "",
    daily_rental_rate: 0,
    replacement_value: 0,
 serial_number: "",
 condition_status: "GOOD",
    is_available_for_outgoing_rental: true,
 notes: "",
  });

  // Calculate Metrics
  const metrics = useMemo(() => {
    const totalAssets = assets.length;
 const inHouse = assets.filter((a) => a.source_type === "IN_HOUSE");
    const inHouseCount = inHouse.length;
    const inHouseOutgoing = inHouse.filter((a) => a.is_available_for_outgoing_rental).length;

 const partner = assets.filter((a) => a.source_type === "PARTNER_OWNED");
    const partnerCount = partner.length;
 const partnerOwners = Array.from(new Set(partner.map((a) => a.owner_name))).join(", ");

 const vendor = assets.filter((a) => a.source_type === "VENDOR_RENTAL");
    const vendorCount = vendor.length;
    const vendorNames = Array.from(
      new Set(vendor.map((a) => a.vendor_name || a.owner_name))
 ).join(", ");

    const totalValuation = assets.reduce((sum, a) => sum + (Number(a.replacement_value) || 0), 0);

    return {
      totalAssets,
      totalValuation,
      inHouseCount,
      inHouseOutgoing,
      partnerCount,
 partnerOwners: partnerOwners || "El, Cahyo",
      vendorCount,
 vendorNames: vendorNames || "Koi Rental Purwokerto",
    };
  }, [assets]);

  // Filtered Assets
  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      // Source type tab filter
 if (sourceFilter !== "ALL" && asset.source_type !== sourceFilter) {
        return false;
      }
      // Category filter
 if (categoryFilter !== "ALL" && asset.category !== categoryFilter) {
        return false;
      }
      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const codeMatch = asset.asset_code.toLowerCase().includes(q);
        const nameMatch = asset.name.toLowerCase().includes(q);
        const ownerMatch = asset.owner_name?.toLowerCase().includes(q);
        const vendorMatch = asset.vendor_name?.toLowerCase().includes(q);
        const snMatch = asset.serial_number?.toLowerCase().includes(q);
        if (!codeMatch && !nameMatch && !ownerMatch && !vendorMatch && !snMatch) {
          return false;
        }
      }
      return true;
    });
  }, [assets, sourceFilter, categoryFilter, searchQuery]);

  // Handle Outgoing Rental Switch Toggle
  const handleToggleOutgoingRental = async (asset: InventoryAssetRow) => {
    const nextState = !asset.is_available_for_outgoing_rental;
    setTogglingId(asset.id);

    // Optimistic UI update
    setAssets((prev) =>
      prev.map((a) =>
        a.id === asset.id ? { ...a, is_available_for_outgoing_rental: nextState } : a
      )
    );

    startTransition(async () => {
      try {
        const result = await toggleOutgoingRental(asset.id, nextState);
        if (result.success) {
          setFeedback({
 type: "success",
 message: `Aset ${asset.name} sekarang ${nextState ? "BISA" : "TIDAK BISA"} disewakan ke pihak luar.`,
          });
          setTimeout(() => setFeedback(null), 3000);
        } else {
          // Revert optimistic update
          setAssets((prev) =>
            prev.map((a) =>
              a.id === asset.id ? { ...a, is_available_for_outgoing_rental: !nextState } : a
            )
          );
          setFeedback({
 type: "error",
 message: result.error || "Gagal mengubah ketersediaan sewa luar.",
          });
        }
      } catch (err: unknown) {
        setAssets((prev) =>
          prev.map((a) =>
            a.id === asset.id ? { ...a, is_available_for_outgoing_rental: !nextState } : a
          )
        );
        setFeedback({
 type: "error",
 message: err instanceof Error ? err.message : "Terjadi kesalahan sistem.",
        });
      } finally {
        setTogglingId(null);
      }
    });
  };

  // Handle Create Asset Form Submit
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
 setFeedback({ type: "error", message: "Nama item wajib diisi." });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createInventoryAsset({
        ...formData,
        daily_rental_rate: Number(formData.daily_rental_rate || 0),
        replacement_value: Number(formData.replacement_value || 0),
      });

      if (result.success && result.asset) {
        setAssets((prev) => [result.asset!, ...prev]);
        setFeedback({
 type: "success",
 message: `Aset ${result.asset.name} (${result.asset.asset_code}) berhasil didaftarkan!`,
        });
        setTimeout(() => setFeedback(null), 3500);
        setIsAddModalOpen(false);

        // Reset form
        setFormData({
 asset_code: "",
 name: "",
 category: "CAMERA",
 source_type: "IN_HOUSE",
 owner_name: "Studio",
 vendor_name: "",
 vendor_phone: "",
          daily_rental_rate: 0,
          replacement_value: 0,
 serial_number: "",
 condition_status: "GOOD",
          is_available_for_outgoing_rental: true,
 notes: "",
        });
        router.refresh();
      } else {
        setFeedback({
 type: "error",
 message: result.error || "Gagal mendaftarkan aset.",
        });
      }
    } catch (err: unknown) {
      setFeedback({
 type: "error",
 message: err instanceof Error ? err.message : "Terjadi kesalahan saat menyimpan aset.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
 <div className="space-y-6 pb-16">
      {/* Top Header */}
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#ececee] pb-5">
        <div>
 <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-[#ff5a00] animate-pulse" />
        <h1 className="text-2xl font-bold tracking-tight text-[#09090b] font-serif">
          Master Inventory &amp; Equipment Hub
        </h1>
          </div>
 <p className="text-xs text-[#71717a] mt-1">
            Katalog perlengkapan broadcast, kamera, audio, dan manajemen kepemilikan alat (Studio, Partner El/Cahyo, & Vendor Rental Purwokerto).
          </p>
        </div>

 <div className="flex items-center gap-2.5">
          <Button
 type="button"
            onClick={() => setIsAddModalOpen(true)}
 className="bg-[#09090b] hover:bg-[#27272a] text-white text-xs h-9 px-3.5 flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus size={15} />
            <span>Tambah Aset Hardware</span>
          </Button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
 className={`p-3.5 rounded-xl border flex items-center justify-between text-xs animate-in fade-in ${
          feedback.type === "success"
            ? "border-[#ececee] bg-[#fafafa] text-[#09090b]"
            : "border-[#ff5a00]/30 bg-[#ff5a00]/10 text-[#c2410c]"
        }`}
      >
        <div className="flex items-center gap-2">
          {feedback.type === "success" ? (
            <CheckCircle2 size={16} className="shrink-0 text-[#09090b]" />
          ) : (
            <AlertCircle size={16} className="shrink-0 text-[#ff5a00]" />
          )}
          <button
            onClick={() => setFeedback(null)}
            className="ml-3 p-2 text-[#a1a1aa] hover:text-[#3f3f46]"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      )}

      {/* 4 Metric Cards */}
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Total Assets */}
 <div className="p-4 rounded-xl bg-white border border-[#ececee] shadow-xs flex flex-col justify-between">
 <div className="flex items-center justify-between">
 <span className="text-xs font-semibold text-[#71717a] uppercase tracking-wider">
              Total Hardware Assets
            </span>
 <div className="h-8 w-8 rounded-lg bg-[#fafafa] text-[#3f3f46] flex items-center justify-center">
              <Package size={16} />
            </div>
          </div>
 <div className="mt-3">
 <p className="text-2xl font-bold font-serif text-[#09090b] ">
 {metrics.totalAssets} <span className="text-sm font-normal text-[#71717a]">Unit</span>
            </p>
 <p className="text-[11px] text-[#71717a] mt-1">
              Valuasi Pergantian: {formatIDR(metrics.totalValuation)}
            </p>
          </div>
        </div>

        {/* Metric 2: In-House Kits */}
 <div className="p-4 rounded-xl bg-white border border-[#ececee] shadow-xs flex flex-col justify-between">
 <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#3f3f46]">
            In-House Kits (Studio)
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fafafa] text-[#3f3f46]">
            <Building size={16} />
          </div>
        </div>
        <div className="mt-3">
          <p className="text-2xl font-bold font-serif text-[#09090b]">
            {metrics.inHouseCount}{" "}
            <span className="text-sm font-normal text-[#71717a]">Unit</span>
          </p>
 <p className="text-[11px] text-[#71717a] mt-1">
              {metrics.inHouseOutgoing} unit aktif siap sewa luar
            </p>
          </div>
        </div>

        {/* Metric 3: Partner-Owned */}
 <div className="p-4 rounded-xl bg-white border border-[#ececee] shadow-xs flex flex-col justify-between">
 <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#3f3f46]">
            Milik Partner (El/Cahyo)
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fafafa] text-[#3f3f46]">
            <Users size={16} />
          </div>
        </div>
        <div className="mt-3">
          <p className="text-2xl font-bold font-serif text-[#09090b]">
            {metrics.partnerCount}{" "}
            <span className="text-sm font-normal text-[#71717a]">Unit</span>
          </p>
 <p className="text-[11px] text-[#71717a] mt-1 truncate" title={metrics.partnerOwners}>
              Pemilik: {metrics.partnerOwners}
            </p>
          </div>
        </div>

        {/* Metric 4: External Rental Vendors */}
 <div className="p-4 rounded-xl bg-white border border-[#ececee] shadow-xs flex flex-col justify-between">
 <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#09090b]">
            Vendor Sewa Luar
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ff5a00]/10 text-[#c2410c]">
            <Store size={16} />
          </div>
        </div>
        <div className="mt-3">
          <p className="text-2xl font-bold font-serif text-[#ff5a00]">
            {metrics.vendorCount}{" "}
            <span className="text-sm font-normal text-[#71717a]">Katalog</span>
          </p>
 <p className="text-[11px] text-[#71717a] mt-1 truncate" title={metrics.vendorNames}>
              Vendor: {metrics.vendorNames}
            </p>
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-[#ececee] bg-white p-3 md:flex-row md:items-center">
        {/* Source Filter Tabs */}
        <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          <button
            type="button"
            onClick={() => setSourceFilter("ALL")}
            className={`inline-flex min-h-11 cursor-pointer items-center whitespace-nowrap rounded-[12px] px-3.5 text-xs font-medium transition ${
              sourceFilter === "ALL"
                ? "bg-[#09090b] text-white"
                : "text-[#3f3f46] hover:bg-[#fafafa] hover:text-[#09090b]"
            }`}
          >
            Semua Aset ({assets.length})
          </button>

          <button
            type="button"
            onClick={() => setSourceFilter("IN_HOUSE")}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[12px] px-3.5 text-xs font-medium transition ${
              sourceFilter === "IN_HOUSE"
                ? "bg-[#09090b] text-white"
                : "text-[#3f3f46] hover:bg-[#fafafa] hover:text-[#09090b]"
            }`}
          >
            <Building size={13} />
            <span>Katalog Studio ({metrics.inHouseCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setSourceFilter("PARTNER_OWNED")}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[12px] px-3.5 text-xs font-medium transition ${
              sourceFilter === "PARTNER_OWNED"
                ? "bg-[#09090b] text-white"
                : "text-[#3f3f46] hover:bg-[#fafafa] hover:text-[#09090b]"
            }`}
          >
            <Users size={13} />
            <span>Milik Partner (El/Cahyo) ({metrics.partnerCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setSourceFilter("VENDOR_RENTAL")}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[12px] px-3.5 text-xs font-medium transition ${
              sourceFilter === "VENDOR_RENTAL"
                ? "bg-[#ff5a00] text-white"
                : "text-[#3f3f46] hover:bg-[#fafafa] hover:text-[#09090b]"
            }`}
          >
            <Store size={13} />
            <span>Vendor Rental Eksternal ({metrics.vendorCount})</span>
          </button>
        </div>

        {/* Right Controls: Category Dropdown & Search Input */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="min-h-11 cursor-pointer rounded-[12px] border border-[#ececee] bg-[#fafafa] px-3 text-xs text-[#18181b] focus:outline-none focus:ring-1 focus:ring-[#18181b]"
            >
              <option value="ALL">Semua Kategori</option>
              {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>
                  {cfg.label}
                </option>
              ))}
            </select>
          </div>

          <div className="relative w-full sm:w-56">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#a1a1aa]"
            />
            <input
              type="text"
              placeholder="Cari kode / nama / vendor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="min-h-11 w-full rounded-[12px] border border-[#ececee] bg-[#fafafa] pl-8 pr-3 text-xs text-[#09090b] placeholder:text-[#a1a1aa] focus:outline-none focus:ring-1 focus:ring-[#18181b]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-[#a1a1aa] hover:text-[#3f3f46]"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Asset Table */}
 <div className="bg-white rounded-xl border border-[#ececee] overflow-hidden shadow-xs">
 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs">
 <thead className="bg-[#fafafa] border-b border-[#ececee] text-[11px] font-semibold uppercase text-[#71717a] tracking-wider">
              <tr>
 <th className="py-3 px-4">Kode Aset</th>
 <th className="py-3 px-4">Nama Hardware & Spesifikasi</th>
 <th className="py-3 px-4">Kategori</th>
 <th className="py-3 px-4">Kepemilikan / Vendor</th>
 <th className="py-3 px-4 text-right">Tarif Sewa / Hari</th>
 <th className="py-3 px-4 text-center">Kondisi</th>
 <th className="py-3 px-4 text-center">Sewa Keluar</th>
              </tr>
            </thead>
 <tbody className="divide-y divide-[#fafafa] ">
              {filteredAssets.length === 0 ? (
                <tr>
 <td colSpan={7} className="py-12 text-center text-[#a1a1aa]">
 <Package size={28} className="mx-auto mb-2 opacity-40" />
 <p className="text-sm font-medium">Tidak ada aset ditemukan</p>
 <p className="text-xs text-[#71717a] mt-0.5">
                      Coba sesuaikan filter sumber kepemilikan atau kata kunci pencarian.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredAssets.map((asset) => {
                  const catCfg = CATEGORY_CONFIG[asset.category] || {
                    label: asset.category,
                    icon: Package,
                    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
                  };
                  const CatIcon = catCfg.icon;
                  const condCfg = CONDITION_CONFIG[asset.condition_status] || {
                    label: asset.condition_status,
                    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
                  };

                  const isToggling = isPending && togglingId === asset.id;

                  return (
                    <tr
                      key={asset.id}
                      onClick={() => {
                        setSelectedAssetForDrawer(asset);
                        setIsDrawerOpen(true);
                      }}
 className="hover:bg-[#fafafa]/70 transition group cursor-pointer"
                    >
                      {/* Asset Code */}
 <td className="py-3.5 px-4 font-mono font-medium text-[#09090b] whitespace-nowrap">
 <span className="px-2 py-0.5 rounded bg-[#fafafa] border border-[#ececee] text-[11px]">
                          {asset.asset_code}
                        </span>
                      </td>

                      {/* Name & Details */}
 <td className="py-3.5 px-4">
 <div className="flex flex-col">
 <span className="font-semibold text-[#09090b] ">
                            {asset.name}
                          </span>
 <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[#71717a] flex-wrap">
                            {asset.serial_number && (
 <span className="font-mono">SN: {asset.serial_number}</span>
                            )}
                            {asset.notes && (
 <span className="italic line-clamp-1">{asset.notes}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Category Badge */}
 <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
 className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium ${catCfg.badgeClass}`}
                        >
                          <CatIcon size={12} />
                          <span>{catCfg.label}</span>
                        </span>
                      </td>

                      {/* Owner / Vendor */}
 <td className="py-3.5 px-4 whitespace-nowrap">
 {asset.source_type === "IN_HOUSE" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[#ececee] bg-[#fafafa] px-2 py-0.5 text-[11px] font-medium text-[#3f3f46]">
                            <Building size={11} />
                            <span>Milik Studio</span>
                          </span>
                        )}

 {asset.source_type === "PARTNER_OWNED" && (
 <div className="flex flex-col">
                            <span className="inline-flex items-start gap-1 rounded-full border border-[#ececee] bg-[#fafafa] px-2 py-0.5 text-[11px] font-medium text-[#3f3f46] self-start">
                              <Users size={11} />
                              <span>Partner: {asset.owner_name}</span>
                            </span>
                          </div>
                        )}

 {asset.source_type === "VENDOR_RENTAL" && (
 <div className="flex flex-col">
                            <span className="inline-flex items-start gap-1 rounded-full border border-[#ff5a00]/30 bg-[#ff5a00]/10 px-2 py-0.5 text-[11px] font-medium text-[#c2410c] self-start">
                              <Store size={11} />
                              <span>{asset.vendor_name || asset.owner_name}</span>
                            </span>
                            {asset.vendor_phone && (
 <span className="text-[10px] text-[#71717a] font-mono mt-0.5">
                                {asset.vendor_phone}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Daily Rate */}
 <td className="py-3.5 px-4 text-right font-mono font-medium text-[#09090b] whitespace-nowrap">
                        {Number(asset.daily_rental_rate) > 0 ? (
                          formatIDR(Number(asset.daily_rental_rate))
                        ) : (
 <span className="text-[#a1a1aa] font-normal">Internal only</span>
                        )}
                      </td>

                      {/* Condition */}
 <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <span
 className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${condCfg.badgeClass}`}
                        >
                          {condCfg.label}
                        </span>
                      </td>

                      {/* Outgoing Rental Switch */}
 <td className="py-3.5 px-4 text-center whitespace-nowrap">
 <div className="inline-flex items-center gap-2">
                          <button
 type="button"
                            disabled={isToggling}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleOutgoingRental(asset);
                            }}
                          className={`relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[12px] border border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[#18181b] focus-visible:ring-offset-2 disabled:opacity-50 ${
                            asset.is_available_for_outgoing_rental
                              ? "bg-[#09090b]"
                              : "bg-[#a1a1aa]"
 }`}
                            title={
                              asset.is_available_for_outgoing_rental
 ? "Bisa disewakan keluar (Klik untuk matikan)"
 : "Khusus internal (Klik untuk aktifkan)"
                            }
                          >
                          <span
                            className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                              asset.is_available_for_outgoing_rental
                                ? "translate-x-[2px]"
                                : "-translate-x-[2px]"
                            }`}
                          />
                          </button>
                          {isToggling && (
 <Loader2 size={12} className="animate-spin text-[#a1a1aa] inline" />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer with Summary Count */}
 <div className="p-3 bg-[#fafafa] border-t border-[#ececee] text-[11px] text-[#71717a] flex items-center justify-between">
          <span>Menampilkan {filteredAssets.length} dari total {assets.length} item hardware terdaftar</span>
          <span>ELTS & Kineva Master Hardware Registry</span>
        </div>
      </div>

      {/* Add Asset Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-[#ececee] bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95">
 <div className="flex items-center justify-between border-b border-[#ececee] pb-3">
 <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ff5a00]/10 text-[#c2410c]">
                  <Package size={17} />
                </div>
                <div>
 <h3 className="font-semibold text-base text-[#09090b] ">
                    Tambah Aset Hardware Baru
                  </h3>
 <p className="text-xs text-[#71717a]">
                    Daftarkan peralatan produksi broadcast, kamera, atau inventaris sewa
                  </p>
                </div>
              </div>
              <button
 type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-3 text-[#a1a1aa] hover:text-[#3f3f46]"
              >
                <X size={18} />
              </button>
            </div>

 <form onSubmit={handleCreateSubmit} className="space-y-3.5">
              {/* Asset Name */}
              <div>
 <label className="block text-xs font-semibold text-[#3f3f46] mb-1">
                  Nama Alat & Model *
                </label>
                <input
 type="text"
                  required
 placeholder="Contoh: Sony FX3 Cinema Line Body"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="min-h-11 w-full rounded-[12px] border border-[#ececee] bg-white px-3 text-sm text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#18181b]"
                />
              </div>

              {/* Category & Source Type */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
 <label className="block text-xs font-semibold text-[#3f3f46] mb-1">
                    Kategori Peralatan *
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) =>
                      setFormData({ ...formData, category: e.target.value as AssetCategory })
                    }
                    className="min-h-11 w-full rounded-[12px] border border-[#ececee] bg-white px-3 text-xs text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#18181b]"
                  >
                    {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
 <label className="block text-xs font-semibold text-[#3f3f46] mb-1">
                    Kepemilikan / Sumber *
                  </label>
                  <select
                    value={formData.source_type}
                    onChange={(e) => {
                      const st = e.target.value as AssetSourceType;
                      setFormData({
                        ...formData,
                        source_type: st,
                        owner_name:
 st === "IN_HOUSE"
 ? "Studio"
 : st === "PARTNER_OWNED"
 ? "El"
 : "Koi Rental",
                      });
                    }}
                    className="min-h-11 w-full rounded-[12px] border border-[#ececee] bg-white px-3 text-xs text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#18181b]"
                  >
 <option value="IN_HOUSE">Milik Studio (In-House)</option>
 <option value="PARTNER_OWNED">Milik Partner (El / Cahyo)</option>
 <option value="VENDOR_RENTAL">Vendor Luar (e.g. Koi Rental)</option>
                  </select>
                </div>
              </div>

              {/* Dynamic Owner / Vendor Details */}
 {formData.source_type === "PARTNER_OWNED" && (
                <div>
 <label className="block text-xs font-semibold text-[#3f3f46] mb-1">
                    Nama Partner Pemilik *
                  </label>
                  <input
 type="text"
                    required
 placeholder="Contoh: El / Cahyo / Ray"
                    value={formData.owner_name}
                    onChange={(e) => setFormData({ ...formData, owner_name: e.target.value })}
                    className="min-h-11 w-full rounded-[12px] border border-[#ececee] bg-white px-3 text-xs text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#18181b]"
                  />
                </div>
              )}

 {formData.source_type === "VENDOR_RENTAL" && (
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
 <label className="block text-xs font-semibold text-[#3f3f46] mb-1">
                      Nama Vendor Rental *
                    </label>
                    <input
 type="text"
                      required
 placeholder="Contoh: Koi Rental Purwokerto"
 value={formData.vendor_name || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          vendor_name: e.target.value,
                          owner_name: e.target.value,
                        })
                      }
                      className="min-h-11 w-full rounded-[12px] border border-[#ececee] bg-white px-3 text-xs text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#18181b]"
                    />
                  </div>
                  <div>
 <label className="block text-xs font-semibold text-[#3f3f46] mb-1">
                      No. WhatsApp Vendor
                    </label>
                    <input
 type="text"
 placeholder="Contoh: 081327889900"
 value={formData.vendor_phone || ""}
                      onChange={(e) =>
                        setFormData({ ...formData, vendor_phone: e.target.value })
                      }
                      className="min-h-11 w-full rounded-[12px] border border-[#ececee] bg-white px-3 text-xs text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#18181b]"
                    />
                  </div>
                </div>
              )}

              {/* Rates & Valuation */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
 <label className="block text-xs font-semibold text-[#3f3f46] mb-1">
                    Tarif Sewa Harian (Rp)
                  </label>
                  <input
 type="number"
 min="0"
 step="10000"
 placeholder="Contoh: 350000"
 value={formData.daily_rental_rate || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, daily_rental_rate: Number(e.target.value) })
                    }
                    className="min-h-11 w-full rounded-[12px] border border-[#ececee] bg-white px-3 font-mono text-sm text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#18181b]"
                  />
                </div>

                <div>
 <label className="block text-xs font-semibold text-[#3f3f46] mb-1">
                    Nilai Pergantian / Valuasi (Rp)
                  </label>
                  <input
 type="number"
 min="0"
 step="50000"
 placeholder="Contoh: 35000000"
 value={formData.replacement_value || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, replacement_value: Number(e.target.value) })
                    }
                    className="min-h-11 w-full rounded-[12px] border border-[#ececee] bg-white px-3 font-mono text-sm text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#18181b]"
                  />
                </div>
              </div>

              {/* Serial Number & Condition */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
 <label className="block text-xs font-semibold text-[#3f3f46] mb-1">
                    Nomor Seri (Serial Number)
                  </label>
                  <input
 type="text"
 placeholder="Contoh: SN-8829-FX3"
 value={formData.serial_number || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, serial_number: e.target.value })
                    }
                    className="min-h-11 w-full rounded-[12px] border border-[#ececee] bg-white px-3 font-mono text-xs text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#18181b]"
                  />
                </div>

                <div>
 <label className="block text-xs font-semibold text-[#3f3f46] mb-1">
                    Status Kondisi Fisik
                  </label>
                  <select
                    value={formData.condition_status}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        condition_status: e.target.value as ConditionStatus,
                      })
                    }
                    className="min-h-11 w-full rounded-[12px] border border-[#ececee] bg-white px-3 text-xs text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#18181b]"
                  >
                    {Object.entries(CONDITION_CONFIG).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Outgoing Rental Checkbox */}
              <div className="flex items-center gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="outgoing_rental_chk"
                  checked={formData.is_available_for_outgoing_rental}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      is_available_for_outgoing_rental: e.target.checked,
                    })
                  }
                  className="h-5 w-5 rounded border-[#ececee] text-[#09090b] focus:ring-[#18181b]"
                />
                <label
                  htmlFor="outgoing_rental_chk"
                  className="min-h-11 flex cursor-pointer items-center text-xs font-medium text-[#3f3f46]"
                >
                  Tersedia untuk disewakan ke pihak luar (Outgoing Rental)
                </label>
              </div>

              {/* Notes */}
              <div>
 <label className="block text-xs font-semibold text-[#3f3f46] mb-1">
                  Keterangan / Aksesori Bawaan
                </label>
                <input
 type="text"
 placeholder="Contoh: Termasuk 2 baterai NP-FZ100, charger dual, dan cage SmallRig"
 value={formData.notes || ""}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="min-h-11 w-full rounded-[12px] border border-[#ececee] bg-white px-3 text-xs text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#18181b]"
                />
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-end gap-2 border-t border-[#ececee] pt-3">
                <Button
 type="button"
 variant="outline"
                  size="default"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Batal
                </Button>
                <Button
 type="submit"
                  size="default"
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 bg-[#09090b] text-white hover:bg-[#27272a]"
                >
 {isSubmitting && <Loader2 size={13} className="animate-spin" />}
                  Simpan Aset ke Database
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Asset Utilization & Calendar Drawer */}
      <AssetUtilizationDrawer
        asset={selectedAssetForDrawer}
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          setSelectedAssetForDrawer(null);
        }}
        onToggleOutgoingRental={(updatedAsset) => {
          setAssets((prev) =>
            prev.map((a) => (a.id === updatedAsset.id ? updatedAsset : a))
          );
          setSelectedAssetForDrawer(updatedAsset);
        }}
      />
    </div>
  );
}
