import type { Metadata } from "next";
import { requirePageSuperAdmin } from "@/lib/auth/roles";
import { listManagedUsersAction, listRoleAuditAction } from "@/app/actions/role-management";
import { ASSIGNABLE_ROLES } from "@/lib/assignable-roles";
import { RoleTierManager } from "@/components/admin/users/role-tier-manager";

export const metadata: Metadata = {
  title: "User & Role Tier Management — Elts.",
  robots: { index: false, follow: false },
};

/**
 * Super Admin role tier management.
 *
 * Gated at rank 120 (`requirePageSuperAdmin`). The page redirects on failure;
 * the server actions return 42501. Both are needed: the redirect stops a human
 * from seeing the screen, the action guard stops a crafted request.
 */
export default async function UserRoleManagementPage() {
  await requirePageSuperAdmin();

  const result = await listManagedUsersAction();

  if (!result.ok) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-[#18181b]">Akses Ditolak</h1>
        <p className="mt-1 text-sm text-[#71717a]">
          {result.error} {result.code ? `(${result.code})` : ""}
        </p>
      </div>
    );
  }

  const audit = await listRoleAuditAction(20);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-lg font-semibold text-[#18181b]">Manajemen Pengguna & Tier Peran</h1>
        <p className="mt-1 text-sm text-[#71717a]">
          Kelola peran setiap anggota tim. Hanya Super Admin (rank 120) yang dapat mengakses
          halaman ini.
        </p>
      </header>

      <RoleTierManager
        users={result.users}
        assignableRoles={ASSIGNABLE_ROLES}
        audit={audit}
      />
    </div>
  );
}
