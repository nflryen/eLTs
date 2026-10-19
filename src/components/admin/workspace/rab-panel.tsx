"use client";

import { use, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Calculator, CheckCircle2, Clock, Coins, Lock,
  RotateCcw, ShieldCheck, TrendingUp, Users, Wallet, XCircle,
} from "lucide-react";
import { CardHeader, DarkPanel } from "@/components/ui/glass";
import { idr } from "@/lib/format";
import {
  approveSplit,
  createOrUpdateSplit,
  getProjectSplit,
  rejectSplit,
} from "@/app/actions/treasury-splits";
import type { MoneySplitRow } from "@/lib/finance/waterfall";
import type { WorkspacePayload } from "@/lib/workspace";

/**
 * RAB — the studio-private cost sheet and founder waterfall.
 *
 * TWO THINGS THIS SCREEN EXISTS TO GET RIGHT
 * ------------------------------------------
 * 1. The cost sheet is public-safe by construction. It is rendered inside a
 *    DarkPanel — the surface change is the visual cue that this is the one
 *    module that must never reach a client document — and every figure is
 *    derived from studio-side rows only.
 *
 * 2. Costs are split into the two buckets that actually behave differently:
 *    cash outflows (money that leaves the studio) and non-cash depreciation
 *    (gear you already own; an accounting entry, not a payment). Collapsing
 *    them hides the fact that a profitable-looking shoot may be cash-negative.
 *
 * Crew honor counts ACCEPTED assignments only. A PENDING offer is not a cost —
 * it must never inflate the sheet, or the margin reads lower than it is and the
 * founders argue over a number that is not real yet.
 */

const RESERVE_PCT = 5;

/**
 * The spec's bucket rule: a gear line is a CASH OUTFLOW unless it is an
 * in-house depreciation entry (gear the studio already owns — an accounting
 * entry, not a payment). The complement is the non-cash depreciation bucket,
 * so the two together are exhaustive and never double-count.
 */
function isCashOutflow(sourceType: string, category: string): boolean {
  return sourceType !== "IN_HOUSE" || category !== "EQUIPMENT_DEPRECIATION";
}

/**
 * Dark-surface status chips. The palette permits only zinc-family hexes and the
 * single Ember accent (#ff5a00) — so "approved" reads as Ember (the one
 * high-priority signal), "pending" as a quieter Ember outline, and "rejected"
 * as a filled neutral. No emerald/amber/rose.
 */
const CHIP_APPROVED = "border-[#ff5a00]/50 bg-[#ff5a00]/20 text-white";
const CHIP_PENDING = "border-[#ff5a00]/40 bg-[#ff5a00]/10 text-[#ff5a00]";
const CHIP_REJECTED = "border-white/15 bg-white/10 text-[#a1a1aa]";

function statusChip(status: MoneySplitRow["status"]): { label: string; className: string } {
  switch (status) {
    case "APPROVED":
      return { label: "Approved", className: CHIP_APPROVED };
    case "PENDING_APPROVAL":
      return { label: "Menunggu Approval", className: CHIP_PENDING };
    case "REJECTED":
      return { label: "Ditolak", className: CHIP_REJECTED };
    default:
      return { label: "Draft", className: "border-white/20 bg-white/5 text-[#a1a1aa]" };
  }
}

