import Link from "next/link";
import { requireOps } from "@/lib/auth/roles";
import { Plus, FolderKanban, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectStatus, ProjectRow, CustomerRow } from "@/types/database";
import { ProjectsFilter } from "@/components/admin/projects-filter";
import { Suspense } from "react";

/*
 * Lifecycle tone (Awesomic): nominal/complete → obsidian, attention/blocked →
 * Ember #ff5a00, archived → ash. A lifecycle label is never an alarm colour.
 */
const statusStyles: Record<ProjectStatus, { label: string; class: string }> = {
  draft: { label: "Draft", class: "bg-[#f4f4f5] text-[#3f3f46] border border-[#ececee]" },
  editing: { label: "Editing", class: "bg-[#ff5a00]/10 text-[#ff5a00] border border-[#ff5a00]/30" },
  ready: { label: "Ready", class: "bg-[#09090b] text-white border border-[#09090b]" },
  expired: { label: "Expired", class: "bg-[#ff5a00] text-white border border-[#ff5a00]" },
  archived: { label: "Archived", class: "bg-[#fafafa] text-[#a1a1aa] border border-[#ececee]" },
};

export default async function ProjectsPage(props: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const searchParams = await props.searchParams;
  const { supabase } = await requireOps();

  let query = supabase
    .from("projects")
    .select("id, name, slug, photography_type, status, shoot_date, created_at, customer_id, is_dp_paid, is_fully_paid, selection_locked_at, contract_value, dp_amount")
    .order("created_at", { ascending: false });

  if (searchParams.status && searchParams.status !== "all") {
    query = query.eq("status", searchParams.status);
  }

  if (searchParams.q) {
    query = query.ilike("name", `%${searchParams.q}%`);
  }

  const { data: rawProjects, error } = await query;
  let projectsData = rawProjects;

  if (!projectsData || error) {
    let fallbackQuery = supabase
      .from("projects")
      .select("id, name, slug, photography_type, status, shoot_date, created_at, customer_id")
      .order("created_at", { ascending: false });

    if (searchParams.status && searchParams.status !== "all") {
      fallbackQuery = fallbackQuery.eq("status", searchParams.status);
    }
    if (searchParams.q) {
      fallbackQuery = fallbackQuery.ilike("name", `%${searchParams.q}%`);
    }

    const { data: fallbackData } = await fallbackQuery;
    projectsData = (fallbackData || []).map((p) => ({
      ...p,
      is_dp_paid: false,
      is_fully_paid: false,
      selection_locked_at: null,
      contract_value: 0,
      dp_amount: 0,
    })) as typeof projectsData;
  }

  const projects = projectsData as Pick<ProjectRow, "id" | "name" | "slug" | "photography_type" | "status" | "shoot_date" | "created_at" | "customer_id" | "is_dp_paid" | "is_fully_paid" | "selection_locked_at" | "contract_value" | "dp_amount">[] | null;

  // Fetch customer names separately
  const customerIds = [...new Set(projects?.map((p) => p.customer_id) ?? [])];
  const { data: customersData } = customerIds.length > 0
    ? await supabase
        .from("customers")
        .select("id, name")
        .in("id", customerIds)
    : { data: [] };

  const customers = customersData as Pick<CustomerRow, "id" | "name">[] | null;

  const customerMap = Object.fromEntries(
    (customers ?? []).map((c) => [c.id, c.name])
  );

  const counts = {
    total: projects?.length ?? 0,
    ready: projects?.filter((p) => p.status === "ready").length ?? 0,
    draft: projects?.filter((p) => p.status === "draft" || p.status === "editing").length ?? 0,
  };

  return (
    <div className="max-w-5xl">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="eyebrow mb-2">Management</p>
          <h1 className="font-serif text-3xl font-bold">Projects</h1>
        </div>
        <Button asChild size="sm">
          <Link href="/admin/projects/new">
            <Plus size={16} /> New Project
          </Link>
        </Button>
      </div>

      <Suspense fallback={<div className="h-[42px] mb-6 bg-[#fafafa] border border-[#ececee] rounded-md animate-pulse"></div>}>
        <ProjectsFilter />
      </Suspense>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Total Projects", value: counts.total },
          { label: "Ready for Client", value: counts.ready },
          { label: "In Progress", value: counts.draft },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-[#ececee] rounded-lg p-5 shadow-sm">
            <p className="text-2xl font-semibold text-[#09090b]">{stat.value}</p>
            <p className="text-sm text-[#52525b] mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Projects Table */}
      <div className="bg-white border border-border rounded-lg overflow-hidden shadow-sm">
        {projects && projects.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#ececee] bg-[#fafafa]">
                <th className="text-left font-medium text-muted-foreground px-6 py-3">Project</th>
                <th className="text-left font-medium text-muted-foreground px-6 py-3 hidden sm:table-cell">Customer</th>
                <th className="text-left font-medium text-muted-foreground px-6 py-3 hidden md:table-cell">Type</th>
                <th className="text-left font-medium text-muted-foreground px-6 py-3 hidden lg:table-cell">Shoot Date</th>
                <th className="text-left font-medium text-muted-foreground px-6 py-3">Status</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ececee]">
              {projects.map((p) => {
                const status = statusStyles[p.status as ProjectStatus] ?? statusStyles.draft;
                return (
                  <tr key={p.id} className="hover:bg-[#fafafa] transition-colors [&>td]:h-11">
                    <td className="px-6 py-4">
                      <Link href={`/admin/projects/${p.id}`} className="inline-flex min-h-11 flex-col justify-center group">
                        <p className="font-medium group-hover:underline underline-offset-4">{p.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{p.slug}</p>
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground hidden sm:table-cell">
                      {customerMap[p.customer_id] ?? "—"}
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell">
                      <span className="capitalize text-muted-foreground">{p.photography_type}</span>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground hidden lg:table-cell">
                      {p.shoot_date
                        ? new Date(p.shoot_date).toLocaleDateString("id-ID", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : <span className="text-[#a1a1aa]">—</span>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1.5 items-start">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.class}`}>
                            {status.label}
                          </span>
                          {p.selection_locked_at ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#09090b] text-white border border-[#09090b]">
                              Pilihan Terkunci
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#fafafa] text-[#52525b] border border-[#ececee]">
                              Dalam Kurasi
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {p.is_dp_paid ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#09090b] text-white border border-[#09090b]">
                              DP Lunas
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border border-[#ff5a00]/30 text-[#ff5a00]">
                              Belum DP
                            </span>
                          )}
                          {p.is_fully_paid ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#09090b] text-white border border-[#09090b]">
                              Lunas (100%)
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#ff5a00] text-white border border-[#ff5a00]">
                              Sisa Tagihan
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/admin/projects/${p.id}`} className="inline-flex min-h-11 min-w-11 items-center justify-center -mr-2 text-[#52525b] hover:text-[#09090b] rounded-md hover:bg-[#fafafa] transition-colors">
                        <ChevronRight size={16} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="px-6 py-16 text-center">
            <FolderKanban size={32} className="text-[#a1a1aa] mx-auto mb-3" />
            <p className="font-medium mb-1">No projects yet</p>
            <p className="text-sm text-muted-foreground mb-6">
              Create your first project to share a gallery with a client.
            </p>
            <Button asChild size="sm">
              <Link href="/admin/projects/new">
                <Plus size={16} /> New Project
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
