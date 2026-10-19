"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Building2,
  Package,
  Sparkles,
  FileText,
  User,
  Phone,
  MapPin,
  HelpCircle,
  Coins,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { StudioBankAccount } from "@/lib/studio/payment-methods";
import {
  createRentalInvoiceAction,
  type AvailableAsset,
  type AvailableProject,
} from "@/app/actions/invoice-actions";

interface CreateRentalInvoiceModalProps {
  assets: AvailableAsset[];
  projects: AvailableProject[];
  /** Configured studio accounts, used to prefill payment terms. */
  bankAccounts: StudioBankAccount[];
  trigger?: React.ReactNode;
  onSuccess?: (invoiceNumber: string) => void;
}

interface RentalLineItemState {
  id: string;
  description: string;
  assetId: string | null;
  quantity: number;
  durationDays: number;
  unitPrice: number;
}

function formatIDR(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function CreateRentalInvoiceModal({
  assets,
  projects,
  bankAccounts,
  trigger,
  onSuccess,
}: CreateRentalInvoiceModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form Mode: RENTAL (Mode B) vs PROJECT (Mode A)
  const [mode, setMode] = useState<"RENTAL" | "PROJECT">("RENTAL");

  // Mode B: Client & Rental Info
  const [clientName, setClientName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");

  const todayStr = useMemo(() => toLocalDateString(new Date()), []);
  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return toLocalDateString(d);
  }, []);

  const [rentalStartDate, setRentalStartDate] = useState(todayStr);
  const [rentalEndDate, setRentalEndDate] = useState(todayStr);

  // Auto-calculated duration in days based on start & end dates
  const calculatedDuration = useMemo(() => {
    try {
      const start = new Date(rentalStartDate).getTime();
      const end = new Date(rentalEndDate).getTime();
      if (isNaN(start) || isNaN(end)) return 1;
      const diffMs = end - start;
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
      return Math.max(1, diffDays);
    } catch {
      return 1;
    }
  }, [rentalStartDate, rentalEndDate]);

  // Mode A: Existing Project
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    projects[0]?.id || ""
  );

  // Dynamic Line Items Repeater
  const [lineItems, setLineItems] = useState<RentalLineItemState[]>([
    {
      id: "item-1",
      description: "",
      assetId: null,
      quantity: 1,
      durationDays: 1,
      unitPrice: 0,
    },
  ]);

  // Payment Terms
  const [dpPct, setDpPct] = useState<number>(30);
  const [dueDate, setDueDate] = useState<string>(todayStr);
  /*
   * Prefilled payment terms come from configuration, not a literal string.
   * A hardcoded default here means every new invoice is created quoting
   * whatever account was current when this file was last edited.
   */
  const [clientNotes, setClientNotes] = useState<string>(() =>
    bankAccounts.length > 0
      ? `Pembayaran transfer via rekening resmi ${bankAccounts
          .map((b) => `${b.bank}: ${b.account_number} a.n. ${b.account_holder}`)
          .join(" atau ")}. Mohon konfirmasi bukti transfer via WhatsApp.`
      : "Silakan hubungi studio untuk informasi rekening pembayaran.",
  );

  // When global duration changes, update duration on line items that matched previous duration
  const handleStartDateChange = (val: string) => {
    setRentalStartDate(val);
    if (new Date(val) > new Date(rentalEndDate)) {
      setRentalEndDate(val);
    }
  };

  const handleEndDateChange = (val: string) => {
    setRentalEndDate(val);
  };

  // Line item handlers
  const handleAddLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: "",
        assetId: null,
        quantity: 1,
        durationDays: calculatedDuration,
        unitPrice: 0,
      },
    ]);
  };

  const handleRemoveLineItem = (id: string) => {
    if (lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSelectAsset = (index: number, assetId: string) => {
    if (!assetId) {
      setLineItems((prev) =>
        prev.map((item, i) =>
          i === index ? { ...item, assetId: null } : item
        )
      );
      return;
    }

    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;

    setLineItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              assetId: asset.id,
              description: `${asset.name} (${asset.assetCode})`,
              unitPrice: asset.dailyRentalRate,
              durationDays: calculatedDuration,
            }
          : item
      )
    );
  };

  const handleUpdateItem = (
    index: number,
    field: keyof RentalLineItemState,
    value: string | number
  ) => {
    setLineItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        return {
          ...item,
          [field]: value,
        };
      })
    );
  };

  // Live Total Calculations
  const grossTotal = useMemo(() => {
    return lineItems.reduce((acc, item) => {
      const q = Number(item.quantity) || 0;
      const d = Number(item.durationDays) || 1;
      const r = Number(item.unitPrice) || 0;
      return acc + q * d * r;
    }, 0);
  }, [lineItems]);

  const dpAmount = useMemo(() => {
    return Math.round((grossTotal * dpPct) / 100);
  }, [grossTotal, dpPct]);

  const balanceDue = useMemo(() => {
    return Math.max(0, grossTotal - dpAmount);
  }, [grossTotal, dpAmount]);

  // Handle Project Selection for Mode A
  const handleSelectProject = (projId: string) => {
    setSelectedProjectId(projId);
    const p = projects.find((x) => x.id === projId);
    if (p && p.contractValue > 0) {
      setLineItems([
        {
          id: `item-proj-${Date.now()}`,
          description: `Layanan Produksi & Dokumentasi: ${p.name}`,
          assetId: null,
          quantity: 1,
          durationDays: 1,
          unitPrice: p.contractValue,
        },
      ]);
    }
  };

  // Reset form
  const handleReset = () => {
    setMode("RENTAL");
    setClientName("");
    setCompany("");
    setPhone("");
    setAddress("");
    setRentalStartDate(todayStr);
    setRentalEndDate(todayStr);
    setLineItems([
      {
        id: "item-1",
        description: "",
        assetId: null,
        quantity: 1,
        durationDays: 1,
        unitPrice: 0,
      },
    ]);
    setDpPct(30);
    setDueDate(todayStr);
    setErrorMessage(null);
  };

  // Submit Handler
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Form validations
    if (mode === "RENTAL") {
      if (!clientName.trim()) {
        setErrorMessage("Nama penyewa / klien wajib diisi.");
        return;
      }
      if (!phone.trim()) {
        setErrorMessage("Nomor WhatsApp / telepon wajib diisi.");
        return;
      }
    } else {
      if (!selectedProjectId) {
        setErrorMessage("Silakan pilih proyek produksi yang ditautkan.");
        return;
      }
    }

    if (lineItems.length === 0 || !lineItems.some((i) => i.description.trim())) {
      setErrorMessage("Tambahkan minimal 1 item alat atau layanan.");
      return;
    }

    if (grossTotal <= 0) {
      setErrorMessage("Total tagihan harus lebih besar dari Rp 0.");
      return;
    }

    startTransition(async () => {
      const payload = {
        mode,
        clientName: clientName.trim(),
        company: company.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        rentalStartDate,
        rentalEndDate,
        durationDays: calculatedDuration,
        projectId: mode === "PROJECT" ? selectedProjectId : undefined,
        lineItems: lineItems.map((item) => ({
          description: item.description.trim() || "Item Rental",
          assetId: item.assetId || undefined,
          quantity: Number(item.quantity) || 1,
          durationDays: Number(item.durationDays) || 1,
          unitPrice: Number(item.unitPrice) || 0,
          subtotal:
            (Number(item.quantity) || 1) *
            (Number(item.durationDays) || 1) *
            (Number(item.unitPrice) || 0),
        })),
        minimumDpPct: dpPct,
        dueDate,
        clientNotes: clientNotes.trim() || undefined,
      };

      const res = await createRentalInvoiceAction(payload);

      if (!res.success) {
        setErrorMessage(res.error || "Gagal membuat invoice.");
        return;
      }

      const invNumber = res.invoiceNumber || "";
      setOpen(false);
      handleReset();

      if (onSuccess && invNumber) {
        onSuccess(invNumber);
      } else if (invNumber) {
        router.push(`/invoice/${encodeURIComponent(invNumber)}`);
        router.refresh();
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <div onClick={() => setOpen(true)}>{trigger}</div>
      ) : (
        <Button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-[14px] bg-[#09090b] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#27272a] cursor-pointer"
        >
          <Plus size={16} /> Buat Invoice Baru
        </Button>
      )}

      <DialogContent className="max-w-3xl sm:rounded-[32px] p-6 sm:p-8">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center size-8 rounded-[10px] bg-[#09090b] text-white">
              <FileText size={16} />
            </span>
            <div>
              <DialogTitle className="text-xl font-bold tracking-tight text-[#09090b]">
                Penerbitan Invoice Resmi
              </DialogTitle>
              <DialogDescription className="text-xs text-[#71717a]">
                Nomor invoice faktur diterbitkan atomik via sequence INV/YYYY/MM/XXXX
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Mode Selector Tabs */}
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-[16px] bg-[#f4f4f5] p-1.5 border border-[#ececee]">
          <button
            type="button"
            onClick={() => setMode("RENTAL")}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-[12px] text-xs font-semibold transition-all cursor-pointer ${
              mode === "RENTAL"
                ? "bg-white text-[#09090b] shadow-xs"
                : "text-[#71717a] hover:text-[#09090b]"
            }`}
          >
            <Package size={14} className={mode === "RENTAL" ? "text-[#ff5a00]" : ""} />
            Sewa Lepas (Direct Gear Rental)
          </button>
          <button
            type="button"
            onClick={() => setMode("PROJECT")}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-[12px] text-xs font-semibold transition-all cursor-pointer ${
              mode === "PROJECT"
                ? "bg-white text-[#09090b] shadow-xs"
                : "text-[#71717a] hover:text-[#09090b]"
            }`}
          >
            <Building2 size={14} className={mode === "PROJECT" ? "text-[#ff5a00]" : ""} />
            Tautkan Proyek Produksi
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-6">
          {/* SECTION 1: STAKEHOLDER CONTEXT */}
          {mode === "RENTAL" ? (
            <div className="rounded-[20px] border border-[#ececee] bg-[#fafafa] p-4.5 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#09090b] uppercase tracking-wider">
                <User size={14} className="text-[#ff5a00]" />
                <span>Identitas Penyewa / Klien</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
                    Nama Lengkap Penyewa <span className="text-[#ff5a00]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Contoh: Budi Santoso"
                    className="w-full rounded-[12px] border border-[#ececee] bg-white px-3 py-2 text-xs text-[#09090b] outline-none focus:border-[#09090b]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
                    Instansi / Perusahaan (Opsional)
                  </label>
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Contoh: Media Creativa"
                    className="w-full rounded-[12px] border border-[#ececee] bg-white px-3 py-2 text-xs text-[#09090b] outline-none focus:border-[#09090b]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
                    WhatsApp / HP <span className="text-[#ff5a00]">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="081234567890"
                    className="w-full rounded-[12px] border border-[#ececee] bg-white px-3 py-2 text-xs text-[#09090b] outline-none focus:border-[#09090b]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
                    Alamat / Lokasi (Opsional)
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Contoh: Purwokerto Barat"
                    className="w-full rounded-[12px] border border-[#ececee] bg-white px-3 py-2 text-xs text-[#09090b] outline-none focus:border-[#09090b]"
                  />
                </div>
              </div>

              {/* Rental Dates Period */}
              <div className="pt-2 border-t border-[#ececee] grid gap-3 sm:grid-cols-3 items-end">
                <div>
                  <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
                    Tanggal Mulai Sewa
                  </label>
                  <input
                    type="date"
                    required
                    value={rentalStartDate}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                    className="w-full rounded-[12px] border border-[#ececee] bg-white px-3 py-2 text-xs text-[#09090b] outline-none focus:border-[#09090b]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
                    Tanggal Selesai
                  </label>
                  <input
                    type="date"
                    required
                    value={rentalEndDate}
                    onChange={(e) => handleEndDateChange(e.target.value)}
                    className="w-full rounded-[12px] border border-[#ececee] bg-white px-3 py-2 text-xs text-[#09090b] outline-none focus:border-[#09090b]"
                  />
                </div>
                <div className="rounded-[12px] border border-[#ececee] bg-white px-3 py-2 text-xs flex items-center justify-between">
                  <span className="text-[#71717a] font-medium">Durasi Sewa:</span>
                  <span className="font-mono font-bold text-[#09090b] bg-[#f4f4f5] px-2 py-0.5 rounded-[6px]">
                    {calculatedDuration} Hari
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* Mode A: Select Existing Project */
            <div className="rounded-[20px] border border-[#ececee] bg-[#fafafa] p-4.5 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#09090b] uppercase tracking-wider">
                <Building2 size={14} className="text-[#ff5a00]" />
                <span>Pilih Proyek Produksi Terdaftar</span>
              </div>
              <div>
                <select
                  value={selectedProjectId}
                  onChange={(e) => handleSelectProject(e.target.value)}
                  className="w-full rounded-[12px] border border-[#ececee] bg-white px-3 py-2.5 text-xs text-[#09090b] outline-none focus:border-[#09090b]"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — Klien: {p.customerName} ({formatIDR(p.contractValue)})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-[#71717a]">
                  Sistem akan menerbitkan invoice resmi yang langsung tersinkronisasi ke konsol proyek terkait.
                </p>
              </div>
            </div>
          )}

          {/* SECTION 2: LINE ITEMS REPEATER (AD-HOC NEGOTIATED PRICING) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#09090b] uppercase tracking-wider">
                <Package size={14} className="text-[#ff5a00]" />
                <span>Rincian Alat & Tarif Negosiasi</span>
              </div>
              <button
                type="button"
                onClick={handleAddLineItem}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#09090b] hover:text-[#ff5a00] transition-colors cursor-pointer"
              >
                <Plus size={14} /> Tambah Baris Alat
              </button>
            </div>

            <div className="space-y-2.5">
              {lineItems.map((item, idx) => {
                const subtotal =
                  (Number(item.quantity) || 0) *
                  (Number(item.durationDays) || 1) *
                  (Number(item.unitPrice) || 0);

                return (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-[16px] border border-[#ececee] bg-white space-y-3"
                  >
                    <div className="grid gap-2.5 sm:grid-cols-12 items-start">
                      {/* Asset Dropdown or Free Text */}
                      <div className="sm:col-span-5 space-y-1">
                        <label className="block text-[10px] font-semibold text-[#71717a] uppercase tracking-wider">
                          Pilih Dari Inventaris Gear
                        </label>
                        <select
                          value={item.assetId || ""}
                          onChange={(e) => handleSelectAsset(idx, e.target.value)}
                          className="w-full rounded-[10px] border border-[#ececee] bg-[#fafafa] px-2.5 py-1.5 text-xs text-[#09090b] outline-none"
                        >
                          <option value="">-- Pilih Gear Studio / Bebas --</option>
                          {assets.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.assetCode}) — {formatIDR(a.dailyRentalRate)}/hr
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          required
                          value={item.description}
                          onChange={(e) => handleUpdateItem(idx, "description", e.target.value)}
                          placeholder="Deskripsi alat / paket custom…"
                          className="w-full rounded-[10px] border border-[#ececee] bg-white px-2.5 py-1.5 text-xs text-[#09090b] outline-none focus:border-[#09090b]"
                        />
                      </div>

                      {/* Quantity */}
                      <div className="sm:col-span-2 space-y-1">
                        <label className="block text-[10px] font-semibold text-[#71717a] uppercase tracking-wider">
                          Qty
                        </label>
                        <input
                          type="number"
                          min="1"
                          required
                          value={item.quantity}
                          onChange={(e) => handleUpdateItem(idx, "quantity", Number(e.target.value))}
                          className="w-full rounded-[10px] border border-[#ececee] bg-white px-2.5 py-1.5 text-xs text-center font-mono text-[#09090b] outline-none focus:border-[#09090b]"
                        />
                      </div>

                      {/* Duration Days */}
                      <div className="sm:col-span-2 space-y-1">
                        <label className="block text-[10px] font-semibold text-[#71717a] uppercase tracking-wider">
                          Hari
                        </label>
                        <input
                          type="number"
                          min="1"
                          required
                          value={item.durationDays}
                          onChange={(e) => handleUpdateItem(idx, "durationDays", Number(e.target.value))}
                          className="w-full rounded-[10px] border border-[#ececee] bg-white px-2.5 py-1.5 text-xs text-center font-mono text-[#09090b] outline-none focus:border-[#09090b]"
                        />
                      </div>

                      {/* Unit Price per Day (Freely Negotiable) */}
                      <div className="sm:col-span-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="block text-[10px] font-semibold text-[#71717a] uppercase tracking-wider">
                            Tarif/Hari (Rp)
                          </label>
                          {lineItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveLineItem(item.id)}
                              className="text-[#a1a1aa] hover:text-[#ff5a00] transition-colors cursor-pointer"
                              title="Hapus baris"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="1000"
                          required
                          value={item.unitPrice}
                          onChange={(e) => handleUpdateItem(idx, "unitPrice", Number(e.target.value))}
                          placeholder="0"
                          className="w-full rounded-[10px] border border-[#ececee] bg-white px-2.5 py-1.5 text-xs font-mono text-right text-[#09090b] outline-none focus:border-[#09090b]"
                        />
                      </div>
                    </div>

                    {/* Subtotal row pill */}
                    <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-[#ececee]/60">
                      <span className="text-[#71717a]">
                        Subtotal ({item.quantity} unit × {item.durationDays} hari):
                      </span>
                      <span className="font-mono font-bold text-[#09090b]">
                        {formatIDR(subtotal)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* SECTION 3: TOTAL & PAYMENT INSTRUCTIONS */}
          <div className="rounded-[20px] border border-[#ececee] bg-[#fafafa] p-4.5 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#71717a]">TOTAL TAGIHAN (GROSS):</span>
              <span className="text-lg font-serif font-extrabold text-[#09090b] tabular-nums">
                {formatIDR(grossTotal)}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-[#ececee]">
              <div>
                <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
                  Uang Muka / DP (%):
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={dpPct}
                    onChange={(e) => setDpPct(Number(e.target.value))}
                    className="rounded-[10px] border border-[#ececee] bg-white px-3 py-1.5 text-xs text-[#09090b] outline-none"
                  >
                    <option value={0}>0% (Lunas di Muka / Full)</option>
                    <option value={30}>30% Minimum DP</option>
                    <option value={50}>50% DP Standar Studio</option>
                    <option value={100}>100% Pembayaran Penuh</option>
                  </select>
                  <span className="font-mono text-xs font-semibold text-[#09090b]">
                    {formatIDR(dpAmount)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
                  Jatuh Tempo Pembayaran:
                </label>
                <input
                  type="date"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded-[10px] border border-[#ececee] bg-white px-3 py-1.5 text-xs text-[#09090b] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
                Catatan / Instruksi Pembayaran:
              </label>
              <textarea
                rows={2}
                value={clientNotes}
                onChange={(e) => setClientNotes(e.target.value)}
                placeholder="Instruksi transfer rekening, syarat pengembalian, deposit..."
                className="w-full rounded-[10px] border border-[#ececee] bg-white p-2.5 text-xs text-[#09090b] outline-none"
              />
            </div>
          </div>

          {errorMessage && (
            <div className="flex items-center gap-2 rounded-[12px] border border-[#ff5a00] bg-[#fff6f2] p-3 text-xs text-[#ff5a00]">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Dialog Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="rounded-[14px] min-h-11 px-5 text-xs font-semibold cursor-pointer border-[#ececee]"
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="rounded-[14px] min-h-11 px-6 text-xs font-semibold bg-[#09090b] text-white hover:bg-[#27272a] cursor-pointer"
            >
              {isPending ? (
                <>
                  <Clock className="mr-2 h-4 w-4 animate-spin" />
                  Menerbitkan Invoice…
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4 text-[#ff5a00]" />
                  Terbitkan & Lihat Invoice
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
