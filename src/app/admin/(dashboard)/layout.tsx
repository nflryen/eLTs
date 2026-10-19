import type { Metadata } from "next";
import Link from "next/link";
import {
  LayoutDashboard, FolderKanban, Calendar, Users, Package,
  Coins, Building2, Settings, LogOut, Clock, Receipt,
} from "lucide-react";
import { adminLogout } from "@/app/actions/admin-auth";
import { requireStaff } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { AdminShell, type NavGroup } from "@/components/admin/admin-shell";

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
    ],
  },
];

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  FOUNDER: "Founder",
  ADMIN: "Operations Lead",
  WORKER: "Kreatif",
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { admin, role, rank } = await requireStaff();

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

  return (
    <AdminShell groups={NAV_GROUPS} rank={rank} footer={footer}>
      {children}
    </AdminShell>
  );
}
