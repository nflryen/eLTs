import { requirePageStaff } from "@/lib/auth/roles";
import { listMySessionsAction } from "@/app/actions/profile";
import { SecurityForm } from "@/components/settings/security-form";

/**
 * Security tab: password change and active-session revocation.
 *
 * The guard lives in the /settings layout, but this page re-checks with the
 * PAGE variant. `requireStaff()` is an alias for `requireRole()`, which THROWS
 * — calling it here produced an uncaught UnauthorizedError and an HTTP 500
 * instead of a login redirect.
 */
export default async function SecuritySettingsPage() {
  await requirePageStaff("/settings/security");
  const sessions = await listMySessionsAction();

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-lg font-semibold text-[#18181b]">Keamanan Akun</h1>
        <p className="mt-1 text-sm text-[#71717a]">
          Ubah kata sandi dan kelola sesi yang sedang aktif.
        </p>
      </header>

      <SecurityForm sessions={sessions} />
    </div>
  );
}
