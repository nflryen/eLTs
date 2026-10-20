import Link from "next/link";
import { requirePageStaff } from "@/lib/auth/roles";
import { Plus, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectStatus, ProjectRow, CustomerRow } from "@/types/database";
import { ProjectsFilter } from "@/components/admin/projects-filter";
import { SortHeader } from "@/components/admin/projects-sort-header";
import { ViewSwitcher } from "@/components/admin/projects/view-switcher";
import { parseView } from "@/lib/projects/view";
import { FolderCard, type FolderCardProject } from "@/components/admin/projects/folder-card";
import { loadFolderMetrics, formatStorage } from "@/lib/workspace/folder-metrics";
import { Suspense } from "react";

/*
 * The `Finansial` column is an ADMIN+ surface. WORKER is a legitimate member of
 * this list (layout.tsx puts Proyek in "Operate"), but must not learn which
 * projects are paid — that is client revenue, not production state.
 */
const FINANCE_RANK = 80;

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

/** Columns the table can sort by, mapped to a real database column. */
const SORTABLE = {
  name: "name",
  shoot_date: "shoot_date",
  status: "status",
  created_at: "created_at",
} as const;
type SortKey = keyof typeof SORTABLE;

function parseSort(raw: string | undefined): { key: SortKey; dir: "asc" | "desc" } {
  const [key, dir] = (raw ?? "").split(":");
  const isKey = (k: string): k is SortKey => Object.prototype.hasOwnProperty.call(SORTABLE, k);
  if (!key || !isKey(key)) return { key: "created_at", dir: "desc" };
  return { key, dir: dir === "asc" ? "asc" : "desc" };
}

