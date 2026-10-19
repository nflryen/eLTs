"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bell, Calendar, FolderKanban, Home, Menu } from "lucide-react";

/**
 * Mobile bottom navigation.
 *
 * WHY A BOTTOM BAR
 * ----------------
 * The thumb reaches the bottom third of a phone screen comfortably; a top
 * hamburger does not. Five primary destinations therefore live in a fixed bar,
 * and everything else moves into a sheet. Five is a deliberate ceiling — past
 * that, targets shrink below what a thumb can hit reliably in the field.
 *
 * SAFE AREA
 * ---------
 * `env(safe-area-inset-bottom)` pads the bar so the iOS home indicator never
 * overlaps the labels. Without it, the last row of text sits under the OS gesture
 * region on notched devices.
 */

const PRIMARY = [
  { href: "/admin", label: "Hari Ini", icon: Home },
  { href: "/admin/calendar", label: "Kalender", icon: Calendar },
  { href: "/admin/projects", label: "Proyek", icon: FolderKanban },
] as const;

/** Longest-prefix match so /admin/projects/123 highlights Proyek, not Hari Ini. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileBottomNav({
  attentionCount,
  onOpenNotifications,
  onOpenMenu,
}: {
  attentionCount: number;
  onOpenNotifications: () => void;
  onOpenMenu: () => void;
}) {
  const pathname = usePathname();
  const [pressed, setPressed] = useState<string | null>(null);

  const itemClass = (active: boolean) =>
    `flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-[12px] text-[10px] font-semibold transition-colors ${
      active ? "text-[#09090b]" : "text-[#71717a]"
    }`;

  return (
    <nav
      aria-label="Navigasi utama seluler"
      data-mobile-nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#ececee] bg-white/95 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-stretch gap-0.5 px-1.5 py-1">
        {PRIMARY.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={itemClass(active)}
            >
              <Icon size={20} aria-hidden="true" strokeWidth={active ? 2.4 : 1.9} />
              <span>{label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onOpenNotifications}
          aria-label={`Notifikasi${attentionCount > 0 ? `, ${attentionCount} perlu perhatian` : ""}`}
          className={`relative ${itemClass(false)}`}
        >
          <Bell size={20} aria-hidden="true" strokeWidth={1.9} />
          <span>Notifikasi</span>
          {attentionCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-2 top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[#ff5a00] px-1 text-[9px] font-bold leading-none text-white"
            >
              {attentionCount > 99 ? "99+" : attentionCount}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => {
            setPressed("menu");
            onOpenMenu();
          }}
          aria-label="Buka menu utama"
          aria-haspopup="dialog"
          className={itemClass(pressed === "menu")}
        >
          <Menu size={20} aria-hidden="true" strokeWidth={1.9} />
          <span>Menu</span>
        </button>
      </div>
    </nav>
  );
}
