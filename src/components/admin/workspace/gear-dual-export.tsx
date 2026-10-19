"use client";

import { useState, useTransition } from "react";
import {
  Printer, MessageCircle, Package, Truck, CheckCircle2, Clock,
  AlertTriangle, Store, User as UserIcon, ChevronDown, Copy, Check,
} from "lucide-react";
import { Card, CardInner, CardHeader, Badge } from "@/components/ui/glass";
import { EmptyState } from "@/components/ui/empty-state";
import { idr } from "@/lib/format";
import { setPackStatus, buildVendorBookingMessage, buildInternalPackingMessage } from "@/app/actions/gear-actions";
import type { WorkspacePayload, GearLine } from "@/lib/workspace";

/**
 * Gear module — the two export streams, deliberately separated.
 *
 * Stream A (packing slip) and Stream B (vendor PO) are rendered as distinct
 * panels with distinct columns, and each export button opens a DIFFERENT
 * document. They are never interleaved, because the person packing a flight
 * case does not care what a vendor charges, and the person booking a vendor
 * does not care about battery counts.
 *
 * The server enforces the same separation and returns 422 with an explanation
 * if a row from the wrong tier ever reaches the wrong document.
 */

const TIER = {
  IN_HOUSE: { label: "Studio", icon: <Store size={12} /> },
  PARTNER_OWNED: { label: "Partner", icon: <UserIcon size={12} /> },
  VENDOR_RENTAL: { label: "Vendor Rental", icon: <Truck size={12} /> },
} as const;

