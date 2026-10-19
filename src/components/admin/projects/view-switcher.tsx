"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { LayoutGrid, List } from "lucide-react";
import {
  PROJECTS_VIEW_STORAGE_KEY as STORAGE_KEY,
  type ProjectsView,
} from "@/lib/projects/view";

/**
 * View switcher: folder cards vs. list.
 *
 * STATE LIVES IN THE URL (`?view=cards`), not only in localStorage. That gives
 * three properties that matter:
 *   - the server renders the correct view on first paint, so there is no
 *     card/table flash and no layout shift on hydration;
 *   - a copied link shows the recipient the same view;
 *   - back/forward behave as expected.
 *
 * localStorage is a secondary hint used only when the URL carries no preference,
 * so a returning operator keeps their last choice without the URL needing to be
 * rewritten on every visit.
 */

/** Read the stored preference in the browser; safe during SSR. */
export function readStoredView(): ProjectsView | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "list" || value === "cards" ? value : null;
  } catch {
    // Private mode / disabled storage must not break the page.
    return null;
  }
}

function storeView(view: ProjectsView) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    /* non-fatal */
  }
}

export function ViewSwitcher({ view }: { view: ProjectsView }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const select = useCallback(
    (next: ProjectsView) => {
      if (next === view) return;
      storeView(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", next);
      startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
    },
    [view, pathname, router, searchParams]
  );

  return (
    <div
      role="group"
      aria-label="Tampilan daftar proyek"
      className="inline-flex shrink-0 items-center gap-1 rounded-[12px] border border-[#ececee] bg-white p-1"
    >
      <button
        type="button"
        onClick={() => select("cards")}
        aria-pressed={view === "cards"}
        disabled={isPending}
        className={`inline-flex min-h-10 items-center gap-1.5 rounded-[9px] px-2.5 text-[11px] font-semibold transition-colors ${
          view === "cards" ? "bg-[#09090b] text-white" : "text-[#52525b] hover:bg-[#fafafa]"
        }`}
      >
        <LayoutGrid size={13} aria-hidden="true" />
        Kartu
      </button>
      <button
        type="button"
        onClick={() => select("list")}
        aria-pressed={view === "list"}
        disabled={isPending}
        className={`inline-flex min-h-10 items-center gap-1.5 rounded-[9px] px-2.5 text-[11px] font-semibold transition-colors ${
          view === "list" ? "bg-[#09090b] text-white" : "text-[#52525b] hover:bg-[#fafafa]"
        }`}
      >
        <List size={13} aria-hidden="true" />
        Tabel
      </button>
    </div>
  );
}
