import { requirePageSuperAdmin } from "@/lib/auth/roles";
import { listManagedUsersAction, listRoleAuditAction } from "@/app/actions/role-management";
import { ASSIGNABLE_ROLES } from "@/lib/assignable-roles";
import { RoleTierManager } from "@/components/admin/users/role-tier-manager";

/**
 * User & Role Tier Management — SUPER_ADMIN only.
 *
 * HARD GUARD
 * ----------
 * `requirePageSuperAdmin()` runs BEFORE any data is fetched and redirects
 * (307) rather than throwing. A rank refusal is a routine navigation outcome,
 * not an exception: throwing produced an HTTP 500 error boundary that reads to
 * an operator as "the app is broken".
 *
 * The layout also omits this tab for non-super-admins, but that is presentation
 * only. This guard is the boundary — typing the URL directly must not leak the
 * roster, and it does not: nothing below runs.
 */
export default async function UserRoleManagementPage() {
  await requirePageSuperAdmin("/settings/users", "/settings/profile?denied=super_admin_required");

  const result = await listManagedUsersAction();

  /*
   * Defence in depth: the RPC also raises 42501 for a non-super-admin. If this
   * ever fires, the page guard and the database disagree — which would mean a
   * session changed rank between the two calls. Fail closed and say so, rather
   * than rendering an empty roster that looks like "there are no users".
   */
  if (!result.ok) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <h2 className="text-sm font-semibold text-red-800">Akses Ditolak</h2>
        <p className="mt-1 text-xs text-red-700">
          {result.error}
          {result.code ? ` (${result.code})` : ""}
        </p>
      </div>
    );
  }

  const audit = await listRoleAuditAction(20);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-sm font-semibold text-[#18181b]">Manajemen Pengguna & Tier</h2>
        <p className="mt-1 text-xs text-[#71717a]">
          Kelola peran setiap anggota tim. Hanya Super Admin (rank 120) yang dapat mengakses
          halaman ini.
        </p>
      </header>

      <RoleTierManager users={result.users} assignableRoles={ASSIGNABLE_ROLES} audit={audit} />
    </div>
  );
}