function CopyButton({
  onBuild,
  label,
  icon,
}: {
  onBuild: () => Promise<{ success: boolean; text?: string; phone?: string; error?: string }>;
  label: string;
  icon: React.ReactNode;
}) {
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    start(async () => {
      const res = await onBuild();
      if (!res.success || !res.text) {
        setError(res.error ?? "Gagal membuat pesan.");
        return;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(res.text);
        } else {
          // Clipboard is unavailable in insecure contexts; fall back to a
          // selection copy so the operator is never left without the text.
          const ta = document.createElement("textarea");
          ta.value = res.text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        setError("Clipboard diblokir browser. Buka dokumen lalu salin manual.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#ff5a00] px-3.5 text-xs font-semibold text-white transition-colors hover:bg-[#ff5a00]/90 disabled:opacity-60 cursor-pointer"
      >
        {copied ? <Check size={14} /> : pending ? <Clock size={14} /> : icon}
        <span>{copied ? "Tersalin!" : label}</span>
      </button>
      {error ? (
        <p className="max-w-[220px] text-right text-[10px] font-medium text-[#ff5a00]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PackToggle({
  line,
  projectId,
}: {
  line: GearLine;
  projectId: string;
}) {
  const [status, setStatus] = useState(line.pack_status);
  const [pending, start] = useTransition();
  const packed = status === "PACKED";

  const toggle = () => {
    const next = packed ? "PENDING" : "PACKED";
    setStatus(next); // optimistic
    start(async () => {
      const res = await setPackStatus(line.id, projectId, next);
      if (!res.success) setStatus(line.pack_status); // revert on failure
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={packed}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-[11px] font-semibold transition-colors cursor-pointer ${
        packed
          ? "border-[#ececee] bg-[#fafafa] text-[#09090b]"
          : "border-[#ff5a00]/30 bg-[#ff5a00]/12 text-[#ff5a00]"
      } ${pending ? "opacity-60" : ""}`}
    >
      {packed ? <CheckCircle2 size={13} /> : <Clock size={13} />}
      {packed ? "Siap" : "Tandai Siap"}
    </button>
  );
}

function StreamALine({ line, projectId }: { line: GearLine; projectId: string }) {
  const tier = TIER[line.source_type as keyof typeof TIER] ?? TIER.IN_HOUSE;
  const acc = line.accessories as {
    batteries?: number;
    charger?: boolean;
    cards?: Array<{ capacity_gb: number; qty: number }>;
  };
  const tally: string[] = [];
  if (acc.batteries) tally.push(`Baterai ×${acc.batteries}`);
  for (const c of acc.cards ?? []) tally.push(`Card ${c.capacity_gb}GB ×${c.qty}`);
  if (acc.charger) tally.push("Charger ×1");

  return (
    <div className="flex flex-col gap-2.5 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-[#52525b]">
            {tier.icon} {tier.label}
          </Badge>
          {line.asset_code ? (
            <span className="font-mono text-[10px] text-[#a1a1aa]">{line.asset_code}</span>
          ) : null}
          {line.source_type === "PARTNER_OWNED" ? (
            <span className="text-[10px] font-medium text-[#71717a]">
              milik {line.owner_name}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-xs font-semibold text-[#09090b]">{line.name}</p>
        {tally.length ? (
          <p className="mt-0.5 font-mono text-[10px] text-[#71717a]">
            {tally.join(" · ")}
          </p>
        ) : null}
      </div>
      <PackToggle line={line} projectId={projectId} />
    </div>
  );
}

export function ModuleGearDual({ data }: { data: WorkspacePayload }) {
  const [showVendorDetail, setShowVendorDetail] = useState(false);

  // Stream A = physical in-house + partner assets only.
  const streamA = data.gear.filter(
    (g) => g.asset_id && (g.source_type === "IN_HOUSE" || g.source_type === "PARTNER_OWNED"),
  );
  // Stream B = physical vendor rentals only.
  const streamB = data.gear.filter((g) => g.asset_id && g.source_type === "VENDOR_RENTAL");

  const studio = streamA.filter((g) => g.source_type === "IN_HOUSE");
  const partner = streamA.filter((g) => g.source_type === "PARTNER_OWNED");
  const unpacked = streamA.filter((g) => g.pack_status === "PENDING").length;
  const totalA = streamA.reduce((s, g) => s + g.total_cost, 0);
  const totalB = streamB.reduce((s, g) => s + g.total_cost, 0);
  const vendorNames = [...new Set(streamB.map((g) => g.vendor_name).filter(Boolean))] as string[];
  const accessoryCount = streamA.reduce((sum, g) => {
    const a = g.accessories as { batteries?: number; charger?: boolean; cards?: Array<{ qty: number }> };
    return sum + (a.batteries ?? 0) + (a.cards?.reduce((s, c) => s + (c.qty ?? 0), 0) ?? 0) + (a.charger ? 1 : 0);
  }, 0);

  return (
    <div className="space-y-5">
      {/* ── The two streams, side by side, colour-coded, never interleaved ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* ══ STREAM A ══ */}
        <Card className="border-l-4 border-l-[#ff5a00]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-mono font-bold uppercase tracking-wide text-[#ff5a00]">
                Stream A
              </p>
              <h3 className="mt-1 font-serif text-base font-bold leading-tight text-[#09090b]">
                Manifest Muat Internal
              </h3>
              <p className="mt-1 text-[11px] leading-snug text-[#71717a]">
                Checklist packing &amp; audit pengembalian. Tanpa sewa vendor.
              </p>
            </div>
            <span className="shrink-0 text-2xl">📋</span>
          </div>

          <div className="mt-3.5 grid grid-cols-3 gap-2">
            <CardInner className="p-2.5">
              <p className="text-[9px] font-mono uppercase text-[#a1a1aa]">Item</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-[#09090b]">
                {streamA.length}
              </p>
            </CardInner>
            <CardInner className="p-2.5">
              <p className="text-[9px] font-mono uppercase text-[#a1a1aa]">Aksesori</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-[#09090b]">
                {accessoryCount}
              </p>
            </CardInner>
            <CardInner className="p-2.5">
              <p className="text-[9px] font-mono uppercase text-[#a1a1aa]">Belum dicek</p>
              <p className={`mt-0.5 font-mono text-sm font-bold ${unpacked > 0 ? "text-[#ff5a00]" : "text-[#09090b]"}`}>
                {unpacked}
              </p>
            </CardInner>
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <a
              href={`/api/admin/projects/${data.project.id}/manifest-internal`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#09090b] px-3.5 text-xs font-semibold text-white transition-colors hover:bg-[#18181b]"
            >
              <Printer size={14} /> Cetak Manifest
            </a>
            <CopyButton
              onBuild={() => buildInternalPackingMessage(data.project.id)}
              label="Salin Checklist WA"
              icon={<MessageCircle size={14} />}
            />
          </div>
        </Card>

        {/* ══ STREAM B ══ */}
        <Card className="border-l-4 border-l-[#09090b]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-mono font-bold uppercase tracking-wide text-[#09090b]">
                Stream B
              </p>
              <h3 className="mt-1 font-serif text-base font-bold leading-tight text-[#09090b]">
                PO Sewa Vendor
              </h3>
              <p className="mt-1 text-[11px] leading-snug text-[#71717a]">
                Dokumen komersial: SLA ambil/kembali, tarif, deposit.
              </p>
            </div>
            <span className="shrink-0 text-2xl">🧾</span>
          </div>

          <div className="mt-3.5 grid grid-cols-3 gap-2">
            <CardInner className="p-2.5">
              <p className="text-[9px] font-mono uppercase text-[#a1a1aa]">Item</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-[#09090b]">
                {streamB.length}
              </p>
            </CardInner>
            <CardInner className="p-2.5">
              <p className="text-[9px] font-mono uppercase text-[#a1a1aa]">Vendor</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-[#09090b]">
                {vendorNames.length}
              </p>
            </CardInner>
            <CardInner className="p-2.5">
              <p className="text-[9px] font-mono uppercase text-[#a1a1aa]">Subtotal</p>
              <p className="mt-0.5 font-mono text-xs font-bold text-[#09090b]">
                {idr(totalB)}
              </p>
            </CardInner>
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {streamB.length > 0 ? (
              <>
                <a
                  href={`/api/admin/projects/${data.project.id}/vendor-po`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#09090b] px-3.5 text-xs font-semibold text-white transition-colors hover:bg-[#18181b]"
                >
                  <Printer size={14} /> Cetak PO
                </a>
                <CopyButton
                  onBuild={() => buildVendorBookingMessage(data.project.id)}
                  label="Salin Booking WA"
                  icon={<Copy size={14} />}
                />
              </>
            ) : (
              <p className="text-[11px] font-medium text-[#71717a]">
                Tidak ada sewa vendor pada proyek ini.
              </p>
            )}
          </div>
        </Card>
      </div>

      {unpacked > 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-[#ff5a00]/25 bg-[#ff5a00]/8 px-3.5 py-2.5 text-xs font-medium text-[#ff5a00]">
          <AlertTriangle size={14} /> {unpacked} alat belum ditandai siap — selesaikan sebelum load-in.
        </p>
      ) : null}

      {/* ── Stream A detail ── */}
      <Card>
        <CardHeader
          title="Checklist Packing"
          description="Aset studio & partner — hitung aksesori satu per satu"
        />
        {streamA.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<Package size={20} />}
              title="Belum ada aset internal pada proyek ini"
              description="Tambahkan peralatan studio untuk menghasilkan manifest muat."
            />
          </div>
        ) : (
          <>
            {studio.length > 0 ? (
              <div className="mt-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#a1a1aa]">
                  Kit Internal Studio ({studio.length})
                </p>
                <div className="mt-1 divide-y divide-[#ececee]">
                  {studio.map((g) => (
                    <StreamALine key={g.id} line={g} projectId={data.project.id} />
                  ))}
                </div>
              </div>
            ) : null}

            {partner.length > 0 ? (
              <div className="mt-5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#a1a1aa]">
                  Gear Pribadi Partner ({partner.length})
                </p>
                <div className="mt-1 divide-y divide-[#ececee]">
                  {partner.map((g) => (
                    <StreamALine key={g.id} line={g} projectId={data.project.id} />
                  ))}
                </div>
              </div>
            ) : null}

            <p className="mt-4 border-t border-[#ececee] pt-3 text-[11px] text-[#71717a]">
              Total nilai aset: <span className="font-mono font-semibold">{idr(totalA)}</span> — untuk
              keperluan asuransi internal, tidak tampil di dokumen klien.
            </p>
          </>
        )}
      </Card>

      {/* ── Stream B detail ── */}
      {streamB.length > 0 ? (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <CardHeader
              title="Rincian Sewa Vendor"
              description="Untuk PO komersial dan penjadwalan ambil/kembali"
            />
            <button
              type="button"
              onClick={() => setShowVendorDetail((v) => !v)}
              aria-expanded={showVendorDetail}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[#ececee] bg-white px-3 text-[11px] font-semibold text-[#3f3f46] cursor-pointer"
            >
              {showVendorDetail ? "Sembunyikan" : "Lihat rincian"}
              <ChevronDown size={13} className={showVendorDetail ? "rotate-180 transition-transform" : "transition-transform"} />
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {vendorNames.map((vendor) => {
              const lines = streamB.filter((g) => g.vendor_name === vendor);
              const subtotal = lines.reduce((s, g) => s + g.total_cost, 0);
              return (
                <CardInner key={vendor}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-[#09090b]">
                        {vendor}
                      </p>
                      {lines[0]?.vendor_phone ? (
                        <p className="font-mono text-[10px] text-[#71717a]">
                          {lines[0].vendor_phone}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 font-mono text-xs font-bold text-[#09090b]">
                      {idr(subtotal)}
                    </span>
                  </div>

                  {showVendorDetail ? (
                    <div className="mt-2.5 divide-y divide-[#ececee]">
                      {lines.map((g) => (
                        <div key={g.id} className="flex items-center justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-[11px] font-medium text-[#3f3f46]">
                              {g.name}
                            </p>
                            <p className="font-mono text-[10px] text-[#a1a1aa]">
                              {g.quantity} × {g.rental_duration_days} hari × {idr(g.unit_cost)}
                            </p>
                          </div>
                          <span className="shrink-0 font-mono text-[11px] font-semibold text-[#3f3f46]">
                            {idr(g.total_cost)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardInner>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
