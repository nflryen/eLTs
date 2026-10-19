"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Eye, ChevronDown, Check } from "lucide-react";
import {
  PREVIEWABLE_ROLES,
  ROLE_LABEL,
  ROLE_RANK,
  isPreviewableRole,
  type PreviewableRole,
} from "@/lib/auth/role-meta";

/**
 * View-as role switcher — SUPER_ADMIN only.
 *
 * SECURITY MODEL
 * --------------
 * This manipulates PRESENTATION ONLY. It changes which navigation destinations
 * `visibleGroups()` renders; it does not grant a single capability.
 *
 *   * The real rank is resolved on the server from `private.current_role()`
 *     and passed down as `actualRank`. A non-SUPER_ADMIN never receives the
 *     switcher at all.
 *   * Every route and Server Action independently calls `requireOps()`,
 *     `requireFounder()` or `requirePermission()`. Picking WORKER here does not
 *     remove any authority the server already granted; picking SUPER_ADMIN
 *     while actually being ADMIN grants nothing, because the layout that
 *     renders this widget only exists for staff who passed `requireStaff()`.
 *   * The role is stored in the URL (`?view_as=WORKER`) rather than a cookie
 *     or server session so it is impossible to confuse with real authority and
 *     trivially shareable for reproducing a layout question.
 *
 * DOWNGRADE-ONLY GUARANTEE
 * ------------------------
 * The impersonated rank can never exceed the caller's real rank. A preview can
 * show you LESS than you have, never more.
 */

const PARAM = "view_as";

export function RoleSwitcher({ actualRank }: { actualRank: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Only a real SUPER_ADMIN (>= 120) may preview other roles.
  const canPreview = actualRank >= ROLE_RANK.SUPER_ADMIN;

  const requested = searchParams.get(PARAM);
  const [open, setOpen] = useState(false);

  const activePreview: PreviewableRole | null =
    canPreview && isPreviewableRole(requested) ? requested : null;

  // The menu highlights the caller's real role when no preview is active.
  const effectiveRole: PreviewableRole = activePreview ?? "SUPER_ADMIN";

  // Not wrapped in useCallback: React Compiler memoises this component, and a
  // manual dependency list it cannot verify is an error under its rules.
  // `setOpen` is a stable setter, so identity churn is not a concern here.
  const select = (role: PreviewableRole) => {
    const next = new URLSearchParams(searchParams.toString());
    if (role === "SUPER_ADMIN") next.delete(PARAM);
    else next.set(PARAM, role);

    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    setOpen(false);
  };

  // Escape closes the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const options = useMemo(
    () => PREVIEWABLE_ROLES.map((r) => ({ role: r, label: ROLE_LABEL[r], rank: ROLE_RANK[r] })),
    [],
  );

  if (!canPreview) return null;

  const isPreviewing = activePreview !== null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Pratinjau peran (view-as)"
        className={`flex min-h-11 w-full items-center gap-2 rounded-[14px] border px-3 text-sm font-medium transition-colors cursor-pointer ${
          isPreviewing
            ? "border-[#ff5a00]/50 bg-[#ff5a00]/5 text-[#c2410c]"
            : "border-[#ececee] bg-white text-[#3f3f46] hover:bg-[#fafafa]"
        }`}
      >
        <Eye size={16} className={isPreviewing ? "text-[#ff5a00]" : "text-[#a1a1aa]"} />
        <span className="min-w-0 flex-1 truncate text-left">
          {isPreviewing ? ROLE_LABEL[activePreview] : "Lihat sebagai"}
        </span>
        <ChevronDown size={14} className="shrink-0 opacity-60" />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <ul
            role="listbox"
            aria-label="Pilih peran pratinjau"
            className="absolute bottom-full left-0 z-50 mb-2 w-full min-w-[240px] overflow-hidden rounded-[14px] border border-[#ececee] bg-white shadow-lg"
          >
            {options.map(({ role, label, rank }) => {
              const selected = effectiveRole === role;
              return (
                <li key={role}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => select(role)}
                    className={`flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm transition-colors cursor-pointer ${
                      selected ? "bg-[#fafafa] font-semibold text-[#09090b]" : "text-[#3f3f46] hover:bg-[#fafafa]"
                    }`}
                  >
                    <span className="w-4 shrink-0">
                      {selected ? <Check size={14} className="text-[#09090b]" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {label} <span className="text-[#a1a1aa]">({rank})</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/**
 * Amber hairline banner shown while a preview is active.
 *
 * Rendered in the main column so it is unmissable regardless of which page is
 * open — a preview that looks like the real thing is worse than no preview.
 */
export function PreviewBanner({ rank }: { rank: number }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const requested = searchParams.get(PARAM);
  const active = isPreviewableRole(requested) ? requested : null;
  if (!active) return null;

  const exit = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(PARAM);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="border-b border-[#ff5a00]/40 bg-[#ff5a00]/5 px-4 py-2 sm:px-6 md:px-8">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-semibold text-[#c2410c]">
          Pratinjau sebagai {ROLE_LABEL[active]} ({rank})
        </span>
        <span className="text-[#c2410c]/80">
          — tampilan baca-saja (read-only simulation). Izin server tidak berubah.
        </span>
        <button
          type="button"
          onClick={exit}
          className="ml-auto shrink-0 font-semibold text-[#c2410c] underline underline-offset-4 cursor-pointer"
        >
          Keluar pratinjau
        </button>
      </div>
    </div>
  );
}
