"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Wrench,
  Plus,
  Loader2,
  Check,
  Sparkles,
  X,
  Layers,
  ChevronDown,
  Building,
  Users,
  Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addEquipmentFromPreset,
  addProjectExpense,
} from "@/app/actions/admin-expenses";
import { addExpenseFromHardwarePreset } from "@/app/actions/admin-inventory";
import type {
  EquipmentPresetRow,
  ExpenseCategory,
  ExpensePaidBy,
  ProjectExpenseRow,
} from "@/types/operations";
import type { AssetSourceType } from "@/types/inventory";

interface HardwarePresetToolbarProps {
  projectId: string;
  presets?: EquipmentPresetRow[];
  onExpenseAdded?: (expense: ProjectExpenseRow) => void;
  onRefresh?: () => void;
}

interface HardwareShortcutItem {
  id: string;
  label: string;
  fallbackName: string;
  fallbackRate: number;
  sourceType: AssetSourceType;
  ownerName: string;
  vendorName?: string | null;
  vendorPhone?: string | null;
  category: string;
}

interface HardwareStripConfig {
  id: string;
  title: string;
  sourceType: AssetSourceType;
  badgeLabel: string;
  badgeClass: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  shortcuts: HardwareShortcutItem[];
}

const HARDWARE_STRIPS: HardwareStripConfig[] = [
  {
 id: "strip-in-house",
 title: "Milik Studio",
 sourceType: "IN_HOUSE",
 badgeLabel: "Studio KINEVA / ELTS",
    badgeClass: "bg-[#fafafa] text-[#52525b] border-[#ececee] ",
    icon: Building,
    shortcuts: [
      {
 id: "fx3",
 label: "+ Sony FX3 (450k)",
 fallbackName: "Sony FX3 Cinema Line Body",
        fallbackRate: 450000,
 sourceType: "IN_HOUSE",
 ownerName: "Studio",
 category: "CAMERA",
      },
      {
 id: "a7iv",
 label: "+ Sony A7IV (350k)",
 fallbackName: "Sony A7IV Full-Frame Body",
        fallbackRate: 350000,
 sourceType: "IN_HOUSE",
 ownerName: "Studio",
 category: "CAMERA",
      },
      {
 id: "vmix",
 label: "+ vMix Rig 4K (750k)",
 fallbackName: "vMix 4K Broadcast Rig (Core i9 + RTX 4080)",
        fallbackRate: 750000,
 sourceType: "IN_HOUSE",
 ownerName: "Studio",
 category: "BROADCAST_SWITCHER",
      },
      {
 id: "hollyland_c1",
 label: "+ Cosmo C1 (350k)",
 fallbackName: "Hollyland Cosmo C1 Wireless HDMI/SDI",
        fallbackRate: 350000,
 sourceType: "IN_HOUSE",
 ownerName: "Studio",
 category: "WIRELESS_VIDEO",
      },
    ],
  },
  {
 id: "strip-partner",
 title: "Milik Partner",
 sourceType: "PARTNER_OWNED",
 badgeLabel: "Partner (El / Cahyo)",
    badgeClass: "bg-[#fafafa] text-[#52525b] border-[#ececee] ",
    icon: Users,
    shortcuts: [
      {
 id: "zve10_el",
 label: "+ ZV-E10 El (150k)",
 fallbackName: "Sony ZV-E10 Body (El)",
        fallbackRate: 150000,
 sourceType: "PARTNER_OWNED",
 ownerName: "El",
 category: "CAMERA",
      },
      {
 id: "a6000_cahyo",
 label: "+ A6000 Cahyo (100k)",
 fallbackName: "Sony A6000 Body (Cahyo - Backup Cam)",
        fallbackRate: 100000,
 sourceType: "PARTNER_OWNED",
 ownerName: "Cahyo",
 category: "CAMERA",
      },
      {
 id: "sdi_30m",
 label: "+ SDI 30m Reel (40k)",
 fallbackName: "Kabel SDI Belden 30m w/ Reel",
        fallbackRate: 40000,
 sourceType: "PARTNER_OWNED",
 ownerName: "Studio / Partner",
 category: "CABLE_ACCESSORY",
      },
    ],
  },
  {
 id: "strip-vendor",
 title: "Vendor Rental (Koi)",
 sourceType: "VENDOR_RENTAL",
 badgeLabel: "Koi Rental Purwokerto",
    badgeClass: "bg-[#ff5a00]/5 text-[#ff5a00] border-[#ff5a00]/50 ",
    icon: Store,
    shortcuts: [
      {
 id: "nx200_koi",
 label: "+ NX200 Koi (400k)",
 fallbackName: "Sony HXR-NX200 Camcorder 4K",
        fallbackRate: 400000,
 sourceType: "VENDOR_RENTAL",
 ownerName: "Koi Rental",
 vendorName: "Koi Rental Purwokerto",
 vendorPhone: "081327889900",
 category: "CAMERA",
      },
      {
 id: "x32_koi",
 label: "+ X32 Mixer Koi (400k)",
 fallbackName: "Behringer X32 Producer Digital Mixer",
        fallbackRate: 400000,
 sourceType: "VENDOR_RENTAL",
 ownerName: "Koi Rental",
 vendorName: "Koi Rental Purwokerto",
 vendorPhone: "081327889900",
 category: "AUDIO",
      },
      {
 id: "hdmi_optic",
 label: "+ HDMI Optic 20m (50k)",
 fallbackName: "Kabel HDMI Fiber Optic 20m (4K 60Hz)",
        fallbackRate: 50000,
 sourceType: "VENDOR_RENTAL",
 ownerName: "Koi Rental",
 vendorName: "Koi Rental Purwokerto",
 vendorPhone: "081327889900",
 category: "CABLE_ACCESSORY",
      },
    ],
  },
];

