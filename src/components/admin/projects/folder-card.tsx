"use client";

import Link from "next/link";
import { Camera, HardDrive, Users } from "lucide-react";
import type { Pillar } from "@/lib/workspace/pillar-config";
import { PILLAR_CONFIG, isPillar } from "@/lib/workspace/pillar-config";

/**
 * Folder card — Awesomic Zinc / neumorphic folder sleeve.
 *
 * SHAPE
 * -----
 * Three stacked layers imply "a project is a folder with contents":
 *   1. the tab (top-left, cut-out profile)
 *   2. one or two document sheets peeking out behind the pocket
 *   3. the front pocket holding the metadata
 *
 * ACTIVE STATE
 * ------------
 * A selected folder inverts to the accent surface with white type, matching the
 * "blue folder" reference. Inactive folders stay white with a hairline and an
 * inset highlight, which is what produces the soft neumorphic edge rather than a
 * drop shadow.
 *
 * The accent is reserved: it means "selected", and on the status dot it means
 * attention (`#ff5a00`). It never decorates a healthy number.
 */

export type FolderCardProject = {
  id: string;
  name: string;
  slug: string;
  pillar: string;
  status: string;
  shootDate: string | null;
  mediaCount: number;
  crewCount: number;
  storageLabel: string;
  isDpPaid: boolean;
  isFullyPaid: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  editing: "Editing",
  ready: "Ready",
  archived: "Archived",
  expired: "Expired",
};

function pillarTag(pillar: string): string {
  return isPillar(pillar) ? PILLAR_CONFIG[pillar as Pillar].tag : "Lainnya";
}

export function FolderCard({
  project,
  selected = false,
  onOpen,
}: {
  project: FolderCardProject;
  selected?: boolean;
  onOpen?: (id: string) => void;
}) {
  const finance = project.isFullyPaid
    ? { label: "Lunas", tone: "paid" as const }
    : project.isDpPaid
      ? { label: "DP Lunas", tone: "partial" as const }
      : { label: "Belum DP", tone: "due" as const };

  const statusLabel = STATUS_LABEL[project.status] ?? project.status;

  return (
    <div className="group relative pt-2">
      {/*
       * The tab sits behind and above the pocket. `-z-10` keeps it from
       * intercepting clicks meant for the card body.
       */}
      <div
        aria-hidden="true"
        className={`absolute left-4 top-0 h-6 w-24 rounded-t-[12px] border border-b-0 transition-colors ${
          selected
            ? "border-[#ff5a00] bg-[#ff5a00]"
            : "border-[#ececee] bg-[#f4f4f5] group-hover:border-[#d4d4d8]"
        }`}
      />

      <div
        className={`relative flex h-full flex-col rounded-[24px] border transition-all duration-160 ${
          selected
            ? "folder-card folder-card--selected border-[#ff5a00] bg-gradient-to-b from-[#ff6d1f] to-[#ff5a00] text-white"
            : "folder-card border-[#ececee] bg-white hover:-translate-y-0.5 hover:border-[#d4d4d8]"
        }`}
      >
        {/* ── Contents: layered sheets peeking behind the pocket ─────────── */}
        <div className="relative px-3 pt-3" aria-hidden="true">
          <div
            className={`ml-4 h-3 w-[calc(100%-2rem)] rounded-t-[8px] ${
              selected ? "bg-white/25" : "bg-[#f4f4f5]"
            }`}
          />
          <div
            className={`ml-2 h-3 w-[calc(100%-1rem)] rounded-t-[8px] border border-b-0 ${
              selected ? "border-white/30 bg-white/40" : "border-[#ececee] bg-white"
            }`}
          />
        </div>

        {/* ── Front pocket ────────────────────────────────────────────────── */}
        <div
          className={`relative flex flex-1 flex-col rounded-[24px] rounded-t-none border-t px-5 pb-5 pt-4 ${
            selected
              ? "border-white/25 bg-[#ff5a00]/95"
              : "border-[#f4f4f5] bg-white"
          }`}
        >
          {/*
           * Pillar tag only, as a quiet uppercase pill. Status is NOT here: it
           * belongs at the foot with its micro-indicator so the eye reads the
           * title first, then the state of the work.
           */}
          <span
            className={`self-start rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ${
              selected
                ? "bg-white text-[#c2410c]"
                : "border border-[#ececee] bg-[#fafafa] text-[#71717a]"
            }`}
          >
            {pillarTag(project.pillar)}
          </span>

          <p
            className={`mt-2 line-clamp-2 text-[13px] font-semibold leading-snug ${
              selected ? "text-white" : "text-[#09090b]"
            }`}
            title={project.name}
          >
            {project.name}
          </p>

          {/* ── Live counters: one tabular strip, not stacked icons ────────── */}
          <dl
            className={`mt-3 flex items-center justify-between gap-2 border-t pt-3 font-mono text-[10px] tabular-nums ${
              selected ? "border-white/25 text-white/90" : "border-[#f4f4f5] text-[#71717a]"
            }`}
          >
            <div className="flex items-center gap-1">
              <Camera size={11} aria-hidden="true" />
              <dt className="sr-only">Media</dt>
              <dd>{project.mediaCount}</dd>
            </div>
            <span aria-hidden="true" className={selected ? "text-white/30" : "text-[#e4e4e7]"}>·</span>
            <div className="flex items-center gap-1">
              <Users size={11} aria-hidden="true" />
              <dt className="sr-only">Kru</dt>
              <dd>{project.crewCount}</dd>
            </div>
            <span aria-hidden="true" className={selected ? "text-white/30" : "text-[#e4e4e7]"}>·</span>
            <div className="flex min-w-0 items-center gap-1">
              <HardDrive size={11} aria-hidden="true" />
              <dt className="sr-only">Penyimpanan</dt>
              <dd className="truncate">{project.storageLabel}</dd>
            </div>
          </dl>

          {/* ── Status at the foot, with its micro-indicator ──────────────── */}
          <div className="mt-auto flex items-center gap-3 pt-3 text-[10px]">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`size-1.5 rounded-full ${
                  selected
                    ? "bg-white"
                    : project.status === "ready"
                      ? "bg-[#09090b]"
                      : "bg-[#a1a1aa]"
                }`}
              />
              <span className={`font-semibold ${selected ? "text-white" : "text-[#52525b]"}`}>
                {statusLabel}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`size-1.5 rounded-full ${
                  selected
                    ? "bg-white"
                    : finance.tone === "paid"
                      ? "bg-[#09090b]"
                      : finance.tone === "due"
                        ? "bg-[#ff5a00]"
                        : "bg-[#a1a1aa]"
                }`}
              />
              <span className={selected ? "text-white/90" : "text-[#71717a]"}>{finance.label}</span>
            </span>
          </div>

          {/*
           * The whole pocket is the click target. A stretched overlay keeps the
           * hit area full-card without nesting an <a> around block content.
           */}
          <Link
            href={`/admin/projects/${project.id}`}
            onClick={() => onOpen?.(project.id)}
            aria-label={`Buka proyek ${project.name}`}
            className="absolute inset-0 rounded-[24px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090b] focus-visible:ring-offset-2"
          >
            <span className="sr-only">Buka proyek</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
