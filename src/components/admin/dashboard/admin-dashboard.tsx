import type { DashboardTelemetry } from "@/lib/dashboard/types";
import { isMeasured, numericOrNull, type Metric } from "@/lib/dashboard/metric";
import { formatRupiah } from "@/lib/reminders/compose";
import { StatTile, StatTilePlaceholder } from "./stat-tile";
import { QuickActions } from "./quick-actions";
import { AttentionDrawer, ProductionTimeline } from "./production-timeline";

/**
 * Executive dashboard — Awesomic Editorial Zinc Grid.
 *
 * LAYOUT
 * ------
 * Canvas `#f4f4f5`, white surfaces, 1px hairlines, 36px radius. The grid is
 * 12 columns at 1440px and collapses to a single column (a 2×3 tile block) at
 * 390px with no horizontal overflow.
 *
 * WHAT THIS REPLACED
 * ------------------
 * The landing page was a full-bleed ranked work queue, so a quiet day looked
 * like an empty page and a bad day looked like a wall of red. Now the page
 * answers "how are we doing?" first with measured tiles, then offers "what is
 * broken?" as a collapsed drawer the operator opens deliberately.
 *
 * NUMBERS ARE NEVER INVENTED. Each tile renders a real value, an honest empty
 * state, or "—" when unmeasured. See `lib/dashboard/metric.ts`.
 */

function money(metric: Metric<number>): Metric<string> {
  return isMeasured(metric)
    ? { state: metric.state, value: formatRupiah(metric.value) }
    : metric;
}

export function AdminDashboard({ data }: { data: DashboardTelemetry }) {
  const gearOut = numericOrNull(data.gearOut);
  const gearIn = numericOrNull(data.gearInCustody);
  const gearTotal = gearOut !== null && gearIn !== null ? gearOut + gearIn : null;
  const gearRatio = gearTotal && gearTotal > 0 ? (gearOut ?? 0) / gearTotal : null;

  const unmeasuredGear = gearOut === null || gearIn === null;

  return (
    <div className="space-y-5 pb-12">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a1a1aa]">
            Studio OS
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#09090b]">
            Selamat datang, {data.displayName}
          </h1>
        </div>
        <QuickActions />
      </header>

      {/* ── Financial + operating tiles ─────────────────────────────────── */}
      <section aria-label="Ringkasan" className="grid grid-cols-2 gap-3 lg:grid-cols-12">
        {/* Cash position: FOUNDER and above only. */}
        {data.canSeeFinance ? (
          <>
            <div className="col-span-2 lg:col-span-3">
              <StatTile
                label="Pendapatan Bulan Ini"
                metric={money(data.monthlyRevenue)}
                footnote="Pembayaran terverifikasi"
                href="/admin/finance"
              />
            </div>
            <div className="col-span-2 lg:col-span-3">
              <StatTile
                label="Piutang Belum Dibayar"
                metric={money(data.unpaidReceivables)}
                footnote="Sisa tagihan seluruh invoice"
                href="/admin/finance"
                accent={
                  numericOrNull(data.unpaidReceivables) !== null &&
                  (numericOrNull(data.unpaidReceivables) ?? 0) > 0
                    ? "attention"
                    : "none"
                }
              />
            </div>
          </>
        ) : (
          <>
            {/* ADMIN (rank 80) sees contracted value, which is operational
                context rather than a cash position. */}
            <div className="col-span-2 lg:col-span-3">
              <StatTile
                label="Nilai Kontrak Aktif"
                metric={money(data.activeContractValue)}
                footnote="Proyek berjalan"
                href="/admin/projects"
              />
            </div>
            <div className="col-span-2 lg:col-span-3">
              <StatTilePlaceholder
                label="Pendapatan & Piutang"
                note="Hanya untuk Founder ke atas"
              />
            </div>
          </>
        )}

        <div className="lg:col-span-2">
          <StatTile
            label="Proyek Aktif"
            metric={data.activeProjects}
            href="/admin/projects"
          />
        </div>

        <div className="lg:col-span-2">
          <StatTile
            label="Shooting Hari Ini"
            metric={data.shootsToday}
            href="/admin/calendar"
            accent={numericOrNull(data.shootsToday) ? "attention" : "none"}
            footnote={
              isMeasured(data.nextCallTime) && data.nextCallTime.value
                ? `Call time berikutnya ${data.nextCallTime.value}`
                : "Belum ada jadwal hari ini"
            }
          />
        </div>

        <div className="lg:col-span-2">
          <StatTile
            label="Kru Bertugas"
            metric={data.crewOnDuty}
            href="/admin/users"
            unit="orang"
          />
        </div>

        <div className="lg:col-span-2 lg:col-start-1">
          <StatTile
            label="Antrean Editing"
            metric={data.pendingEditing}
            href="/admin/projects?module=proofing"
            footnote="Tugas belum selesai"
          />
        </div>

        <div className="col-span-2 lg:col-span-4">
          {unmeasuredGear ? (
            <StatTilePlaceholder
              label="Gear Keluar / Di Studio"
              note="Data logistik tidak dapat diukur"
            />
          ) : (
            <StatTile
              label="Gear Keluar / Di Studio"
              metric={{ state: "ok", value: `${gearOut} / ${gearIn}` }}
              footnote="Packing, loading, dan pengembalian"
              href="/admin/inventory"
              ratio={gearRatio}
              ratioLabel={
                gearRatio === null
                  ? "Belum ada gear tercatat"
                  : `${Math.round(gearRatio * 100)}% sedang di luar`
              }
            />
          )}
        </div>

        <div className="col-span-2 lg:col-span-8">
          <ProductionTimeline timeline={data.timeline} />
        </div>

        <div className="col-span-2 lg:col-span-4">
          <AttentionDrawer queue={data.attention} />
        </div>
      </section>
    </div>
  );
}