const EXPENSE_CATEGORY_OPTIONS: { value: ExpenseCategory; label: string }[] = [
 { value: "EQUIPMENT_RENTAL", label: "Sewa Alat Broadcast & Foto" },
 { value: "CREW_FEE", label: "Honor Tim Kru Lapangan" },
 { value: "TRANSPORT_LOGISTICS", label: "Transportasi & Logistik" },
 { value: "MEALS_CONSUMPTION", label: "Konsumsi Tim & Katering" },
 { value: "BANDWIDTH_SIM", label: "Paket Data SIM / Kuota Live" },
 { value: "SUPPLIES_MISC", label: "Perlengkapan & Baterai / Lakban" },
 { value: "EQUIPMENT_DEPRECIATION", label: "Penyusutan Alat In-House" },
 { value: "CLIENT_ADDON", label: "Biaya Tambahan Khusus Klien" },
];

const PAID_BY_OPTIONS: { value: ExpensePaidBy; label: string }[] = [
 { value: "STUDIO_CASH", label: "Kas Studio (Default)" },
 { value: "FOUNDER_A_ADVANCE", label: "Talangan Founder A (Ray)" },
 { value: "FOUNDER_B_ADVANCE", label: "Talangan Founder B (Partner)" },
 { value: "CLIENT_BILLED", label: "Ditagihkan ke Klien (Reimburse)" },
];

