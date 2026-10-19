import type { Metadata } from "next";
import { requirePageFounder } from "@/lib/auth/roles";
import { getUnifiedUsersList } from "@/app/actions/admin-users";
import { UserDirectoryClient } from "@/components/admin/users/user-directory-client";
import { Users, Crown, Briefcase, UserCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Users & Access - Admin Dashboard",
  description: "Unified User & Access Management Hub for ELTs. Photography",
};

export default async function AdminUsersPage() {
  /* RBAC administration is FOUNDER-only, matching the middleware map. */
  await requirePageFounder();
  const users = await getUnifiedUsersList();

  // Compute Stats for the Header Stats Bar
  const totalUsers = users.length;
  const ownersCount = users.filter((u) => u.role === "OWNER").length;
  const freelancersCount = users.filter((u) => u.role === "FREELANCE").length;
  const editorsCount = users.filter((u) => u.role === "EDITOR").length;
  const activeClientsCount = users.filter(
    (u) => u.role === "CLIENT" && u.status !== "SUSPENDED"
  ).length;

  return (
    <div className="max-w-7xl space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Access Control & Directory</p>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-foreground">
            Users & Access Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Pusat direktori terpadu untuk Studio Owners, Freelancers & Crew Operasional,
            Post-Production Editors, dan Klien terdaftar.
          </p>
        </div>
      </div>

      {/* Header Stats Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Users */}
        <div className="bg-white border border-[#ececee] rounded-lg p-5 shadow-xs flex items-center gap-4">
          <div className="size-11 rounded-lg bg-[#fafafa] border border-[#ececee] flex items-center justify-center text-[#3f3f46] shrink-0">
            <Users size={20} />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#09090b]">{totalUsers}</p>
            <p className="text-xs text-[#52525b] font-medium">
              Total Pengguna
            </p>
          </div>
        </div>

        {/* Studio Owners */}
        <div className="bg-white border border-[#ececee] rounded-lg p-5 shadow-xs flex items-center gap-4">
          <div className="size-11 rounded-lg bg-[#fafafa] border border-[#ececee] flex items-center justify-center text-[#09090b] shrink-0">
            <Crown size={20} />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#09090b]">{ownersCount}</p>
            <p className="text-xs text-[#52525b] font-medium">
              Studio Owners
            </p>
          </div>
        </div>

        {/* Freelancers & Technicians */}
        <div className="bg-white border border-[#ececee] rounded-lg p-5 shadow-xs flex items-center gap-4">
          <div className="size-11 rounded-lg bg-[#fafafa] border border-[#ececee] flex items-center justify-center text-[#3f3f46] shrink-0">
            <UserCheck size={20} />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#09090b]">
              {freelancersCount + editorsCount}
            </p>
            <p className="text-xs text-[#52525b] font-medium">
              Crew & Editors ({editorsCount} Editor)
            </p>
          </div>
        </div>

        {/* Active Clients */}
        <div className="bg-white border border-[#ececee] rounded-lg p-5 shadow-xs flex items-center gap-4">
          <div className="size-11 rounded-lg bg-[#fafafa] border border-[#ececee] flex items-center justify-center text-[#3f3f46] shrink-0">
            <Briefcase size={20} />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#09090b]">
              {activeClientsCount}
            </p>
            <p className="text-xs text-[#52525b] font-medium">
              Klien Aktif
            </p>
          </div>
        </div>
      </div>

      {/* Main Unified Directory Interactive Client */}
      <UserDirectoryClient initialUsers={users} />
    </div>
  );
}
