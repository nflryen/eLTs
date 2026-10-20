import type { Metadata } from "next";
import Link from "next/link";
import { requirePageStaff } from "@/lib/auth/roles";
import { ROLE_LABEL, ROLE_RANK } from "@/lib/auth/role-meta";
import { SettingsTabs } from "@/components/settings/settings-tabs";

export const metadata: Metadata = {
  title: "Pengaturan — Elts.",
  robots: { index: false, follow: false },
};

/**
 * Unified Settings Hub.
 *
 * WHY THIS LAYOUT EXISTS
 * ----------------------
 * The two settings pages previously guarded themselves with `requireStaff()`,
 * which is an ALIAS FOR `requireRole()`. `requireRole` THROWS by design — it
 * exists so Server Actions can catch the rejection and return an inline error.
 * Calling it from a Server Component produced an uncaught UnauthorizedError and
 * an HTTP 500 error boundary instead of a login redirect.
 *
 * The guard belongs here, once, using `requirePageStaff()` — the page variant
 * that calls `redirect()`. Every tab under /settings is then authenticated
 * before it renders, and a new tab cannot forget the check.
 *
 * The SUPER_ADMIN tab is filtered HERE, on the server. It is not rendered,
 * not passed to the client component, and therefore absent from the RSC
 * payload. Hiding it with CSS would leave it in the HTML and in the
 * serialised flight data.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  /*
   * `returnTo` is deliberately the settings root rather than the current path:
   * the layout cannot read the child path, and landing on /settings after login
   * is the correct resume point for any tab.
   */
  const session = await requirePageStaff("/settings");

  const tabs = [
    { href: "/settings/profile", label: "Profil & Rekening" },
    { href: "/settings/security", label: "Keamanan Akun" },
    /*
     * Conditional on the ACTIVE rank, not on any role the account holds. A
     * hybrid member operating as WORKER must not see the admin tab even though
     * they also own SUPER_ADMIN.
     */
    ...(session.rank >= ROLE_RANK.SUPER_ADMIN
      ? [{ href: "/settings/users", label: "Manajemen Pengguna & Tier" }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <header className="mb-6">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1aa]">
            Pengaturan
          </p>
          <h1 className="mt-1 text-xl font-semibold text-[#18181b]">
            {session.displayName}
          </h1>
          <p className="mt-0.5 text-xs text-[#71717a]">
            {session.role ? (ROLE_LABEL[session.role] ?? session.role) : "Tanpa peran"}
            {session.rank > 0 ? ` · rank ${session.rank}` : ""}
          </p>
        </header>

        <SettingsTabs tabs={tabs} />

        <main className="mt-6">{children}</main>

        <footer className="mt-8 border-t border-[#ececee] pt-4">
          <Link
            href="/admin"
            className="text-xs font-medium text-[#71717a] hover:text-[#18181b]"
          >
            ← Kembali ke Dashboard
          </Link>
        </footer>
      </div>
    </div>
  );
}