export function RabPanel({ data }: { data: WorkspacePayload }) {
  const router = useRouter();
  /*
   * The workspace payload is cost-side only, so the persisted split row is
   * fetched on demand. We hold the *promise* in state and unwrap it with
   * React 19's `use()`. That keeps the fetch out of an effect (no
   * setState-in-useEffect cascading render) and out of render-time
   * `useMemo(() => fetch())`, which would re-issue a request on every render —
   * `useState` guarantees exactly one request per `reloadToken` bump.
   */
  const [busy, setBusy] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [reloadToken, setReloadToken] = useState(0);

  const projectId = data.project.id;
  const contract = data.project.contract_value;

  /*
   * Keyed-reset idiom: when `reloadToken` advances, set state *during* render
   * (React then re-runs this component before committing) so the next `use()`
   * unwraps a fresh request. Never mutate the stored object — the setter is the
   * only sanctioned write.
   */
  const [splitRequest, setSplitRequest] = useState(() => ({
    token: 0,
    promise: getProjectSplit(projectId),
  }));
  if (splitRequest.token !== reloadToken) {
    setSplitRequest({ token: reloadToken, promise: getProjectSplit(projectId) });
  }

  const splitRes = use(splitRequest.promise);

  const split: MoneySplitRow | null = splitRes.success ? splitRes.split : null;
  // `use()` suspends above, so by the time we render here the fetch has settled.
  const loaded = true;
  const loadError = splitRes.success
    ? null
    : (splitRes.error ?? "Gagal memuat data waterfall.");

  // ── Cost architecture ─────────────────────────────────────────────────────
  const costs = useMemo(() => {
    let cashGear = 0;
    let nonCash = 0;
    for (const g of data.gear) {
      if (isCashOutflow(g.source_type, g.category)) cashGear += g.total_cost;
      else nonCash += g.total_cost;
    }
    // Only confirmed crew is a cost. PENDING offers never enter the sheet.
    const crewCost = data.crew
      .filter((c) => c.acceptance_status === "ACCEPTED")
      .reduce((sum, c) => sum + c.fee_agreed, 0);

    const pendingCrew = data.crew.filter((c) => c.acceptance_status !== "ACCEPTED").length;
    const cashTotal = cashGear + crewCost;
    const direct = cashTotal + nonCash;
    /*
     * With no agreed contract value there is no margin to compute. Reporting a
     * -100% margin (revenue 0 minus costs) would look like a catastrophic
     * project rather than an unpriced one, so profit and margin stay null and
     * the UI says the price is missing.
     */
    const grossProfit = contract === null ? null : contract - direct;
    const marginPct =
      contract === null || contract <= 0 || grossProfit === null
        ? null
        : (grossProfit / contract) * 100;
    return { cashGear, crewCost, cashTotal, nonCash, direct, grossProfit, marginPct, pendingCrew };
  }, [data.gear, data.crew, contract]);

  const marginBelowFloor = costs.marginPct !== null && costs.marginPct < 50;

  const founderA = split?.founder_a_share ?? 0;
  const founderB = split?.founder_b_share ?? 0;
  const reserve = split?.reserve_amount ?? 0;

  const mutate = (key: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(key);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.success) {
        setMutationError(res.error ?? "Aksi gagal.");
        return;
      }
      setMutationError(null);
      // Re-issue the split fetch; the render above unwraps the new promise.
      setReloadToken((n) => n + 1);
      router.refresh();
    });
  };

  /*
   * A money split is a persisted, founder-approved record. It may only be
   * computed from a price the studio actually agreed, so this refuses rather
   * than posting a placeholder. The server schema allows 0, so the guard has to
   * live here.
   */
  const canComputeSplit = contract !== null && contract > 0;

  const handleCompute = () => {
    if (!canComputeSplit) {
      setMutationError(
        "Nilai kontrak proyek belum diisi. Isi harga yang disepakati sebelum menghitung bagi hasil.",
      );
      return;
    }
    mutate("compute", () =>
      createOrUpdateSplit({
        projectId,
        grossRevenue: contract,
        directCosts: costs.direct,
        reservePct: RESERVE_PCT,
      }),
    );
  };

  const handleApprove = (founder: "A" | "B") => {
    if (!split) return;
    mutate(`approve-${founder}`, () => approveSplit(split.id, founder, projectId));
  };

  const handleReject = () => {
    if (!split) return;
    mutate("reject", () => rejectSplit(split.id, projectId, "Ditolak dari RAB Internal."));
  };

  const chip = split ? statusChip(split.status) : null;
  const fullyApproved = split?.status === "APPROVED";

  return (
    <DarkPanel className="space-y-6">
      {/* ── Privacy boundary ─────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 rounded-[12px] border border-[#ff5a00]/40 bg-[#ff5a00]/10 px-3.5 py-2.5">
        <Lock size={14} className="mt-0.5 shrink-0 text-[#ff5a00]" />
        <p className="text-[11px] font-semibold leading-snug text-white">
          🔒 HANYA UNTUK INTERNAL STUDIO — tidak pernah tampil di dokumen klien.
        </p>
      </div>

      <CardHeader
        tone="dark"
        title="RAB Internal"
        description="Struktur biaya studio & waterfall pembagian founder"
        action={chip ? <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${chip.className}`}>{chip.label}</span> : null}
      />

      {/* ── Cost architecture: two buckets, one hairline between them ────── */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#a1a1aa]">
          Struktur Biaya
        </h3>
        <div className="mt-3 divide-y divide-white/10">
          <CostRow
            label="Honor Kru (terkonfirmasi)"
            hint={costs.pendingCrew > 0 ? `${costs.pendingCrew} tawaran belum konfirmasi — tidak dihitung` : `${data.crew.length} kru terkonfirmasi`}
            value={idr(costs.crewCost)}
            icon={<Users size={13} />}
          />
          <CostRow
            label="Kas Keluar — Sewa & Logistik"
            hint="Buckets yang benar-benar meninggalkan kas studio"
            value={idr(costs.cashGear)}
            icon={<Wallet size={13} />}
          />
          <CostRow
            label="Penyusutan Non-Kas"
            hint="Gear milik sendiri — entri akuntansi, bukan pembayaran"
            value={idr(costs.nonCash)}
            icon={<RotateCcw size={13} />}
          />
        </div>

        <div className="mt-3 flex items-center justify-between rounded-[12px] bg-white/5 px-3.5 py-2.5">
          <span className="text-xs font-semibold text-white">Total Biaya Langsung</span>
          <span className="font-mono text-sm font-bold text-white tabular-nums">{idr(costs.direct)}</span>
        </div>
      </section>

      {/* ── Margin block ─────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#a1a1aa]">Margin</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Metric label="Direct Cost" value={idr(costs.direct)} />
          <Metric
            label="Gross Profit"
            value={costs.grossProfit === null ? "—" : idr(costs.grossProfit)}
            tone={costs.grossProfit !== null && costs.grossProfit < 0 ? "ember" : "default"}
          />
          <Metric
            label="Margin %"
            value={costs.marginPct === null ? "—" : `${costs.marginPct.toFixed(1)}%`}
            tone={marginBelowFloor ? "ember" : "default"}
          />
        </div>
        {costs.marginPct === null ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-[#71717a]">
            <AlertTriangle size={12} /> Nilai kontrak belum diisi — margin tidak dapat dihitung.
          </p>
        ) : null}
        {marginBelowFloor ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-[#ff5a00]">
            <AlertTriangle size={12} /> Margin di bawah 50% — tinjau ulang harga atau biaya sebelum roll.
          </p>
        ) : null}
      </section>

      {/* ── Waterfall split ──────────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#a1a1aa]">
            Waterfall Split
          </h3>
          {split ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCompute}
                disabled={isPending}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-[12px] border border-white/20 px-3 text-[11px] font-semibold text-[#d4d4d8] transition-colors hover:bg-white/10 disabled:opacity-60"
              >
                <Calculator size={13} /> Hitung Ulang
              </button>
              {!fullyApproved ? (
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={isPending}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-[12px] border border-white/15 px-3 text-[11px] font-semibold text-[#a1a1aa] transition-colors hover:bg-white/10 disabled:opacity-60"
                >
                  <XCircle size={13} /> Tolak
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {!loaded ? (
          <p className="mt-4 text-xs text-[#a1a1aa]">Memuat data waterfall…</p>
        ) : !split ? (
          <div className="mt-4 rounded-[12px] border border-dashed border-white/20 p-5 text-center">
            <Coins size={20} className="mx-auto text-[#a1a1aa]" />
            <p className="mt-2 text-sm font-semibold text-white">Waterfall belum dihitung</p>
            <p className="mt-1 text-[11px] text-[#a1a1aa]">
              Bagi laba bersih: reserve {RESERVE_PCT}%, lalu founder A 40% · founder B 35% dari sisa.
            </p>
            <button
              type="button"
              onClick={handleCompute}
              disabled={isPending}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[12px] bg-[#ff5a00] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#ff6d1f] disabled:opacity-60"
            >
              {busy === "compute" ? <Clock size={15} /> : <Calculator size={15} />}
              [Hitung Waterfall]
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <FounderCard
                title="Founder A"
                subtitle="Ray"
                amount={founderA}
                approved={split.approved_by_a}
                canAct={!split.approved_by_a && split.status !== "REJECTED"}
                busy={busy === "approve-A"}
                disabled={isPending}
                onApprove={() => handleApprove("A")}
              />
              <FounderCard
                title="Founder B"
                subtitle="Partner"
                amount={founderB}
                approved={split.approved_by_b}
                canAct={!split.approved_by_b && split.status !== "REJECTED"}
                busy={busy === "approve-B"}
                disabled={isPending}
                onApprove={() => handleApprove("B")}
              />
              <PoolCard reserve={reserve} reservePct={split.reserve_pct} netProfit={split.net_profit} fullyApproved={fullyApproved} />
            </div>

            {fullyApproved ? (
              <p className="mt-3 flex items-center gap-2 rounded-[12px] border border-[#ff5a00]/50 bg-[#ff5a00]/20 px-3.5 py-2.5 text-[11px] font-semibold text-white">
                <ShieldCheck size={14} /> Split terkonfirmasi penuh — reserve {idr(reserve)} tercatat masuk ke kas bersama.
              </p>
            ) : (
              <p className="mt-3 flex items-center gap-2 rounded-[12px] border border-[#ff5a00]/40 bg-[#ff5a00]/10 px-3.5 py-2.5 text-[11px] font-medium text-[#ff5a00]">
                <Clock size={14} /> Menunggu approval kedua founder. Reserve baru masuk kas saat keduanya setuju.
              </p>
            )}
          </>
        )}

        {mutationError ?? loadError ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-[#ff5a00]">
            <AlertTriangle size={12} /> {mutationError ?? loadError}
          </p>
        ) : null}
      </section>
    </DarkPanel>
  );
}

/** A single bucket line in the cost sheet. */
function CostRow({
  label,
  hint,
  value,
  icon,
}: {
  label: string;
  hint: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 text-[#a1a1aa]">{icon}</span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white">{label}</p>
          <p className="mt-0.5 text-[10px] leading-snug text-[#a1a1aa]">{hint}</p>
        </div>
      </div>
      <span className="shrink-0 font-mono text-xs font-bold text-white tabular-nums">{value}</span>
    </div>
  );
}

/** Label/value tile. `ember` marks the figure that needs attention. */
function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ember";
}) {
  return (
    <div className="rounded-[12px] bg-white/5 p-3.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[#a1a1aa]">{label}</p>
      <p
        className="mt-1.5 font-mono text-lg font-bold tabular-nums"
        style={{ color: tone === "ember" ? "#ff5a00" : "#ffffff" }}
      >
        {value}
      </p>
    </div>
  );
}

/** Founder share card with its own dual-approval action. */
function FounderCard({
  title,
  subtitle,
  amount,
  approved,
  canAct,
  busy,
  disabled,
  onApprove,
}: {
  title: string;
  subtitle: string;
  amount: number;
  approved: boolean;
  canAct: boolean;
  busy: boolean;
  disabled: boolean;
  onApprove: () => void;
}) {
  return (
    <div className="flex flex-col rounded-[12px] bg-white/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white">{title}</p>
          <p className="text-[10px] text-[#a1a1aa]">{subtitle}</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${
            approved
              ? CHIP_APPROVED
              : "border-white/20 bg-white/5 text-[#a1a1aa]"
          }`}
        >
          {approved ? <CheckCircle2 size={11} /> : <Clock size={11} />}
          {approved ? "Approved" : "Pending"}
        </span>
      </div>

      <p className="mt-3 font-mono text-lg font-bold text-white tabular-nums">{idr(amount)}</p>

      <div className="mt-3">
        {approved || !canAct ? (
          <span className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[12px] border border-[#ff5a00]/50 bg-[#ff5a00]/20 text-[11px] font-semibold text-white">
            <CheckCircle2 size={13} /> Disetujui
          </span>
        ) : (
          <button
            type="button"
            onClick={onApprove}
            disabled={disabled}
            className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[12px] bg-[#ff5a00] text-[11px] font-semibold text-white transition-colors hover:bg-[#ff6d1f] disabled:opacity-60"
          >
            {busy ? <Clock size={13} /> : <TrendingUp size={13} />} Setujui
          </button>
        )}
      </div>
    </div>
  );
}

/** The shared studio reserve — no per-founder approval, confirmed on full sign-off. */
function PoolCard({
  reserve,
  reservePct,
  netProfit,
  fullyApproved,
}: {
  reserve: number;
  reservePct: number;
  netProfit: number;
  fullyApproved: boolean;
}) {
  return (
    <div className="flex flex-col rounded-[12px] border border-[#ff5a00]/30 bg-[#ff5a00]/10 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white">Kas Bersama</p>
          <p className="text-[10px] text-[#a1a1aa]">Reserve studio {reservePct}%</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${
            fullyApproved
              ? CHIP_APPROVED
              : "border-white/20 bg-white/5 text-[#a1a1aa]"
          }`}
        >
          {fullyApproved ? <CheckCircle2 size={11} /> : <Clock size={11} />}
          {fullyApproved ? "Masuk Kas" : "Tertahan"}
        </span>
      </div>

      <p className="mt-3 font-mono text-lg font-bold text-white tabular-nums">{idr(reserve)}</p>

      <div className="mt-3">
        <span className="inline-flex min-h-9 w-full items-center justify-center rounded-[12px] border border-white/15 bg-white/5 text-[11px] font-medium text-[#a1a1aa]">
          Net profit {idr(netProfit)}
        </span>
      </div>
    </div>
  );
}