export function HardwarePresetToolbar({
  projectId,
  presets = [],
  onExpenseAdded,
  onRefresh,
}: HardwarePresetToolbarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeShortcutId, setActiveShortcutId] = useState<string | null>(null);
  const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Custom Item Modal State
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
 const [customName, setCustomName] = useState("");
 const [customCategory, setCustomCategory] = useState<ExpenseCategory>("EQUIPMENT_RENTAL");
 const [customUnitCost, setCustomUnitCost] = useState("");
 const [customQuantity, setCustomQuantity] = useState("1");
 const [customPaidBy, setCustomPaidBy] = useState<ExpensePaidBy>("STUDIO_CASH");
 const [customSourceType, setCustomSourceType] = useState<AssetSourceType>("IN_HOUSE");
 const [customOwnerName, setCustomOwnerName] = useState("Studio");
 const [customVendorName, setCustomVendorName] = useState("");
 const [customNotes, setCustomNotes] = useState("");
  const [isSubmittingCustom, setIsSubmittingCustom] = useState(false);

  // Show all presets dropdown/drawer toggle
  const [showAllPresets, setShowAllPresets] = useState(false);

  const handleShortcutClick = async (shortcut: HardwareShortcutItem) => {
    setActiveShortcutId(shortcut.id);
    setErrorMessage(null);
    setFeedbackMessage(null);

    startTransition(async () => {
      try {
        const result = await addExpenseFromHardwarePreset(projectId, {
          name: shortcut.fallbackName,
          unitCost: shortcut.fallbackRate,
          quantity: 1,
          sourceType: shortcut.sourceType,
          ownerName: shortcut.ownerName,
          vendorName: shortcut.vendorName || null,
          vendorPhone: shortcut.vendorPhone || null,
 notes: `Preset: ${shortcut.label} (${shortcut.sourceType})`,
        });

        if (result.success && result.expense) {
          setRecentlyAddedId(shortcut.id);
 setFeedbackMessage(`${shortcut.fallbackName} berhasil ditambahkan ke Cost Sheet!`);
          setTimeout(() => {
            setRecentlyAddedId(null);
            setFeedbackMessage(null);
          }, 3500);

          if (onExpenseAdded) onExpenseAdded(result.expense);
          if (onRefresh) onRefresh();
          router.refresh();
        } else {
 setErrorMessage(result.error || "Gagal menambahkan peralatan.");
        }
      } catch (err: unknown) {
        setErrorMessage(
 err instanceof Error ? err.message : "Terjadi kesalahan saat menambahkan alat."
        );
      } finally {
        setActiveShortcutId(null);
      }
    });
  };

  const handleSelectAnyPreset = async (presetId: string) => {
    const selected = presets.find((p) => p.id === presetId);
    if (!selected) return;

    setActiveShortcutId(presetId);
    setErrorMessage(null);

    startTransition(async () => {
      try {
        const result = await addEquipmentFromPreset(projectId, presetId, 1);
        if (result.success && result.expense) {
 setFeedbackMessage(`${selected.name} berhasil ditambahkan!`);
          setTimeout(() => setFeedbackMessage(null), 3000);
          setShowAllPresets(false);
          if (onExpenseAdded) onExpenseAdded(result.expense);
          if (onRefresh) onRefresh();
          router.refresh();
        } else {
 setErrorMessage(result.error || "Gagal menambahkan preset.");
        }
      } catch (err: unknown) {
        setErrorMessage(
 err instanceof Error ? err.message : "Terjadi kesalahan sistem."
        );
      } finally {
        setActiveShortcutId(null);
      }
    });
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) {
 setErrorMessage("Nama item tidak boleh kosong.");
      return;
    }
 const unitCost = Number(customUnitCost.replace(/[^0-9]/g, ""));
    const qty = Number(customQuantity) || 1;

    if (isNaN(unitCost) || unitCost < 0) {
 setErrorMessage("Biaya satuan harus berupa angka valid.");
      return;
    }

    setIsSubmittingCustom(true);
    setErrorMessage(null);

    try {
      let result: { success: boolean; expense?: ProjectExpenseRow; error?: string };

 if (customCategory === "EQUIPMENT_RENTAL") {
        result = await addExpenseFromHardwarePreset(projectId, {
          name: customName.trim(),
          unitCost,
          quantity: qty,
          sourceType: customSourceType,
          ownerName:
 customSourceType === "PARTNER_OWNED"
 ? customOwnerName.trim() || "Partner"
 : customSourceType === "VENDOR_RENTAL"
 ? customVendorName.trim() || "Vendor Luar"
 : "Studio",
 vendorName: customSourceType === "VENDOR_RENTAL" ? customVendorName.trim() : null,
          notes: customNotes.trim() || null,
        });
      } else {
        result = await addProjectExpense(projectId, {
          category: customCategory,
          name: customName.trim(),
          unitCost,
          quantity: qty,
          paidBy: customPaidBy,
          notes: customNotes.trim() || null,
        });
      }

      if (result.success && result.expense) {
 setFeedbackMessage(`Item "${customName}" berhasil dicatat ke Cost Sheet!`);
        setTimeout(() => setFeedbackMessage(null), 3500);
        setIsCustomModalOpen(false);
        // Reset form
 setCustomName("");
 setCustomUnitCost("");
 setCustomQuantity("1");
 setCustomNotes("");
 setCustomVendorName("");
        if (onExpenseAdded) onExpenseAdded(result.expense);
        if (onRefresh) onRefresh();
        router.refresh();
      } else {
 setErrorMessage(result.error || "Gagal menyimpan item kustom.");
      }
    } catch (err: unknown) {
      setErrorMessage(
 err instanceof Error ? err.message : "Terjadi kesalahan saat menyimpan."
      );
    } finally {
      setIsSubmittingCustom(false);
    }
  };

  return (
 <div className="w-full space-y-3.5">
      {/* Top Banner / Toolbar Header */}
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#ececee] pb-2">
 <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded-md bg-[#ff5a00]/5 text-[#ff5a00] flex items-center justify-center">
            <Sparkles size={14} />
          </div>
          <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[#09090b] ">
              Hardware & Production Preset Toolbar
            </h4>
          <p className="text-[11px] text-[#52525b] ">
              1-Klik langsung mencatat pengeluaran sewa hardware sesuai klasifikasi kepemilikan
            </p>
          </div>
        </div>

 <div className="flex items-center gap-2">
          {presets.length > 0 && (
            <button
 type="button"
              onClick={() => setShowAllPresets(!showAllPresets)}
              className="inline-flex min-h-11 items-center text-xs text-[#52525b] hover:text-[#09090b] gap-1 font-medium cursor-pointer"
            >
              <Layers size={13} />
              <span>Semua Preset ({presets.length})</span>
              <ChevronDown
                size={12}
 className={`transform transition-transform ${showAllPresets ? "rotate-180" : ""}`}
              />
            </button>
          )}

          {/* Custom Item Trigger */}
          <button
 type="button"
            onClick={() => setIsCustomModalOpen(true)}
            className="whitespace-nowrap inline-flex min-h-11 items-center px-3.5 rounded-[10px] text-xs font-medium bg-[#09090b] text-white hover:bg-[#27272a] transition-all gap-1 shadow-2xs cursor-pointer"
          >
            <Plus size={12} />
            <span>+ Custom Item</span>
          </button>
        </div>
      </div>

      {/* Feedback & Error Notifications */}
      {feedbackMessage && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#fafafa] border border-[#ececee] rounded-[12px] text-xs text-[#52525b] animate-in fade-in slide-in-from-top-1">
          <Check size={14} className="text-[#09090b] shrink-0" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#ff5a00]/5 border border-[#ff5a00]/50 rounded-[12px] text-xs text-[#ff5a00] animate-in fade-in">
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-[#ff5a00] hover:text-[#09090b] ml-2 cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* 3 Categorized Visual Source Strips */}
 <div className="space-y-2.5">
        {HARDWARE_STRIPS.map((strip) => {
          const StripIcon = strip.icon;
          return (
            <div
              key={strip.id}
              className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 rounded-[12px] bg-[#fafafa]/70 border border-[#ececee] "
            >
              {/* Strip Label Badge */}
 <div className="sm:w-44 shrink-0 flex items-center gap-1.5">
                <span
 className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${strip.badgeClass}`}
                >
                  <StripIcon size={12} />
                  <span>{strip.title}</span>
                </span>
              </div>

              {/* Strip Shortcuts Row */}
 <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin flex-1">
                {strip.shortcuts.map((shortcut) => {
                  const isLoading = isPending && activeShortcutId === shortcut.id;
                  const isRecentlyAdded = recentlyAddedId === shortcut.id;

                  return (
                    <button
                      key={shortcut.id}
 type="button"
                      disabled={isPending}
                      onClick={() => handleShortcutClick(shortcut)}
                      className={`whitespace-nowrap inline-flex min-h-11 items-center px-3.5 rounded-[10px] text-xs font-medium border transition-all gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none ${
                        isRecentlyAdded
                          ? "bg-[#09090b] text-white border-[#09090b] ring-2 ring-[#a1a1aa]"
                          : "bg-white text-[#09090b] border-[#ececee] hover:border-[#ff5a00] hover:bg-[#ff5a00]/5 hover:text-[#ff5a00] "
                      }`}
                    >
                      {isLoading ? (
                        <Loader2 size={12} className="animate-spin text-[#ff5a00]" />
                      ) : isRecentlyAdded ? (
                        <Check size={12} className="text-white" />
                      ) : (
                        <Plus size={12} className="text-[#a1a1aa] group-hover:text-[#ff5a00]" />
                      )}
                      <span>{shortcut.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Expanded Catalog Grid (if user opens all presets) */}
      {showAllPresets && presets.length > 0 && (
        <div className="p-3 bg-[#fafafa] border border-[#ececee] rounded-[12px] space-y-2 mt-2 animate-in fade-in">
          <p className="text-[11px] font-semibold text-[#52525b] uppercase tracking-wider">
            Semua Preset Hardware Terdaftar di Database ({presets.length} item)
          </p>
 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
            {presets.map((preset) => {
              const isItemLoading = isPending && activeShortcutId === preset.id;
 const formattedRate = (Number(preset.default_rental_rate) / 1000).toLocaleString() + "k";
              return (
                <button
                  key={preset.id}
 type="button"
                  disabled={isPending}
                  onClick={() => handleSelectAnyPreset(preset.id)}
                  className="text-left p-2 inline-flex min-h-11 flex-col justify-between rounded-[10px] bg-white border border-[#ececee] hover:border-[#ff5a00] text-xs transition group disabled:opacity-50 cursor-pointer"
                >
                  <span className="font-medium text-[#09090b] line-clamp-1 group-hover:text-[#ff5a00]">
                    {preset.name}
                  </span>
                  <div className="flex items-center justify-between mt-1 text-[11px] text-[#52525b]">
                    <span className="text-[10px] bg-[#fafafa] px-1 py-0.5 rounded">
                      {preset.category}
                    </span>
                    <span className="font-semibold text-[#ff5a00] tabular-nums ">
                      {isItemLoading ? (
                        <Loader2 size={11} className="animate-spin inline" />
                      ) : (
 `Rp ${formattedRate}`
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Custom Item Modal */}
      {isCustomModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-[16px] shadow-2xl border border-[#ececee] max-w-lg w-full p-6 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-[#ececee] pb-3">
 <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-[#fafafa] flex items-center justify-center text-[#09090b] ">
                  <Wrench size={16} />
                </div>
                <div>
                <h3 className="font-semibold text-base text-[#09090b] ">
                    Tambah Pengeluaran / Hardware Kustom
                  </h3>
                  <p className="text-xs text-[#52525b]">
                    Catat pengeluaran khusus, logistik, atau hardware non-preset
                  </p>
                </div>
              </div>
              <button
 type="button"
                onClick={() => setIsCustomModalOpen(false)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center text-[#a1a1aa] hover:text-[#52525b] p-1 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

 <form onSubmit={handleCustomSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#52525b] mb-1">
                  Nama Item / Pengeluaran *
                </label>
                <input
 type="text"
                  required
 placeholder="Contoh: Sewa Genset 5kVA / Grab Express Lensa"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-[10px] border border-[#ececee] bg-white text-sm text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#ff5a00]"
                />
              </div>

 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                <label className="block text-xs font-semibold text-[#52525b] mb-1">
                    Kategori Biaya
                  </label>
                  <select
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value as ExpenseCategory)}
                    className="w-full px-3 py-2.5 rounded-[10px] border border-[#ececee] bg-white text-xs text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#ff5a00]"
                  >
                    {EXPENSE_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                <label className="block text-xs font-semibold text-[#52525b] mb-1">
                    Sumber Dana / Pembayar
                  </label>
                  <select
                    value={customPaidBy}
                    onChange={(e) => setCustomPaidBy(e.target.value as ExpensePaidBy)}
                    className="w-full px-3 py-2.5 rounded-[10px] border border-[#ececee] bg-white text-xs text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#ff5a00]"
                  >
                    {PAID_BY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

 {customCategory === "EQUIPMENT_RENTAL" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-2.5 rounded-[10px] bg-[#fafafa] border border-[#ececee] ">
                  <div>
                    <label className="block text-xs font-semibold text-[#52525b] mb-1">
                      Klasifikasi Asal Alat
                    </label>
                    <select
                      value={customSourceType}
                      onChange={(e) => setCustomSourceType(e.target.value as AssetSourceType)}
                      className="w-full px-2.5 py-2 rounded-[10px] border border-[#ececee] bg-white text-xs text-[#09090b] "
                    >
 <option value="IN_HOUSE">Milik Studio (In-House)</option>
 <option value="PARTNER_OWNED">Milik Partner (El / Cahyo)</option>
 <option value="VENDOR_RENTAL">Vendor Luar (e.g. Koi Rental)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#52525b] mb-1">
 {customSourceType === "PARTNER_OWNED"
 ? "Nama Partner"
 : customSourceType === "VENDOR_RENTAL"
 ? "Nama Vendor Rental"
 : "Nama Pemilik"}
                    </label>
 {customSourceType === "VENDOR_RENTAL" ? (
                      <input
 type="text"
 placeholder="Contoh: Koi Rental Purwokerto"
                        value={customVendorName}
                        onChange={(e) => setCustomVendorName(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-[10px] border border-[#ececee] bg-white text-xs text-[#09090b] "
                      />
                    ) : (
                      <input
 type="text"
 placeholder="Contoh: El / Cahyo / Studio"
                        value={customOwnerName}
                        onChange={(e) => setCustomOwnerName(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-[10px] border border-[#ececee] bg-white text-xs text-[#09090b] "
                      />
                    )}
                  </div>
                </div>
              )}

 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                <label className="block text-xs font-semibold text-[#52525b] mb-1">
                    Biaya Satuan (Rp) *
                  </label>
                  <input
 type="number"
                    required
 min="0"
 step="1000"
 placeholder="Contoh: 250000"
                    value={customUnitCost}
                    onChange={(e) => setCustomUnitCost(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-[10px] border border-[#ececee] bg-white text-sm font-mono text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#ff5a00]"
                  />
                </div>

                <div>
                <label className="block text-xs font-semibold text-[#52525b] mb-1">
                    Kuantitas / Jumlah
                  </label>
                  <input
 type="number"
                    required
 min="1"
 step="1"
                    value={customQuantity}
                    onChange={(e) => setCustomQuantity(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-[10px] border border-[#ececee] bg-white text-sm font-mono text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#ff5a00]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#52525b] mb-1">
                  Catatan / Bukti / Vendor
                </label>
                <input
 type="text"
 placeholder="Keterangan opsional (mis. Vendor Rental Semarang)"
                  value={customNotes}
                  onChange={(e) => setCustomNotes(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-[10px] border border-[#ececee] bg-white text-xs text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#ff5a00]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#ececee] ">
                <Button
 type="button"
 variant="outline"
 size="sm"
                  onClick={() => setIsCustomModalOpen(false)}
                  disabled={isSubmittingCustom}
                >
                  Batal
                </Button>
                <Button
 type="submit"
 size="sm"
                  disabled={isSubmittingCustom}
                  className="inline-flex min-h-11 items-center bg-[#09090b] hover:bg-[#27272a] text-white gap-1.5"
                >
                {isSubmittingCustom && <Loader2 size={13} className="animate-spin" />}
                  Simpan ke Cost Sheet
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
