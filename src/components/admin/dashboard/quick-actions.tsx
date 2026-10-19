"use client";

import Link from "next/link";
import { Package, Plus, Receipt, Users } from "lucide-react";

/**
 * Quick Action Bar.
 *
 * The four things an operator starts from the dashboard. Each is a real route
 * that already performs the action, so these are navigation shortcuts rather
 * than a second implementation of the flows.
 *
 * 14px radius and min-h-11 keep them distinct from the 36px StatTiles: tiles
 * are read, buttons are pressed. Every target meets the 44px touch minimum.
 */

const ACTIONS = [
  { href: "/admin/projects/new", label: "Proyek Baru", icon: Plus, primary: true },
  { href: "/admin/projects?module=crew", label: "Dispatch Kru", icon: Users, primary: false, minRank: 80 },
  /*
   * Treasury is FOUNDER+ (nav config). Billing is initiated from Tagihan, which
   * ADMIN can open; this shortcut previously sent an ADMIN to a route the
   * middleware now redirects away from.
   */
  { href: "/admin/invoices", label: "Buat Invoice", icon: Receipt, primary: false, minRank: 80 },
  { href: "/admin/inventory", label: "Tambah Gear", icon: Package, primary: false },
] as const;

export function QuickActions({ rank }: { rank: number }) {
  const actions = ACTIONS.filter((a) => rank >= ("minRank" in a ? a.minRank : 0));
  return (
    <nav aria-label="Aksi cepat" className="flex flex-wrap items-center gap-2">
      {actions.map(({ href, label, icon: Icon, primary }) => (
        <Link
          key={href}
          href={href}
          className={`inline-flex min-h-11 items-center gap-2 rounded-[14px] px-4 text-sm font-semibold transition-colors ${
            primary
              ? "bg-[#09090b] text-white hover:bg-[#27272a]"
              : "border border-[#ececee] bg-white text-[#18181b] hover:bg-[#fafafa]"
          }`}
        >
          <Icon size={15} aria-hidden="true" className={primary ? "" : "text-[#71717a]"} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
