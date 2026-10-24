"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Edit2,
  Loader2,
  Percent,
  Plus,
  Power,
  Search,
  Tag,
  Ticket,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  deleteReferralCode,
  saveReferralCode,
  toggleReferralCodeStatus,
  type ReferralFormValues,
} from "@/app/actions/admin-referrals";
import type { ReferralCodeRow, ReferralDiscountType, ReferralStatus } from "@/types/database";

function formatIDR(amount: number): string {
  return `Rp ${Math.round(amount).toLocaleString("id-ID")}`;
}

export function ReferralManagementClient({
  initialCodes,
}: {
  initialCodes: ReferralCodeRow[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | ReferralStatus>("ALL");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCode, setEditingCode] = useState<ReferralCodeRow | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Modal Form State
  const [formCode, setFormCode] = useState("");
  const [formSalesName, setFormSalesName] = useState("");
  const [formDiscountType, setFormDiscountType] = useState<ReferralDiscountType>("percentage");
  const [formDiscountValue, setFormDiscountValue] = useState("");
  const [formMaxUses, setFormMaxUses] = useState("");
  const [formExpiryDate, setFormExpiryDate] = useState("");
  const [formStatus, setFormStatus] = useState<ReferralStatus>("ACTIVE");
  const [formNotes, setFormNotes] = useState("");

  const openCreateModal = () => {
    setEditingCode(null);
    setFormCode("");
    setFormSalesName("");
    setFormDiscountType("percentage");
    setFormDiscountValue("10");
    setFormMaxUses("");
    setFormExpiryDate("");
    setFormStatus("ACTIVE");
    setFormNotes("");
    setError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (item: ReferralCodeRow) => {
    setEditingCode(item);
    setFormCode(item.code);
    setFormSalesName(item.sales_name);
    setFormDiscountType(item.discount_type);
    setFormDiscountValue(String(item.discount_value));
    setFormMaxUses(item.max_uses ? String(item.max_uses) : "");
    setFormExpiryDate(item.expiry_date ?? "");
    setFormStatus(item.status);
    setFormNotes(item.notes ?? "");
    setError(null);
    setIsModalOpen(true);
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const valNum = Number(formDiscountValue.replace(/[^0-9.]/g, ""));
    if (!valNum || valNum <= 0) {
      setError("Nilai diskon harus lebih besar dari 0.");
      return;
    }
    if (formDiscountType === "percentage" && valNum > 100) {
      setError("Diskon persentase tidak boleh lebih dari 100%.");
      return;
    }

    const payload: ReferralFormValues = {
      id: editingCode?.id,
      code: formCode.trim().toUpperCase(),
      salesName: formSalesName.trim(),
      discountType: formDiscountType,
      discountValue: valNum,
      maxUses: formMaxUses.trim() ? Number(formMaxUses) : null,
      expiryDate: formExpiryDate.trim() || null,
      status: formStatus,
      notes: formNotes.trim() || null,
    };

    startTransition(async () => {
      const res = await saveReferralCode(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setIsModalOpen(false);
      router.refresh();
    });
  };

  const handleToggleStatus = (item: ReferralCodeRow) => {
    const nextStatus: ReferralStatus = item.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    startTransition(async () => {
      const res = await toggleReferralCodeStatus(item.id, nextStatus);
      if (!res.ok) {
        setError(res.error);
      }
      router.refresh();
    });
  };

  const handleDelete = (item: ReferralCodeRow) => {
    if (!window.confirm(`Hapus kode referral "${item.code}"?`)) return;
    startTransition(async () => {
      const res = await deleteReferralCode(item.id);
      if (!res.ok) {
        setError(res.error);
      }
      router.refresh();
    });
  };

  // Metrics calculation
  const totalCodes = initialCodes.length;
  const activeCodes = initialCodes.filter((c) => c.status === "ACTIVE").length;
  const totalRedemptions = initialCodes.reduce((sum, c) => sum + (c.used_count || 0), 0);

  // Filtered rows
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialCodes.filter((c) => {
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.code.toLowerCase().includes(q) ||
        c.sales_name.toLowerCase().includes(q) ||
        (c.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [initialCodes, search, statusFilter]);

  return (
    <div className="space-y-6">
      {/* ── Metric Cards ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[#ececee] bg-white p-5">
          <div className="flex items-center justify-between text-[#71717a]">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Kode</span>
            <Ticket size={18} />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-[#09090b]">{totalCodes}</p>
          <p className="mt-1 text-xs text-[#71717a]">Kode terdaftar dalam sistem</p>
        </div>

        <div className="rounded-xl border border-[#ececee] bg-white p-5">
          <div className="flex items-center justify-between text-[#71717a]">
            <span className="text-xs font-semibold uppercase tracking-wider">Kode Aktif</span>
            <Tag size={18} />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-600">{activeCodes}</p>
          <p className="mt-1 text-xs text-[#71717a]">Siap digunakan oleh klien</p>
        </div>

        <div className="rounded-xl border border-[#ececee] bg-white p-5">
          <div className="flex items-center justify-between text-[#71717a]">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Penggunaan</span>
            <Users size={18} />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-[#09090b]">{totalRedemptions}</p>
          <p className="mt-1 text-xs text-[#71717a]">Kali transaksi berhasil diterapkan</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="font-semibold underline">
            Tutup
          </button>
        </div>
      )}

      {/* ── Toolbar & Filters ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(["ALL", "ACTIVE", "DISABLED", "EXPIRED"] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === st
                  ? "bg-[#18181b] text-white"
                  : "border border-[#ececee] bg-white text-[#71717a] hover:bg-[#fafafa]"
              }`}
            >
              {st === "ALL" ? "Semua Status" : st === "ACTIVE" ? "Aktif" : st === "DISABLED" ? "Nonaktif" : "Kadaluarsa"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#a1a1aa]" />
            <input
              type="text"
              placeholder="Cari kode atau nama sales…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-60 rounded-lg border border-[#ececee] bg-white pl-8 pr-3 text-xs outline-none focus:border-[#18181b]"
            />
          </div>

          <button
            onClick={openCreateModal}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-[#18181b] px-3.5 text-xs font-medium text-white hover:bg-[#27272a]"
          >
            <Plus size={14} /> Buat Kode Baru
          </button>
        </div>
      </div>

      {/* ── Referral Codes Table ─────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-[#ececee] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#ececee] bg-[#fafafa] font-semibold text-[#71717a]">
                <th className="px-4 py-3">Kode Referral</th>
                <th className="px-4 py-3">Sales / Partner</th>
                <th className="px-4 py-3">Diskon</th>
                <th className="px-4 py-3">Penggunaan</th>
                <th className="px-4 py-3">Masa Berlaku</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ececee]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#71717a]">
                    Belum ada kode referral yang sesuai filter.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-[#fafafa]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold tracking-wider text-[#09090b]">
                          {item.code}
                        </span>
                        <button
                          onClick={() => handleCopy(item.code)}
                          title="Salin kode"
                          className="rounded p-1 text-[#71717a] hover:bg-[#ececee]"
                        >
                          {copiedCode === item.code ? (
                            <Check size={12} className="text-emerald-600" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      </div>
                      {item.notes && (
                        <p className="mt-0.5 max-w-xs truncate text-[10px] text-[#a1a1aa]">{item.notes}</p>
                      )}
                    </td>

                    <td className="px-4 py-3 font-medium text-[#18181b]">{item.sales_name}</td>

                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded border border-[#ececee] bg-[#fafafa] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#18181b]">
                        {item.discount_type === "percentage" ? (
                          <>
                            <Percent size={10} className="text-[#a1a1aa]" /> {item.discount_value}%
                          </>
                        ) : (
                          formatIDR(item.discount_value)
                        )}
                      </span>
                    </td>

                    <td className="px-4 py-3 font-mono">
                      <span>{item.used_count}</span>
                      <span className="text-[#a1a1aa]"> / {item.max_uses ?? "∞"} kali</span>
                    </td>

                    <td className="px-4 py-3 text-[#71717a]">
                      {item.expiry_date ? `s/d ${item.expiry_date}` : "Tanpa batas"}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                          item.status === "ACTIVE"
                            ? "bg-emerald-50 text-emerald-700"
                            : item.status === "DISABLED"
                              ? "bg-zinc-100 text-zinc-600"
                              : "bg-red-50 text-red-700"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleToggleStatus(item)}
                          title={item.status === "ACTIVE" ? "Nonaktifkan kode" : "Aktifkan kode"}
                          disabled={pending}
                          className="rounded p-1.5 text-[#71717a] hover:bg-[#ececee]"
                        >
                          <Power size={13} className={item.status === "ACTIVE" ? "text-emerald-600" : "text-zinc-400"} />
                        </button>
                        <button
                          onClick={() => openEditModal(item)}
                          title="Edit aturan kode"
                          disabled={pending}
                          className="rounded p-1.5 text-[#71717a] hover:bg-[#ececee]"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          title="Hapus kode"
                          disabled={pending}
                          className="rounded p-1.5 text-[#71717a] hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create / Edit Modal ───────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-[#ececee] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#f4f4f5] pb-3">
              <div className="flex items-center gap-2 text-base font-semibold text-[#18181b]">
                <Ticket size={18} />
                <span>{editingCode ? "Edit Kode Referral" : "Buat Kode Referral Baru"}</span>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="rounded p-1 text-[#71717a] hover:bg-[#f4f4f5]">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#3f3f46]">
                  Kode Referral <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SUMMER2026 atau RIANSALES"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-lg border border-[#ececee] px-3 py-2 font-mono text-sm uppercase tracking-wider outline-none focus:border-[#18181b]"
                />
                <p className="mt-1 text-[11px] text-[#a1a1aa]">Huruf kapital, angka, - dan _ saja (3-32 karakter).</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#3f3f46]">
                  Nama Sales / Marketing Partner <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rian Saputra (Sales) atau Kampus X"
                  value={formSalesName}
                  onChange={(e) => setFormSalesName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#3f3f46]">Tipe Diskon</label>
                  <select
                    value={formDiscountType}
                    onChange={(e) => setFormDiscountType(e.target.value as ReferralDiscountType)}
                    className="mt-1 w-full rounded-lg border border-[#ececee] bg-white px-3 py-2 text-sm outline-none focus:border-[#18181b]"
                  >
                    <option value="percentage">Persentase (%)</option>
                    <option value="fixed">Nominal Tetap (Rp)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#3f3f46]">
                    Nilai Diskon ({formDiscountType === "percentage" ? "%" : "Rp"}) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    max={formDiscountType === "percentage" ? 100 : undefined}
                    placeholder={formDiscountType === "percentage" ? "10" : "150000"}
                    value={formDiscountValue}
                    onChange={(e) => setFormDiscountValue(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm font-mono outline-none focus:border-[#18181b]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#3f3f46]">Maksimal Penggunaan</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Kosongkan jika tanpa batas"
                    value={formMaxUses}
                    onChange={(e) => setFormMaxUses(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#3f3f46]">Tanggal Kadaluarsa</label>
                  <input
                    type="date"
                    value={formExpiryDate}
                    onChange={(e) => setFormExpiryDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
                  />
                </div>
              </div>

              {editingCode && (
                <div>
                  <label className="block text-xs font-medium text-[#3f3f46]">Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as ReferralStatus)}
                    className="mt-1 w-full rounded-lg border border-[#ececee] bg-white px-3 py-2 text-sm outline-none focus:border-[#18181b]"
                  >
                    <option value="ACTIVE">ACTIVE (Aktif)</option>
                    <option value="DISABLED">DISABLED (Nonaktif)</option>
                    <option value="EXPIRED">EXPIRED (Kadaluarsa)</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#3f3f46]">Catatan Internal (Opsional)</label>
                <textarea
                  rows={2}
                  placeholder="Catatan perjanjian komisi atau keterangan kampanye..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#ececee] px-3 py-2 text-xs outline-none focus:border-[#18181b]"
                />
              </div>

              <div className="mt-5 flex justify-end gap-2 border-t border-[#f4f4f5] pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg border border-[#ececee] px-4 py-2 text-xs font-medium text-[#71717a] hover:bg-[#f4f4f5]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="flex items-center gap-1.5 rounded-lg bg-[#18181b] px-4 py-2 text-xs font-medium text-white hover:bg-[#27272a] disabled:opacity-50"
                >
                  {pending ? <Loader2 size={13} className="animate-spin" /> : null}
                  <span>{editingCode ? "Simpan Perubahan" : "Terbitkan Kode"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
