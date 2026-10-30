import type { Metadata } from "next";
import Link from "next/link";
import { requirePageStaff } from "@/lib/auth/roles";
import { ROLE_LABEL, ROLE_RANK } from "@/lib/auth/role-meta";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { StudioShell } from "@/components/admin/studio-shell";

export const metadata: Metadata = {
  title: "Pengaturan — Elts.",
  robots: { index: false, follow: false },
};

/*
 * Per-user settings: reads cookies, resolves rank, and conditionally mounts the
 * SUPER_ADMIN tab. Must never be prerendered — see the equivalent note in
 * `src/app/admin/(dashboard)/layout.tsx` for the two failure modes.
 */
export const dynamic = "force-dynamic";

/**
 * Settings Hub layout.
 *
 * MOUNTS THE SAME SHELL AS /admin
 * -------------------------------
 * `/settings/*` previously rendered a bare standalone page: no sidebar, no
 * topbar, no responsive wrapper. The user lost all navigation the moment they
 * opened their own profile. It now nests inside `StudioShell`, the exact
 * component `/admin` uses, so there is one shell and no drift between the two
 * route groups.
 *
 * The staff guard runs in `StudioShell`; this layout re-checks with the PAGE
 * variant so a tab is never rendered for an unauthenticated caller even if the
 * shell's behaviour changes.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageStaff("/settings");

  const tabs = [
    { href: "/settings/profile", label: "Profil Saya & Rekening" },
    { href: "/settings/security", label: "Keamanan Akun & Sesi" },
    ...(session.rank >= 80
      ? [{ href: "/settings/whatsapp", label: "WhatsApp Gateway" }]
      : []),
    /*
     * RBAC tier configuration only — NOT daily crew assignments. Operational
     * crew management lives at /admin/crew in the main navigation.
     *
     * Filtered on the ACTIVE rank server-side, so the tab is absent from the
     * RSC payload for anyone below 120.
     */
    ...(session.rank >= ROLE_RANK.SUPER_ADMIN
      ? [{ href: "/settings/users", label: "Manajemen Tier & Izin" }]
      : []),
  ];

  return (
    <StudioShell>
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1aa]">
            Pengaturan
          </p>
          <h1 className="mt-1 text-xl font-semibold text-[#18181b]">{session.displayName}</h1>
          <p className="mt-0.5 text-xs text-[#71717a]">
            {session.role ? (ROLE_LABEL[session.role] ?? session.role) : "Tanpa peran"}
            {session.rank > 0 ? ` · rank ${session.rank}` : ""}
          </p>
        </header>

        <SettingsTabs tabs={tabs} />

        <main className="mt-6">{children}</main>

        <footer className="mt-8 border-t border-[#ececee] pt-4">
          <Link href="/admin" className="text-xs font-medium text-[#71717a] hover:text-[#18181b]">
            ← Kembali ke Dashboard
          </Link>
        </footer>
      </div>
    </StudioShell>
  );
}
