import { requireStaff } from "@/lib/auth/roles";
import { listMySessionsAction } from "@/app/actions/profile";
import { SecurityForm } from "@/components/settings/security-form";

/**
 * Security tab: password change and active-session revocation.
 *
 * Both actions verify the current password or the session owner server-side.
 * Nothing on this page is authorized by its presence in the UI.
 */
export default async function SecuritySettingsPage() {
  await requireStaff();
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
