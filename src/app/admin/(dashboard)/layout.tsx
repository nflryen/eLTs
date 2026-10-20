import type { Metadata } from "next";
import Link from "next/link";
import {
  LayoutDashboard, FolderKanban, Calendar, Users, Package,
  Coins, Building2, Settings, LogOut, Clock, Receipt, Wallet,
} from "lucide-react";
import { adminLogout } from "@/app/actions/admin-auth";
import { requireStaff } from "@/lib/auth/roles";
import { ROLE_LABEL, ROLE_RANK } from "@/lib/auth/role-meta";
import { getAttentionQueue } from "@/app/actions/attention";
import { Button } from "@/components/ui/button";
import { AdminShell, type NavGroup } from "@/components/admin/admin-shell";
import { ActiveRoleSwitcher } from "@/components/admin/active-role-switcher";
import { getRoleContextAction } from "@/app/actions/role-switch";

export const metadata: Metadata = {
  title: "Studio OS — Elts.",
  robots: { index: false, follow: false },
};

/**
 * RANK GATES — visibility only.
 *
 *   60 WORKER       Operate (Hari Ini, Kalender, Proyek, Post-Produksi) + Gear.
 *                   No Money group at all: no invoicing, no treasury, no clients.
 *   80 ADMIN        Adds Klien + Tagihan (operational invoicing).
 *                   Still no Treasury, no Settings.
 *   100 FOUNDER     Adds Treasury (executive finance). No developer tooling.
 *   120 SUPER_ADMIN Everything.
 *
 * These thresholds hide links. The authoritative check is `requireOps()` /
 * `requireFounder()` / `requirePermission()` inside each route and Server
 * Action — a hidden link is a courtesy, never a security boundary.
 */
const RANKS = { WORKER: 60, ADMIN: 80, FOUNDER: 100, SUPER_ADMIN: 120 } as const;

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { href: "/admin", label: "Hari Ini", icon: <LayoutDashboard size={18} />, minRank: RANKS.WORKER },
      { href: "/admin/calendar", label: "Kalender", icon: <Calendar size={18} />, minRank: RANKS.WORKER },
      { href: "/admin/projects", label: "Proyek", icon: <FolderKanban size={18} />, minRank: RANKS.WORKER },
      { href: "/admin/editor-queue", label: "Post-Produksi", icon: <Clock size={18} />, minRank: RANKS.WORKER },
    ],
  },
  {
    label: "Resource",
    items: [
      { href: "/admin/inventory", label: "Gear", icon: <Package size={18} />, minRank: RANKS.WORKER },
      // User & role administration is not an operations concern.
      { href: "/admin/users", label: "Kru & Akses", icon: <Users size={18} />, minRank: RANKS.FOUNDER },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/admin/invoices", label: "Tagihan", icon: <Receipt size={18} />, minRank: RANKS.ADMIN },
      { href: "/admin/finance", label: "Treasury", icon: <Coins size={18} />, minRank: RANKS.FOUNDER },
      { href: "/admin/customers", label: "Klien", icon: <Building2 size={18} />, minRank: RANKS.ADMIN },
      // Compensation hub: operational payroll for ADMIN, dividends for FOUNDER.
      { href: "/admin/payroll", label: "Payroll", icon: <Wallet size={18} />, minRank: RANKS.ADMIN },
    ],
  },
];

/*
 * Re-exported from `role-meta`, not redeclared.
 *
 * The local copy omitted EDITOR, so an editor's sidebar rendered the raw key.
 * `role-meta` is the single source of rank and label truth and is
 * dependency-free, so it is safe in both Server and Client Components.
 */

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
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
      <div className="px-2">
        <p className="truncate text-sm font-semibold text-[#09090b]">
          {admin.display_name}
        </p>
        <p className="text-xs font-medium text-[#71717a]">
          {role ? (ROLE_LABEL[role] ?? role) : "Tanpa peran"}
        </p>
      </div>
      {/*
        * Authority-bearing switcher. Downgrades apply instantly; escalations
        * require the account password. The previous preview-only dropdown was
        * a SUPER_ADMIN presentation toy and could not change authority, so it
        * is deliberately gone rather than kept alongside this one.
        */}
      <ActiveRoleSwitcher
        roles={switchableRoles}
        activeRole={role}
        activeRank={rank}
        elevatedUntil={roleContext?.elevatedUntil ?? null}
      />

      <form action={adminLogout}>
        <Button
          variant="outline"
          type="submit"
          className="h-11 w-full justify-start cursor-pointer"
        >
          <LogOut size={16} className="mr-2" /> Keluar
        </Button>
      </form>
      {/* Settings is ADMIN+ only; WORKER must not see the entry point either. */}
      {rank >= RANKS.ADMIN ? (
        <Link
          href="/admin/settings"
          className="flex min-h-11 items-center gap-3 rounded-[10000px] px-3 text-sm font-medium text-[#3f3f46] transition-colors hover:bg-[#fafafa]"
        >
          <Settings size={18} className="text-[#a1a1aa]" />
          Pengaturan
        </Link>
      ) : null}
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
