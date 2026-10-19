"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { OperationalSpine } from "./operational-spine";
import { SectorEngine } from "./sector-engine";
import {
  ModuleCallSheet, ModuleCrew,
  ModuleInvoice, ModuleRab, ModuleMedia, ModuleProofing,
} from "./modules";
import { ModuleGearDual } from "./gear-dual-export";
import { ProjectActionBar } from "./project-action-bar";
import type { ProjectStatus } from "@/lib/projects/lifecycle";
import {
  resolvePillarConfig,
  visibleModules,
  excludedModules,
  type FeatureId,
} from "@/lib/workspace/pillar-config";
import {
  WORKSPACE_MODULES, WORKSPACE_MODULE_LABEL, type WorkspaceModule,
} from "@/lib/workspace-contract";
import type { WorkspacePayload } from "@/lib/workspace";

/**
 * Project Console — Dual-Pane Inspector.
 *
 * WHY THIS SHAPE
 * --------------
 * The previous workspace used five peer tabs driven by `?tab=`. Two problems:
 *
 *  1. Tapping a tab triggered a full RSC refetch, because the tab lived in the
 *     URL. Module switching felt sluggish.
 *  2. Tapping "Crew" hid the countdown, the venue, and the key contacts — the
 *     three facts a field lead needs at 06:00 on shoot day.
 *
 * Here the left pane (Operational Spine) is sticky and always present, and the
 * right pane swaps modules from local state. One data load per open; module
 * switching is instant.
 *
 * It collapses gracefully: below `lg` the spine becomes the page header, so the
 * same component serves desktop command-centre use and one-handed field use.
 */

const MODULE_LABEL = WORKSPACE_MODULE_LABEL;

const VALID: WorkspaceModule[] = [
  "callsheet", "sector", "crew", "gear", "invoice", "rab", "media", "proofing",
];

/**
 * Minimum rank required to see a Money-surface module in the console.
 *
 *   invoice  80  ADMIN+  operational invoicing; WORKER has no client money view.
 *   rab      80  ADMIN+  read-only cost breakdown. Settlement stays FOUNDER —
 *                the RAB panel's write actions call `requireFounder()`.
 *
 * This is a *visibility* rule layered on top of the pillar config. It is not the
 * authorisation boundary: `loadWorkspace` decides which columns exist in the
 * payload at all, so a WORKER never receives the money fields regardless of
 * what this component chooses to render.
 */
const MODULE_MIN_RANK: Partial<Record<WorkspaceModule, number>> = {
  invoice: 80,
  rab: 80,
};

