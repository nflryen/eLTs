"use client";

import { useTransition } from "react";
import { updateProjectStatus } from "@/app/actions/admin-media";
import type { ProjectStatus } from "@/types/database";
import { cn } from "@/lib/utils";

const STATUSES: { value: ProjectStatus; label: string; description: string }[] = [
  { value: "draft", label: "Draft", description: "Project created, not yet started" },
  { value: "editing", label: "Editing", description: "Photos being processed/edited" },
  { value: "ready", label: "Ready", description: "Gallery visible to client" },
  { value: "expired", label: "Expired", description: "Access period has ended" },
  { value: "archived", label: "Archived", description: "Stored, no longer active" },
];

/*
 * Lifecycle tone (Awesomic): a status is never an alarm.
 *   nominal / complete (draft, ready)      → obsidian #09090b
 *   attention / blocked (editing, expired) → Ember #ff5a00
 *   archived (stored, inert)               → ash #a1a1aa
 */
const colors: Record<ProjectStatus, string> = {
  draft: "border-[#ececee] text-[#3f3f46] hover:bg-[#fafafa]",
  editing: "border-[#ff5a00]/40 text-[#ff5a00] hover:bg-[#ff5a00]/5",
  ready: "border-[#09090b] text-[#09090b] hover:bg-[#fafafa]",
  expired: "border-[#ff5a00] text-[#ff5a00] hover:bg-[#ff5a00]/5",
  archived: "border-[#ececee] text-[#a1a1aa] hover:bg-[#fafafa]",
};

const activeColors: Record<ProjectStatus, string> = {
  draft: "bg-[#09090b] border-[#09090b] text-white",
  editing: "bg-[#ff5a00] border-[#ff5a00] text-white",
  ready: "bg-[#09090b] border-[#09090b] text-white",
  expired: "bg-[#ff5a00] border-[#ff5a00] text-white",
  archived: "bg-[#f4f4f5] border-[#d4d4d8] text-[#a1a1aa]",
};

interface Props {
  projectId: string;
  currentStatus: ProjectStatus;
}

export function ProjectStatusControl({ projectId, currentStatus }: Props) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (status: ProjectStatus) => {
    if (status === currentStatus) return;
    startTransition(async () => {
      await updateProjectStatus(projectId, status);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const isActive = s.value === currentStatus;
          return (
            <button
              key={s.value}
              type="button"
              disabled={isPending}
              onClick={() => handleChange(s.value)}
              aria-pressed={isActive}
              className={cn(
                "inline-flex min-h-11 items-center px-3.5 rounded-full text-xs font-medium border transition-colors",
                isActive ? activeColors[s.value] : colors[s.value],
                isPending && "opacity-50 cursor-not-allowed",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {STATUSES.find((s) => s.value === currentStatus)?.description}
      </p>
      {isPending && (
        <p className="text-xs text-muted-foreground animate-pulse">Updating…</p>
      )}
    </div>
  );
}