export default async function ProjectsPage(props: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string; view?: string }>;
}) {
  const searchParams = await props.searchParams;
  /*
   * Proyek is a WORKER surface (layout.tsx, "Operate"), so this gates at STAFF
   * (60). The previous `requireOps()` (80) contradicted the nav and turned a
   * WORKER's own menu entry into a 500.
   *
   * RLS lets a WORKER read `projects` but denies `customers` and
   * `project_invoices`, so the boundary is enforced again at the data layer.
   */
  const { supabase, rank } = await requirePageStaff();
  const sort = parseSort(searchParams.sort);
  // Read the view server-side so the first paint is already correct.
  const view = parseView(searchParams.view);

  const financeVisible = rank >= FINANCE_RANK;
  /*
   * Column projection, not just column hiding: a WORKER's payload must not
   * contain `contract_value`, `dp_amount` or the paid flags at all. Filtering in
   * JSX would still ship them in the RSC payload where the client can read them.
   */
  /*
   * Two literal SELECTs, one per rank, rather than one interpolated string.
   *
   * Supabase infers the row type from a LITERAL select; a template literal
   * collapses the result to `ParserError`. Keeping the branches separate keeps
   * the types honest AND keeps `contract_value` / `dp_amount` off the wire for a
   * WORKER — hiding the cell in JSX would still ship them in the RSC payload.
   */
  type ListedProject = Pick<
    ProjectRow,
    | "id" | "name" | "slug" | "photography_type" | "status" | "shoot_date"
    | "created_at" | "customer_id" | "selection_locked_at"
    | "is_dp_paid" | "is_fully_paid" | "contract_value" | "dp_amount"
  >;

  const applyFilters = <T extends { eq: unknown; ilike: unknown }>(q: T): T => {
    let out = q;
    if (searchParams.status && searchParams.status !== "all") {
      out = (out as { eq: (c: string, v: string) => T }).eq("status", searchParams.status) as T;
    }
    if (searchParams.q) {
      out = (out as { ilike: (c: string, v: string) => T }).ilike("name", `%${searchParams.q}%`) as T;
    }
    return out;
  };

  let projectsData: ListedProject[] | null = null;

  if (financeVisible) {
    const { data, error } = await applyFilters(
      supabase
        .from("projects")
        .select("id, name, slug, photography_type, service_pillar, status, shoot_date, created_at, customer_id, selection_locked_at, is_dp_paid, is_fully_paid, contract_value, dp_amount")
        .order(SORTABLE[sort.key], { ascending: sort.dir === "asc", nullsFirst: false }),
    );
    if (!error) projectsData = data as ListedProject[] | null;
  } else {
    const { data, error } = await applyFilters(
      supabase
        .from("projects")
        .select("id, name, slug, photography_type, service_pillar, status, shoot_date, created_at, customer_id, selection_locked_at")
        .order(SORTABLE[sort.key], { ascending: sort.dir === "asc", nullsFirst: false }),
    );
    /*
     * Money fields are filled with inert defaults purely to satisfy the row
     * shape; `financeVisible` is false for this branch, so nothing renders them.
     */
    if (!error) {
      projectsData = (data ?? []).map((p) => ({
        ...p,
        is_dp_paid: false,
        is_fully_paid: false,
        contract_value: 0,
        dp_amount: 0,
      }));
    }
  }

  const projects = projectsData;

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

  // Folder-card metrics in one aggregate pass (never N+1).
  const metrics = await loadFolderMetrics(supabase, (projects ?? []).map((p) => p.id));

  const cardProjects: FolderCardProject[] = (projects ?? []).map((p) => {
    const m = metrics.get(p.id);
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      pillar: (p as { service_pillar?: string }).service_pillar ?? "",
      status: p.status,
      shootDate: p.shoot_date,
      mediaCount: m?.mediaCount ?? 0,
      crewCount: m?.crewCount ?? 0,
      storageLabel: formatStorage(m?.storageBytes ?? null),
      // Folder cards show a payment dot; WORKER never receives the flags, so
      // the card renders without one rather than guessing "unpaid".
      isDpPaid: financeVisible ? p.is_dp_paid : false,
      isFullyPaid: financeVisible ? p.is_fully_paid : false,
      financeVisible,
    };
  });

  const counts = {
    total: projects?.length ?? 0,
    ready: projects?.filter((p) => p.status === "ready").length ?? 0,
    draft: projects?.filter((p) => p.status === "draft" || p.status === "editing").length ?? 0,
  };

  return (
    <div className="mx-auto max-w-6xl py-2">
      {/*
        `max-w-6xl` (1152px), a step up from the 5xl used by text-led
        directories. Four folder cards need ~232px each plus gutters; at 5xl the
        fourth column was squeezed and the sleeves looked cramped beside the
        table view, which has no such constraint.
      */}
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

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Suspense fallback={<div className="h-[42px] flex-1 animate-pulse rounded-[10px] bg-[#fafafa]" />}>
          <ProjectsFilter />
        </Suspense>
        <Suspense fallback={<div className="h-[42px] w-[132px] animate-pulse rounded-[12px] bg-[#fafafa]" />}>
          <ViewSwitcher view={view} />
        </Suspense>
      </div>

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

      {/*
       * TABLE REDESIGN
       * ---------------
       * The status cell previously stacked FOUR badges (production state,
       * curation, DP, balance) into one 183px column, inflating every row to
       * 139px on desktop and 171px on mobile. Those are four independent facts,
       * so they are now four scannable columns with one badge each, and the row
       * collapses to a single line of height.
       */}
      {view === "cards" ? (
        projects && projects.length > 0 ? (
          <div
            /*
             * FOUR columns maximum, not five.
             *
             * At `xl` the container is `max-w-5xl` (1024px). Five columns there
             * gave each card ~180px, so a 9-project studio rendered 5 + 4 with a
             * lonely trailing card and conspicuously narrow sleeves (the folder
             * geometry is width-proportional). Four columns hold ~232px each.
             *
             * `auto-rows-fr` equalises row heights so a two-line title cannot
             * stretch its row and leave the grid ragged beside a one-line
             * neighbour.
             */
            className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 lg:gap-4 xl:grid-cols-4 xl:gap-5"
            aria-label="Proyek sebagai folder"
          >
            {cardProjects.map((p) => (
              <FolderCard key={p.id} project={p} />
            ))}
          </div>
        ) : (
          <div className="rounded-[18px] border border-dashed border-[#d4d4d8] px-6 py-16 text-center">
            <FolderKanban size={32} className="mx-auto mb-3 text-[#a1a1aa]" aria-hidden="true" />
            <p className="mb-1 font-medium">Belum ada proyek</p>
            <p className="mb-6 text-sm text-muted-foreground">
              Buat proyek pertama untuk mulai membagikan galeri ke klien.
            </p>
            <Button asChild size="sm">
              <Link href="/admin/projects/new">
                <Plus size={16} /> Proyek Baru
              </Link>
            </Button>
          </div>
        )
      ) : (
      <div className="overflow-hidden rounded-[18px] border border-[#ececee] bg-white">
        {projects && projects.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#ececee] bg-[#fafafa]">
                  <SortHeader column="name" label="Proyek" />
                  <th className="hidden px-6 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-[#71717a] sm:table-cell">
                    Klien
                  </th>
                  <th className="hidden px-6 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-[#71717a] lg:table-cell">
                    Tipe
                  </th>
                  <SortHeader column="shoot_date" label="Tgl Shoot" className="hidden lg:table-cell" />
                  <SortHeader column="status" label="Produksi" />
                  {financeVisible ? (
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-[#71717a]">
                      Finansial
                    </th>
                  ) : null}
                  <th className="px-6 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.1em] text-[#71717a]">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f4f4f5]">
                {projects.map((p) => {
                  const status = statusStyles[p.status as ProjectStatus] ?? statusStyles.draft;
                  const finance = financeVisible
                    ? p.is_fully_paid
                      ? { label: "Lunas", className: "bg-[#09090b] text-white border-[#09090b]" }
                      : p.is_dp_paid
                        ? { label: "DP Lunas", className: "bg-white text-[#18181b] border-[#d4d4d8]" }
                        : { label: "Belum DP", className: "bg-white text-[#c2410c] border-[#ff5a00]/40" }
                    : null;
                  return (
                    <tr key={p.id} className="group transition-colors hover:bg-[#fafafa]">
                      <td className="max-w-[260px] px-6 py-3">
                        <Link
                          href={`/admin/projects/${p.id}`}
                          className="block truncate font-medium text-[#09090b] underline-offset-4 group-hover:underline"
                          title={p.name}
                        >
                          {p.name}
                        </Link>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-[#a1a1aa]">{p.slug}</p>
                      </td>
                      <td className="hidden max-w-[180px] truncate px-6 py-3 text-[#52525b] sm:table-cell">
                        {customerMap[p.customer_id] ?? "—"}
                      </td>
                      <td className="hidden px-6 py-3 capitalize text-[#71717a] lg:table-cell">
                        {p.photography_type}
                      </td>
                      <td className="hidden whitespace-nowrap px-6 py-3 text-[#52525b] lg:table-cell">
                        {p.shoot_date ? (
                          new Date(p.shoot_date).toLocaleDateString("id-ID", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        ) : (
                          <span className="text-[#a1a1aa]">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${status.class}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      {finance ? (
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${finance.className}`}
                          >
                            {finance.label}
                          </span>
                        </td>
                      ) : null}
                      <td className="px-6 py-3">
                        {/*
                         * Labelled cluster replaces the unlabelled chevron. It
                         * stays visible on touch (no hover dependency) and
                         * reveals on hover for mouse users.
                         */}
                        <div className="flex items-center justify-end gap-1 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                          <Link
                            href={`/admin/projects/${p.id}`}
                            className="inline-flex min-h-9 items-center rounded-[8px] border border-[#ececee] px-2.5 text-[11px] font-semibold text-[#18181b] hover:bg-white"
                          >
                            Buka
                          </Link>
                          <Link
                            href={`/admin/projects/${p.id}?module=invoice`}
                            aria-label={`Kirim tagihan ${p.name} via WhatsApp`}
                            className="inline-flex min-h-9 items-center rounded-[8px] bg-[#09090b] px-2.5 text-[11px] font-semibold text-white hover:bg-[#27272a]"
                          >
                            Tagih
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-16 text-center">
            <FolderKanban size={32} className="mx-auto mb-3 text-[#a1a1aa]" aria-hidden="true" />
            <p className="mb-1 font-medium">Belum ada proyek</p>
            <p className="mb-6 text-sm text-muted-foreground">
              Buat proyek pertama untuk mulai membagikan galeri ke klien.
            </p>
            <Button asChild size="sm">
              <Link href="/admin/projects/new">
                <Plus size={16} /> Proyek Baru
              </Link>
            </Button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