export function ProjectConsole({
  data,
  rank,
}: {
  data: WorkspacePayload;
  rank: number;
}) {
  const searchParams = useSearchParams();

  /*
   * PILLAR-AWARE MODULES
   * --------------------
   * Not every pillar needs every panel: a live broadcast has no client photo
   * proofing, and a graduation session has no minute-by-minute rundown. The
   * decision lives in one declarative table (`pillar-config`), never in `if`
   * statements scattered through the JSX.
   */
  const pillar = resolvePillarConfig(data.project.service_pillar);
  const [forceEnabled, setForceEnabled] = useState<FeatureId[]>([]);
  /*
   * Pillar eligibility AND capability eligibility. Filtering here means a
   * deep link (`?module=rab`) also resolves away from a module the role cannot
   * open, because `effectiveActive` below falls back to `allowedModules[0]`.
   */
  const allowedModules = visibleModules(pillar.config, forceEnabled).filter(
    (id) => rank >= (MODULE_MIN_RANK[id] ?? 0),
  );
  const hiddenModules = excludedModules(pillar.config, forceEnabled);

  // Initial module can arrive via ?module= or legacy ?tab= so an attention-queue deep link lands
  // on the right pane — but after that, switching is local state (no refetch).
  const rawParam = searchParams.get("module") || searchParams.get("tab");
  const initial: WorkspaceModule =
    rawParam === "rab" ? "rab"
    : rawParam === "invoice" ? "invoice"
    : rawParam === "crew" ? "crew"
    : rawParam === "gear" ? "gear"
    : rawParam === "specs" ? "sector"
    : rawParam === "overview" ? "callsheet"
    : rawParam && VALID.includes(rawParam as WorkspaceModule) ? (rawParam as WorkspaceModule)
    : "callsheet";

  const [active, setActive] = useState<WorkspaceModule>(initial);

  /*
   * A deep link may point at a module this pillar excludes
   * (`?module=proofing` on a broadcast). Render the first allowed module instead
   * of an empty pane, so a stale bookmark never looks like a broken page.
   */
  const effectiveActive: WorkspaceModule = allowedModules.includes(active)
    ? active
    : (allowedModules[0] ?? "callsheet");
  const select = (m: WorkspaceModule) => {
    setActive(m);
    // Keep the URL shareable without triggering a navigation.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("module", m);
      window.history.replaceState(null, "", url.toString());
    }
  };

  return (
    <div className="pb-12">
      {/*
       * UNIFIED COMMAND BAR
       * -------------------
       * Breadcrumb, identity, pillar, status and the primary CTA previously
       * lived in three different places (rail, module header, floating card).
       * One bar gives a single anchor: where am I, what is this, what next.
       */}
      <header className="mb-4 rounded-[18px] border border-[#ececee] bg-white px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Link
              href="/admin/projects"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#71717a] transition-colors hover:text-[#09090b]"
            >
              <ArrowLeft size={12} aria-hidden="true" /> Semua Proyek
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-[#09090b]">
                {data.project.name}
              </h1>
              <span className="shrink-0 rounded-full border border-[#ececee] bg-[#fafafa] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#52525b]">
                {pillar.config.tag}
              </span>
            </div>
            {data.customer ? (
              <p className="mt-0.5 truncate text-xs text-[#71717a]">{data.customer.name}</p>
            ) : null}
          </div>

          <div className="shrink-0">
            <ProjectActionBar
              projectId={data.project.id}
              initialStatus={(data.project.status as ProjectStatus) ?? "draft"}
            />
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
        <OperationalSpine data={data} />

        <section className="min-w-0 flex-1" aria-label={MODULE_LABEL[effectiveActive]}>
          <div className="mb-4 flex items-center gap-2">
          <div className="flex flex-1 gap-2 overflow-x-auto pb-1 no-scrollbar" role="tablist" aria-label={`Modul ${pillar.config.label}`}>
            {WORKSPACE_MODULES.filter((m) => allowedModules.includes(m.id)).map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={effectiveActive === m.id}
                onClick={() => select(m.id)}
                className={`min-h-11 shrink-0 rounded-[10000px] px-4 text-xs font-semibold transition-colors ${
                  effectiveActive === m.id
                    ? "bg-[#09090b] text-white"
                    : "border border-[#ececee] bg-white text-[#3f3f46]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/*
           * Hidden modules are removed from the strip for zero clutter, but not
           * silently: this disclosure names each one and why, and lets an admin
           * force-enable it for a hybrid shoot.
           */}
          {hiddenModules.length > 0 ? (
            <ModuleOverflowMenu
              hidden={hiddenModules}
              labels={MODULE_LABEL}
              onEnable={(id) => {
                setForceEnabled((prev) => [...prev, id]);
                select(id);
              }}
            />
          ) : null}
          </div>

        {/* Module identity only — the action bar lives in the command bar so the
            primary CTA does not move when the operator switches modules. */}
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-[#09090b]">
            {MODULE_LABEL[effectiveActive]}
          </h2>
        </div>

        {effectiveActive === "callsheet" ? <ModuleCallSheet data={data} /> : null}
        {effectiveActive === "sector" ? <SectorEngine data={data} /> : null}
        {effectiveActive === "crew" ? <ModuleCrew data={data} /> : null}
        {effectiveActive === "gear" ? <ModuleGearDual data={data} /> : null}
        {effectiveActive === "invoice" ? <ModuleInvoice data={data} /> : null}
        {effectiveActive === "rab" ? <ModuleRab data={data} /> : null}
        {effectiveActive === "media" ? <ModuleMedia data={data} /> : null}
        {effectiveActive === "proofing" ? <ModuleProofing data={data} /> : null}
        </section>
      </div>
    </div>
  );
}

/**
 * Overflow disclosure for modules this pillar excludes.
 *
 * Hidden tabs keep the daily strip uncluttered, but an operator must be able to
 * find out WHY a module is absent and, for a genuinely hybrid shoot, turn it
 * back on. The list is short, so a popover is enough — no full drawer.
 */
function ModuleOverflowMenu({
  hidden,
  labels,
  onEnable,
}: {
  hidden: Array<{ id: FeatureId; reason: string }>;
  labels: Record<string, string>;
  onEnable: (id: FeatureId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex min-h-11 items-center gap-1 rounded-[10000px] border border-dashed border-[#d4d4d8] px-3 text-[11px] font-semibold text-[#71717a] hover:bg-[#fafafa]"
      >
        + Modul Lainnya
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Modul yang disembunyikan untuk pilar ini"
          className="absolute right-0 top-full z-30 mt-2 w-80 rounded-[18px] border border-[#ececee] bg-white p-3 shadow-[0_16px_40px_-24px_rgba(9,9,11,0.35)]"
        >
          <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a1a1aa]">
            Tidak dipakai pada pilar ini
          </p>
          <ul className="space-y-2">
            {hidden.map((item) => (
              <li key={item.id} className="rounded-[12px] bg-[#fafafa] p-3">
                <p className="text-xs font-semibold text-[#18181b]">{labels[item.id] ?? item.id}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-[#71717a]">{item.reason}</p>
                <button
                  type="button"
                  onClick={() => {
                    onEnable(item.id);
                    setOpen(false);
                  }}
                  className="mt-2 inline-flex min-h-9 items-center rounded-[8px] border border-[#ececee] bg-white px-2.5 text-[11px] font-semibold text-[#18181b] hover:bg-[#f4f4f5]"
                >
                  Aktifkan untuk proyek ini
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
