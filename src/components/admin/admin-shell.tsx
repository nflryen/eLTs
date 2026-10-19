"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu, X } from "lucide-react";
import type { ReactNode } from "react";
import { ROLE_RANK, isPreviewableRole } from "@/lib/auth/role-meta";
import { PreviewBanner } from "./role-switcher";

/**
 * Admin navigation shell.
 *
 * Two defects from the previous build are fixed here:
 *
 *  1. NO ACTIVE STATE. All eight sidebar links shared one hardcoded class
 *     string with no `usePathname()` check, so the operator could never tell
 *     where they were. Active state is now explicit and derived from the path.
 *
 *  2. NO MOBILE NAVIGATION. The sidebar was `hidden md:flex` with no drawer and
 *     no hamburger, so below 768px every destination except the current page
 *     was unreachable — directly in conflict with field use on a phone. A
 *     drawer now provides the full menu at every width.
 *
 * Menus are grouped by WHEN they are used (Operate / Resource / Money) rather
 * than by database table, because that is how the owner's day is actually
 * shaped.
 *
 * VISUAL LANGUAGE (Awesomic)
 * --------------------------
 * The canvas is `#f4f4f5`. The desktop sidebar is an opaque WHITE card with a
 * single right hairline — never a translucent blurred panel. The active
 * destination is an obsidian (`#09090b`) pill; inactive destinations are iron
 * (`#3f3f46`) text that warms to `#fafafa` on hover. Every row clears 44px.
 */

export type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  /** Rendered as a subtle count/total on the right of the row. */
  badge?: ReactNode;
  /**
   * Minimum role rank required to SEE this destination.
   *
   * Visibility only — it is NOT the authorization boundary. Every route and
   * Server Action re-checks on the server (`requireOps` / `requireFounder` /
   * `requirePermission`). Hiding a link a user cannot use is a usability
   * courtesy; hiding it never makes anything secure.
   */
  minRank?: number;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/** Longest-prefix match so /admin/projects/123 highlights Projects, not Cockpit. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Removes destinations the active rank cannot use, and drops any group that
 * becomes empty so the sidebar never shows a bare heading with no links.
 */
function visibleGroups(groups: NavGroup[], rank: number): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => item.minRank === undefined || rank >= item.minRank,
      ),
    }))
    .filter((group) => group.items.length > 0);
}

function NavLinks({
  groups,
  pathname,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a1a1aa]">
            {group.label}
          </p>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-[10000px] px-3 text-sm font-medium transition-colors ${
                      active
                        ? "bg-[#09090b] text-white"
                        : "text-[#3f3f46] hover:bg-[#fafafa]"
                    }`}
                  >
                    <span className={active ? "text-white" : "text-[#a1a1aa]"}>
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                          active
                            ? "bg-white/20 text-white"
                            : "bg-[#f4f4f5] text-[#3f3f46]"
                        }`}
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AdminShell({
  groups,
  rank,
  brandHref = "/admin",
  footer,
  headerSlot,
  children,
}: {
  groups: NavGroup[];
  /** Effective role rank of the signed-in user, resolved on the server. */
  rank: number;
  brandHref?: string;
  footer: ReactNode;
  headerSlot?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);

  /*
   * VIEW-AS PREVIEW
   * ---------------
   * A SUPER_ADMIN can inspect the shell as a lower role via ?view_as=.
   *
   * DOWNGRADE-ONLY: the preview rank is `min(real, requested)`, so the widget
   * can only ever show LESS than the caller already has — selecting
   * SUPER_ADMIN while previewing grants nothing, and a non-SUPER_ADMIN cannot
   * trigger a preview at all.
   *
   * This changes navigation visibility and nothing else. Every route and
   * Server Action still authorises against the real role from the session.
   */
  const requestedPreview = searchParams.get("view_as");
  const previewRank =
    rank >= ROLE_RANK.SUPER_ADMIN && isPreviewableRole(requestedPreview)
      ? Math.min(rank, ROLE_RANK[requestedPreview])
      : rank;

  // Desktop sidebar and mobile drawer share one filtered source of truth, so
  // the two navigations can never disagree about what is visible.
  const allowed = visibleGroups(groups, previewRank);

  /*
   * Route change closes the drawer. This is derived during render rather than
   * written from an effect: a `setState` inside `useEffect` triggers a second
   * render pass on every navigation (cascading render), and React resets the
   * state anyway when the component is remounted.
   */
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (drawerOpen) setDrawerOpen(false);
  }

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const brand = (
    <Link
      href={brandHref}
      className="font-serif text-2xl font-bold tracking-tight text-[#09090b]"
    >
      Elts.
      <span className="ml-2 font-sans text-sm font-normal text-[#71717a]">
        Studio OS
      </span>
    </Link>
  );

  return (
    <div className="flex min-h-svh bg-[#f4f4f5]">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[#ececee] bg-white md:flex">
        <div className="flex h-16 items-center justify-between border-b border-[#ececee] px-5">
          {brand}
        </div>
        <NavLinks groups={allowed} pathname={pathname} />
        <div className="border-t border-[#ececee] p-3">{footer}</div>
      </aside>

      {/* ── Mobile drawer ───────────────────────────────────────────────── */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Tutup menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-[#09090b]/50"
          />
          <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col overflow-hidden rounded-r-[36px] border-r border-[#ececee] bg-white">
            <div className="flex h-16 items-center justify-between border-b border-[#ececee] px-5">
              {brand}
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Tutup menu"
                className="inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-[#ececee] text-[#3f3f46] transition-colors hover:bg-[#fafafa] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <NavLinks
              groups={allowed}
              pathname={pathname}
              onNavigate={() => setDrawerOpen(false)}
            />
            <div className="border-t border-[#ececee] p-3">{footer}</div>
          </div>
        </div>
      ) : null}

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-[#ececee] bg-white px-4 md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Buka menu"
            aria-expanded={drawerOpen}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-[#ececee] text-[#3f3f46] transition-colors hover:bg-[#fafafa] cursor-pointer"
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0 flex-1 truncate">{brand}</div>
          {headerSlot}
        </header>

        {/* Unmissable while previewing: a simulation must never look real. */}
        <PreviewBanner rank={previewRank} />

        <main className="min-w-0 flex-1 p-4 sm:p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
