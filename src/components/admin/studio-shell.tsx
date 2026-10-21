import Link from "next/link";
import {
  LayoutDashboard, FolderKanban, Calendar, Package,
  Coins, Building2, Settings, LogOut, Clock, Receipt, Wallet,
  Clapperboard, LayoutTemplate, Inbox, ClipboardList, Tags,
} from "lucide-react";
import { adminLogout } from "@/app/actions/admin-auth";
import { requireStaff } from "@/lib/auth/roles";
import { ROLE_LABEL, ROLE_RANK } from "@/lib/auth/role-meta";
import { getAttentionQueue } from "@/app/actions/attention";
import { Button } from "@/components/ui/button";
import { AdminShell, type NavGroup } from "@/components/admin/admin-shell";
import { ActiveRoleSwitcher } from "@/components/admin/active-role-switcher";
import { getRoleContextAction } from "@/app/actions/role-switch";

/**
 * The single Studio OS application shell.
 *
 * WHY THIS IS EXTRACTED
 * ---------------------
 * `/settings/*` originally lived outside `/admin` and mounted its own bare
 * layout, so navigating there dropped the sidebar, topbar and responsive
 * wrapper entirely — the page looked unstyled and the user lost all navigation.
 *
 * Duplicating the shell into a second layout would have fixed the symptom and
 * created a worse problem: two shells to keep in step, which drift the moment
 * one gains a nav item or a rank gate. Instead BOTH route groups mount this
 * component, so there is exactly one sidebar, one footer, one attention queue,
 * and one set of rank gates.
 *
 * It is a Server Component because it calls `requireStaff()` and the attention
 * queue; the interactive pieces (switcher, mobile drawer) are Client Components
 * nested inside.
 */

const RANKS = { WORKER: 60, ADMIN: 80, FOUNDER: 100, SUPER_ADMIN: 120 } as const;

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { href: "/admin", label: "Hari Ini", icon: <LayoutDashboard size={18} />, minRank: RANKS.WORKER },
      /*
       * A crew member's own assignments. Rank WORKER so a freelancer with a
       * login can reach it; the page and every action resolve the crew row from
       * auth.uid() and never accept an id from the client.
       */
      { href: "/admin/my-assignments", label: "Penugasan Saya", icon: <ClipboardList size={18} />, minRank: RANKS.WORKER },
      { href: "/admin/calendar", label: "Kalender", icon: <Calendar size={18} />, minRank: RANKS.WORKER },
      { href: "/admin/projects", label: "Proyek", icon: <FolderKanban size={18} />, minRank: RANKS.WORKER },
      { href: "/admin/editor-queue", label: "Post-Produksi", icon: <Clock size={18} />, minRank: RANKS.WORKER },
    ],
  },
  {
    label: "Resource",
    items: [
      { href: "/admin/inventory", label: "Gear", icon: <Package size={18} />, minRank: RANKS.WORKER },
      /*
       * Operational crew management belongs in the MAIN navigation, not in
       * personal settings: it is day-to-day dispatch work (rosters, call
       * sheets, assignments), not account configuration. Only the RBAC tier
       * editor lives under Settings.
       */
      { href: "/admin/crew", label: "Kru & Dispatch", icon: <Clapperboard size={18} />, minRank: RANKS.WORKER },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/admin/invoices", label: "Tagihan", icon: <Receipt size={18} />, minRank: RANKS.ADMIN },
      { href: "/admin/finance", label: "Treasury", icon: <Coins size={18} />, minRank: RANKS.FOUNDER },
      { href: "/admin/customers", label: "Klien", icon: <Building2 size={18} />, minRank: RANKS.ADMIN },
      { href: "/admin/payroll", label: "Payroll", icon: <Wallet size={18} />, minRank: RANKS.ADMIN },
    ],
  },
  {
    /*
     * Marketing is its own group: publishing a portfolio is a studio-facing
     * activity, not an operational or financial one, and burying it under
     * Resource made it invisible to the people who actually use it.
     */
    label: "Marketing",
    items: [
      { href: "/admin/leads", label: "Lead & Konsultasi", icon: <Inbox size={18} />, minRank: RANKS.ADMIN },
      { href: "/admin/portfolio", label: "Portofolio & CMS", icon: <LayoutTemplate size={18} />, minRank: RANKS.ADMIN },
      { href: "/admin/pricelist", label: "Pricelist", icon: <Tags size={18} />, minRank: RANKS.ADMIN },
    ],
  },
];

export async function StudioShell({ children }: { children: React.ReactNode }) {
  const { admin, role, rank } = await requireStaff();

  /*
   * The active role is resolved from the database on every render, never from
   * a prop or cookie. `ownedRoles` drives the switcher so a member can only
   * ever see roles they actually hold.
   */
  const roleContext = await getRoleContextAction();
  const switchableRoles = (roleContext?.ownedRoles ?? (role ? [role] : []))
    .map((key) => ({
      key,
      label: ROLE_LABEL[key] ?? key,
      rank: ROLE_RANK[key] ?? 0,
      isActive: key === role,
    }))
    .sort((a, b) => b.rank - a.rank);

  const footer = (
    <div className="space-y-3">
      {/*
        * Minimal footer: profile card (clickable), role switcher, one settings
        * entry point, sign out. The loose "Profil" / "Keamanan" links that used
        * to sit here duplicated the Settings Hub tabs and made four competing
        * entry points to the same place.
        */}
      <Link
        href="/settings/profile"
        className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-[#f4f4f5]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#18181b] text-[11px] font-semibold text-white">
          {(admin.display_name || "?").slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[#09090b]">
            {admin.display_name}
          </span>
          <span className="block truncate text-[11px] font-medium text-[#71717a]">
            {role ? (ROLE_LABEL[role] ?? role) : "Tanpa peran"}
            {rank > 0 ? ` · ${rank}` : ""}
          </span>
        </span>
      </Link>

      <ActiveRoleSwitcher
        roles={switchableRoles}
        activeRole={role}
        activeRank={rank}
        elevatedUntil={roleContext?.elevatedUntil ?? null}
      />

      {/*
        * ONE settings entry point, available to every staff rank. The hub is
        * safe for all ranks because the SUPER_ADMIN tab inside it is filtered
        * server-side.
        */}
      <Link
        href="/settings"
        className="flex min-h-11 items-center gap-3 rounded-[10000px] px-3 text-sm font-medium text-[#3f3f46] transition-colors hover:bg-[#fafafa]"
      >
        <Settings size={18} className="text-[#a1a1aa]" />
        Pengaturan
      </Link>

      <form action={adminLogout}>
        <Button
          variant="outline"
          type="submit"
          className="h-11 w-full justify-start cursor-pointer"
        >
          <LogOut size={16} className="mr-2" /> Keluar
        </Button>
      </form>
    </div>
  );

  /*
   * The mobile bar needs the attention count before the user opens any page.
   * A failure here must not break the shell, so it degrades to an empty queue.
   */
  const attention = await getAttentionQueue().catch(() => ({
    items: [],
    generatedAt: new Date().toISOString(),
    summary: { critical: 0, high: 0, medium: 0, total: 0 },
  }));

  return (
    <AdminShell
      groups={NAV_GROUPS}
      rank={rank}
      footer={footer}
      attentionCount={attention.summary.total}
      userInitials={(admin.display_name ?? "?")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("")}
      attentionItems={attention.items.slice(0, 12).map((i) => ({
        id: i.id,
        title: i.title,
        detail: i.detail,
        href: i.actions[0]?.href ?? "/admin",
        severity: i.severity,
      }))}
    >
      {children}
    </AdminShell>
  );
}
