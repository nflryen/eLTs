"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu, X } from "lucide-react";
import type { ReactNode } from "react";
import { ROLE_RANK, isPreviewableRole } from "@/lib/auth/role-meta";
import { PreviewBanner } from "./role-switcher";
import { PanelLeft } from "lucide-react";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";
import { BottomSheet } from "./bottom-sheet";

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


/**
 * Tablet icon rail (768–1023px).
 *
 * A 256px sidebar consumes a third of a 768px viewport. The rail keeps every
 * destination one tap away at 72px, and the full sidebar returns at 1024px.
 * Labels are exposed to assistive tech via aria-label + a visually hidden span.
 */
function NavRail({ groups, pathname }: { groups: NavGroup[]; pathname: string }) {
  return (
    <nav aria-label="Navigasi utama" className="flex-1 space-y-4 overflow-y-auto px-2 py-4">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="sr-only">{group.label}</p>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    aria-label={item.label}
                    className={`group/rail relative flex min-h-12 items-center justify-center rounded-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090b] ${
                      active ? "bg-[#09090b] text-white" : "text-[#3f3f46] hover:bg-[#fafafa]"
                    }`}
                  >
                    <span className={active ? "text-white" : "text-[#71717a]"}>{item.icon}</span>
                    <span className="sr-only">{item.label}</span>
                    {/*
                     * Floating tooltip: the rail has no room for labels, so the
                     * name appears on hover AND on keyboard focus. Decorative —
                     * `aria-label` already carries it for assistive tech.
                     */}
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-[8px] bg-[#09090b] px-2.5 py-1.5 text-[11px] font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover/rail:opacity-100 group-focus-visible/rail:opacity-100 motion-reduce:transition-none"
                    >
                      {item.label}
                    </span>
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
  attentionCount = 0,
  attentionItems = [],
  userInitials,
}: {
  groups: NavGroup[];
  /** Effective role rank of the signed-in user, resolved on the server. */
  rank: number;
  /** Count shown on the mobile Notifikasi badge. */
  attentionCount?: number;
  /** Compact list rendered in the mobile notifications sheet. */
  attentionItems?: Array<{ id: string; title: string; detail: string; href: string; severity: string }>;
  brandHref?: string;
  footer: ReactNode;
  /** One-character initials shown in the collapsed rail. */
  userInitials?: string;
  headerSlot?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();
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

  // Escape closes the drawer (and the notification sheet) on mobile.
  useEffect(() => {
    if (!drawerOpen && !notificationsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrawerOpen(false);
      setNotificationsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, notificationsOpen]);

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
    <div className="flex min-h-svh overflow-x-hidden bg-[#f4f4f5]">
      {/*
       * ── Collapsible sidebar (md and up ONLY) ───────────────────────────
       * `hidden md:flex` is the hard isolation: below 768px this element is
       * display:none and the bottom bar owns navigation. One sidebar, two
       * widths (256px expanded / 72px rail) instead of two separate asides,
       * so the collapse transition is a width animation on one node rather
       * than a swap between components.
       */}
      <aside
        data-sidebar
        data-collapsed={sidebarCollapsed ? "true" : "false"}
        className={`hidden shrink-0 flex-col border-r border-[#ececee] bg-white transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex ${
          sidebarCollapsed ? "w-[72px]" : "w-64"
        }`}
      >
        <div
          className={`flex h-16 shrink-0 items-center border-b border-[#ececee] ${
            sidebarCollapsed ? "justify-center px-2" : "justify-between px-5"
          }`}
        >
          {sidebarCollapsed ? (
            <Link
              href={brandHref}
              aria-label="Elts Studio OS"
              className="font-serif text-lg font-bold tracking-tight text-[#09090b]"
            >
              E.
            </Link>
          ) : (
            brand
          )}
        </div>

        {sidebarCollapsed ? (
          <NavRail groups={allowed} pathname={pathname} />
        ) : (
          <NavLinks groups={allowed} pathname={pathname} />
        )}

        <div className={`border-t border-[#ececee] ${sidebarCollapsed ? "p-2" : "p-3"}`}>
          {sidebarCollapsed ? (
            <div
              className="flex size-10 items-center justify-center rounded-full border border-[#ececee] bg-[#fafafa] text-xs font-semibold text-[#52525b]"
              title={userInitials ? `Masuk sebagai ${userInitials}` : "Akun"}
            >
              {userInitials ?? "•"}
            </div>
          ) : (
            footer
          )}
        </div>

        {/* Collapse / expand toggle, pinned to the foot of the sidebar. */}
        <div className={`border-t border-[#ececee] ${sidebarCollapsed ? "p-2" : "p-3"}`}>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-pressed={sidebarCollapsed}
            aria-label={sidebarCollapsed ? "Perluas navigasi" : "Ciutkan navigasi"}
            title={sidebarCollapsed ? "Perluas navigasi" : "Ciutkan navigasi"}
            className={`flex min-h-11 w-full items-center gap-3 rounded-[12px] text-sm font-medium text-[#71717a] transition-colors hover:bg-[#fafafa] hover:text-[#09090b] ${
              sidebarCollapsed ? "justify-center px-0" : "px-3"
            }`}
          >
            <PanelLeft size={18} aria-hidden="true" className={sidebarCollapsed ? "rotate-180 transition-transform" : "transition-transform"} />
            {!sidebarCollapsed ? <span>Ciutkan</span> : null}
          </button>
        </div>
      </aside>

      {/*
       * ── Off-canvas drawer ──────────────────────────────────────────────
       * Kept MOUNTED and slid out with a transform so opening and closing are
       * both animated. Mounting on open (the previous approach) could only ever
       * animate the entrance; closing snapped. `md:hidden` + `inert` while
       * closed keeps it out of the tab order and the a11y tree.
       */}
      <div
        data-drawer
        data-open={drawerOpen ? "true" : "false"}
        className={`fixed inset-0 z-50 md:hidden ${drawerOpen ? "" : "pointer-events-none"}`}
        aria-hidden={drawerOpen ? undefined : true}
        inert={drawerOpen ? undefined : true}
      >
        <button
          type="button"
          aria-label="Tutup menu"
          onClick={() => setDrawerOpen(false)}
          tabIndex={drawerOpen ? 0 : -1}
          className={`absolute inset-0 h-full w-full cursor-default bg-[#09090b]/50 transition-opacity duration-200 motion-reduce:transition-none ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
        />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu utama"
            className={`absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col overflow-hidden rounded-r-[36px] border-r border-[#ececee] bg-white transition-transform duration-250 ease-out motion-reduce:transition-none ${
              drawerOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
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

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
         * No hamburger: the bottom bar owns primary navigation, and a second
         * menu affordance at the top of the same screen is redundant.
         */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-[#ececee] bg-white px-4 md:hidden">
          <div className="min-w-0 flex-1 truncate">{brand}</div>
          {headerSlot}
        </header>

        {/* Unmissable while previewing: a simulation must never look real. */}
        <PreviewBanner rank={previewRank} />

        {/*
         * `pb-24` on mobile clears the fixed bottom bar, plus the device inset on
         * notched screens. From md the bar is gone, so normal padding resumes.
         */}
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6 md:pb-8 md:p-8">
          {children}
        </main>

        <MobileBottomNav
          attentionCount={attentionCount}
          onOpenNotifications={() => setNotificationsOpen(true)}
          onOpenMenu={() => setDrawerOpen(true)}
        />

        <BottomSheet
          open={notificationsOpen}
          onClose={() => setNotificationsOpen(false)}
          title="Perlu Perhatian"
          labelledBy="mobile-notif-title"
        >
          {attentionItems.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[#71717a]">
              Tidak ada yang menunggu tindakan.
            </p>
          ) : (
            <ul className="divide-y divide-[#f4f4f5]">
              {attentionItems.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={() => setNotificationsOpen(false)}
                    className="flex min-h-14 items-start gap-3 rounded-[12px] px-3 py-3 hover:bg-[#fafafa]"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                        item.severity === "critical"
                          ? "bg-[#ff5a00]"
                          : item.severity === "high"
                            ? "bg-[#18181b]"
                            : "bg-[#a1a1aa]"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[#18181b]">{item.title}</span>
                      <span className="mt-0.5 block text-xs text-[#71717a]">{item.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </BottomSheet>
      </div>
    </div>
  );
}
