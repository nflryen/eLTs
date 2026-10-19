"use client";

import { useState } from "react";
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

export function ProjectConsole({ data }: { data: WorkspacePayload }) {
  const searchParams = useSearchParams();

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
    <div className="flex flex-col gap-5 pb-12 lg:flex-row lg:items-start lg:gap-6">
      <OperationalSpine data={data} activeModule={active} onSelectModule={select} />

      <section className="min-w-0 flex-1" aria-label={MODULE_LABEL[active]}>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 no-scrollbar" role="tablist">
          {WORKSPACE_MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => select(m.id)}
              aria-current={active === m.id ? "true" : undefined}
              className={`rounded-[10000px] min-h-11 shrink-0 px-4 text-xs font-semibold transition-colors ${
                active === m.id
                  ? "bg-[#09090b] text-white"
                  : "border border-[#ececee] bg-white text-[#3f3f46]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/*
         * The action bar stays visible at every breakpoint. Contacting the
         * client and handing over the invoice are the two things an operator
         * does most often here, and both were previously buried in modules.
         */}
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-[#09090b]">
            {MODULE_LABEL[active]}
          </h2>
          <ProjectActionBar
            projectId={data.project.id}
            initialStatus={(data.project.status as ProjectStatus) ?? "draft"}
          />
        </header>

        {active === "callsheet" ? <ModuleCallSheet data={data} /> : null}
        {active === "sector" ? <SectorEngine data={data} /> : null}
        {active === "crew" ? <ModuleCrew data={data} /> : null}
        {active === "gear" ? <ModuleGearDual data={data} /> : null}
        {active === "invoice" ? <ModuleInvoice data={data} /> : null}
        {active === "rab" ? <ModuleRab data={data} /> : null}
        {active === "media" ? <ModuleMedia data={data} /> : null}
        {active === "proofing" ? <ModuleProofing data={data} /> : null}
      </section>
    </div>
  );
}
