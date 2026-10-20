"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Settings tab bar.
 *
 * Receives an ALREADY-FILTERED list from the server layout. It performs no
 * rank logic of its own: authorization decided on the client is not
 * authorization, and a Client Component cannot be trusted to omit a tab from
 * the DOM.
 */
export function SettingsTabs({ tabs }: { tabs: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Pengaturan"
      className="flex gap-1 overflow-x-auto rounded-xl border border-[#ececee] bg-white p-1"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              active
                ? "bg-[#18181b] text-white"
                : "text-[#52525b] hover:bg-[#f4f4f5]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
