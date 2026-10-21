"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageCircle,
  Package,
  Phone,
  Search,
  Trash2,
} from "lucide-react";
import {
  convertLeadToBooking,
  deleteLead,
  updateLeadNotes,
  updateLeadStatus,
  type LeadRow,
} from "@/app/actions/admin-leads";
import {
  LEAD_STATUS_LABEL,
  LEAD_STATUS_ORDER,
  buildLeadWhatsAppLink,
} from "@/lib/leads/whatsapp";
import type { InquiryStatus } from "@/types/database";

/*
 * Status colours are intentionally muted: this is an operations queue, not a
 * dashboard. Only CONVERTED reads as "done" (green) and LOST as terminal (grey);
 * everything in flight stays neutral so the eye lands on the lead name first.
 */
const STATUS_STYLE: Record<InquiryStatus, string> = {
  NEW: "bg-[#18181b] text-white",
  CONTACTED: "bg-amber-100 text-amber-900",
  SCHEDULED: "bg-blue-100 text-blue-900",
  CONVERTED: "bg-emerald-100 text-emerald-900",
  LOST: "bg-[#f4f4f5] text-[#71717a]",
  QUOTED: "bg-violet-100 text-violet-900",
  ARCHIVED: "bg-[#f4f4f5] text-[#71717a]",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function idr(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

export function LeadPipeline({
  leads,
  counts,
}: {
  leads: LeadRow[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<InquiryStatus | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((lead) => {
      if (filter !== "ALL" && lead.status !== filter) return false;
      if (!q) return true;
      return (
        lead.name.toLowerCase().includes(q) ||
        (lead.reference ?? "").toLowerCase().includes(q) ||
        (lead.phone ?? "").toLowerCase().includes(q) ||
        (lead.email ?? "").toLowerCase().includes(q) ||
        (lead.event_type ?? "").toLowerCase().includes(q)
      );
    });
  }, [leads, filter, query]);

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Terjadi kesalahan.");
      setPendingId(null);
      router.refresh();
    });
  }

  const total = leads.length;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter("ALL")}
          className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
            filter === "ALL"
              ? "bg-[#18181b] text-white"
              : "bg-[#f4f4f5] text-[#52525b] hover:bg-[#ececee]"
          }`}
        >
          Semua ({total})
        </button>
        {LEAD_STATUS_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
              filter === s
                ? "bg-[#18181b] text-white"
                : "bg-[#f4f4f5] text-[#52525b] hover:bg-[#ececee]"
            }`}
          >
            {LEAD_STATUS_LABEL[s]} ({counts[s] ?? 0})
          </button>
        ))}

        <div className="relative ml-auto">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#a1a1aa]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama, ref, telepon…"
            className="w-56 rounded-lg border border-[#ececee] py-1.5 pl-8 pr-2 text-[12px] outline-none focus:border-[#18181b]"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#e4e4e7] bg-[#fafafa] px-6 py-16 text-center">
          <p className="text-sm font-medium text-[#3f3f46]">
            {total === 0 ? "Belum ada lead masuk" : "Tidak ada lead yang cocok"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] text-[#a1a1aa]">
            {total === 0
              ? "Permintaan konsultasi dari halaman /contact dan /pricelist akan muncul di sini secara otomatis."
              : "Coba ubah filter status atau kata kunci pencarian."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((lead) => {
            const busy = pendingId === lead.id;
            const addons = lead.selected_addons ?? [];
            const waLink = buildLeadWhatsAppLink(
              {
                name: lead.name,
                phone: lead.phone,
                reference: lead.reference,
                eventType: lead.event_type,
                eventDate: lead.event_date,
                packageName: lead.package_name,
              },
              "studio",
            );

            return (
              <li
                key={lead.id}
                className="rounded-xl border border-[#ececee] bg-white p-4 transition-colors hover:border-[#d4d4d8]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-[#18181b]">{lead.name}</h3>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          STATUS_STYLE[lead.status] ?? STATUS_STYLE.NEW
                        }`}
                      >
                        {LEAD_STATUS_LABEL[lead.status] ?? lead.status}
                      </span>
                      {lead.reference && (
                        <span className="font-mono text-[11px] text-[#a1a1aa]">
                          {lead.reference}
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#71717a]">
                      <a
                        href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-[#18181b]"
                      >
                        <Phone size={11} /> {lead.phone}
                      </a>
                      {lead.email && <span>{lead.email}</span>}
                      {lead.event_type && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays size={11} /> {lead.event_type}
                          {lead.event_date ? ` · ${formatDate(lead.event_date)}` : ""}
                        </span>
                      )}
                      <span className="text-[#a1a1aa]">masuk {formatDate(lead.created_at)}</span>
                    </div>
                  </div>

                  <select
                    value={lead.status}
                    disabled={busy}
                    onChange={(e) =>
                      run(lead.id, () =>
                        updateLeadStatus(lead.id, e.target.value as InquiryStatus),
                      )
                    }
                    className="rounded-lg border border-[#ececee] px-2 py-1 text-[12px] outline-none focus:border-[#18181b] disabled:opacity-50"
                    aria-label={`Status untuk ${lead.name}`}
                  >
                    {LEAD_STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {LEAD_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* What they asked about */}
                {(lead.package_name || addons.length > 0) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[#fafafa] px-3 py-2 text-[12px]">
                    <Package size={12} className="text-[#a1a1aa]" />
                    {lead.package_name ? (
                      <span className="font-medium text-[#3f3f46]">
                        {lead.package_name}
                        {lead.package_price_idr != null && (
                          <span className="ml-1.5 font-normal text-[#71717a]">
                            · {idr(lead.package_price_idr)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[#a1a1aa]">Tanpa paket spesifik</span>
                    )}
                    {addons.length > 0 && (
                      <span className="text-[#71717a]">
                        + {addons.map((a) => a.name).join(", ")}
                      </span>
                    )}
                    {lead.estimate_total_idr != null && (
                      <span className="ml-auto font-medium tabular-nums text-[#18181b]">
                        Estimasi {idr(lead.estimate_total_idr)}
                      </span>
                    )}
                  </div>
                )}

                <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-[#3f3f46]">
                  {lead.message}
                </p>

                {/* Actions */}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#f4f4f5] pt-3">
                  <a
                    href={waLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
                  >
                    <MessageCircle size={13} /> Chat on WhatsApp
                  </a>

                  {lead.converted_project_id ? (
                    <Link
                      href={`/admin/projects/${lead.converted_project_id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#ececee] px-3 py-1.5 text-[12px] font-medium text-[#3f3f46] hover:bg-[#fafafa]"
                    >
                      <ExternalLink size={13} /> Buka Proyek
                    </Link>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => run(lead.id, () => convertLeadToBooking(lead.id))}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#ececee] px-3 py-1.5 text-[12px] font-medium text-[#3f3f46] hover:bg-[#fafafa] disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={13} />
                      )}
                      Convert to Booking
                    </button>
                  )}

                  <button
                    disabled={busy}
                    onClick={() => {
                      const note = window.prompt("Catatan internal untuk lead ini:", lead.notes ?? "");
                      if (note === null) return;
                      run(lead.id, () => updateLeadNotes(lead.id, note));
                    }}
                    className="rounded-lg border border-[#ececee] px-3 py-1.5 text-[12px] font-medium text-[#3f3f46] hover:bg-[#fafafa] disabled:opacity-50"
                  >
                    Catatan
                  </button>

                  <button
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Hapus lead dari ${lead.name}? Tindakan ini permanen.`))
                        return;
                      run(lead.id, () => deleteLead(lead.id));
                    }}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-[#a1a1aa] hover:text-red-600 disabled:opacity-50"
                    aria-label={`Hapus lead ${lead.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {lead.notes && (
                  <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                    <span className="font-medium">Catatan:</span> {lead.notes}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
