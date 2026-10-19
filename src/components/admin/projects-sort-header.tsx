"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

/**
 * Sortable table header.
 *
 * Emits `aria-sort` on the active column so screen readers announce the order,
 * and toggles asc/desc on repeat activation. The arrow is decorative: the state
 * lives in `aria-sort`, not in the icon.
 */

export type SortDirection = "asc" | "desc";

export function SortHeader({
  column,
  label,
  className = "",
}: {
  column: "name" | "shoot_date" | "status";
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const raw = searchParams.get("sort") ?? "";
  const [activeKey, activeDir] = raw.split(":");
  const isActive = activeKey === column;
  const direction: SortDirection = isActive && activeDir === "asc" ? "asc" : "desc";

  const toggle = () => {
    const nextDir: SortDirection = isActive && direction === "asc" ? "desc" : "asc";
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", `${column}:${nextDir}`);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  };

  const Icon = !isActive ? ChevronsUpDown : direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      className={`px-6 py-2.5 text-left ${className}`}
      aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#71717a] hover:text-[#18181b] disabled:opacity-60"
      >
        {label}
        <Icon
          size={12}
          aria-hidden="true"
          className={isActive ? "text-[#18181b]" : "text-[#a1a1aa]"}
        />
      </button>
    </th>
  );
}
