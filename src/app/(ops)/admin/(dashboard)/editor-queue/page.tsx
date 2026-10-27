import Link from "next/link";
import { requirePageStaff } from "@/lib/auth/roles";
import { CompensationKpiCards } from "@/components/admin/payroll/compensation-kpi-cards";
import { Clock, ChevronRight, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type {
  ProjectRow,
  CustomerRow,
  EditorTaskRow,
  EditorTaskStatus,
} from "@/types/database";
import {
  ManifestExportButton,
  type ManifestItem,
} from "@/components/admin/manifest-export-button";

export const metadata = {
  title: "Antrean Editor — Studio OS",
};

const editorStatusStyles: Record<
  EditorTaskStatus,
  { label: string; class: string }
> = {
  PENDING: {
    label: "Pending",
    class: "bg-[#ff5a00]/10 text-[#ff5a00] border border-[#ff5a00]/40",
  },
  IN_PROGRESS: {
    label: "In Progress",
    class: "bg-[#fafafa] text-[#3f3f46] border border-[#ececee]",
  },
  REVIEW: {
    label: "Review",
    class: "bg-[#fafafa] text-[#3f3f46] border border-[#ececee]",
  },
  COMPLETED: {
    label: "Completed",
    class: "bg-[#09090b] text-white border border-[#09090b]",
  },
};

export default async function EditorQueuePage() {
  /*
   * Post-production is a WORKER surface (layout.tsx, "Operate"), so it gates at
   * STAFF (60), not OPS (80). The previous `requireOps()` contradicted the nav,
   * which offered this link to every WORKER and then answered with a 500.
   *
   * Nothing financial is projected: `editor_tasks` is read through RLS, whose
   * `editor_tasks_worker_self` policy scopes a WORKER to their own assigned row.
   */
  const { supabase } = await requirePageStaff();

  /*
   * Personal compensation KPI for the WORKER.
   *
   * Fetched through `my_earnings_summary()`, a zero-argument RPC scoped to
   * `auth.uid()`. Deliberately NOT the payroll rollup: an editor must not be
   * able to infer a colleague's rate from an aggregate. A failure here must not
   * blank the queue, so it degrades to null and the card is simply omitted.
   */
  const { getMyEarnings } = await import("@/app/actions/payroll");
  const mine = await getMyEarnings().catch(() => null);

  // 1. Fetch editor tasks
  const { data: editorTasksData } = await supabase
    .from("editor_tasks")
    .select("*")
    .order("created_at", { ascending: false });

  const editorTasks = (editorTasksData ?? []) as EditorTaskRow[];
  const taskProjectIds = editorTasks.map((t) => t.project_id);

  // 2. Fetch locked projects or projects with editor tasks
  const { data: lockedProjectsData } = await supabase
    .from("projects")
    .select(
      "id, name, slug, photography_type, status, selection_locked_at, selection_quota_min, selection_quota_max, customer_id, created_at"
    )
    .not("selection_locked_at", "is", null);

  const lockedProjects = (lockedProjectsData ?? []) as ProjectRow[];
  const projectMap = new Map<string, ProjectRow>();
  for (const p of lockedProjects) {
    projectMap.set(p.id, p);
  }

  const missingIds = taskProjectIds.filter((id) => !projectMap.has(id));
  if (missingIds.length > 0) {
    const { data: extraProjects } = await supabase
      .from("projects")
      .select(
        "id, name, slug, photography_type, status, selection_locked_at, selection_quota_min, selection_quota_max, customer_id, created_at"
      )
      .in("id", missingIds);
    for (const p of (extraProjects ?? []) as ProjectRow[]) {
      projectMap.set(p.id, p);
    }
  }

  const projects = Array.from(projectMap.values()).sort((a, b) => {
    const dateA = a.selection_locked_at
      ? new Date(a.selection_locked_at).getTime()
      : new Date(a.created_at).getTime();
    const dateB = b.selection_locked_at
      ? new Date(b.selection_locked_at).getTime()
      : new Date(b.created_at).getTime();
    return dateB - dateA;
  });

  // 3. Fetch customer names
  const customerIds = [...new Set(projects.map((p) => p.customer_id))];
  const { data: customersData } =
    customerIds.length > 0
      ? await supabase.from("customers").select("id, name").in("id", customerIds)
      : { data: [] };

  const customerMap = Object.fromEntries(
    (customersData as Pick<CustomerRow, "id" | "name">[] | null ?? []).map(
      (c) => [c.id, c.name]
    )
  );

  // 4. Map editor tasks by project_id
  const taskByProjectId = new Map<string, EditorTaskRow>();
  for (const t of editorTasks) {
    if (!taskByProjectId.has(t.project_id)) {
      taskByProjectId.set(t.project_id, t);
    }
  }

  // 5. Query favorites & media fallback for projects lacking manifest_json
  const projectIds = projects.map((p) => p.id);
  const { data: favoritesData } =
    projectIds.length > 0
      ? await supabase
          .from("favorites")
          .select("project_id, media_id")
          .in("project_id", projectIds)
      : { data: [] };

  const favMediaIds = [
    ...new Set(
      ((favoritesData ?? []) as { project_id: string; media_id: string }[]).map(
        (f) => f.media_id
      )
    ),
  ];

  const { data: mediaData } =
    favMediaIds.length > 0
      ? await supabase
          .from("media")
          .select("id, file_name, original_key, mime_type, storage_provider")
          .in("id", favMediaIds)
      : { data: [] };

  const mediaById = new Map<
    string,
    {
      id: string;
      file_name: string;
      original_key: string;
      mime_type: string;
      storage_provider: string;
    }
  >();
  for (const m of (mediaData ?? []) as {
    id: string;
    file_name: string;
    original_key: string;
    mime_type: string;
    storage_provider: string;
  }[]) {
    mediaById.set(m.id, m);
  }

  const favoritesByProjectId = new Map<string, ManifestItem[]>();
  for (const fav of (favoritesData ?? []) as {
    project_id: string;
    media_id: string;
  }[]) {
    const m = mediaById.get(fav.media_id);
    if (!favoritesByProjectId.has(fav.project_id)) {
      favoritesByProjectId.set(fav.project_id, []);
    }
    if (m) {
      favoritesByProjectId.get(fav.project_id)!.push({
        media_id: m.id,
        file_name: m.file_name,
        original_key: m.original_key,
        mime_type: m.mime_type,
        storage_provider: m.storage_provider,
      });
    }
  }

  // Summary counts
  let pendingCount = 0;
  let inProgressCount = 0;
  let completedCount = 0;

  for (const p of projects) {
    const t = taskByProjectId.get(p.id);
    const status: EditorTaskStatus = t?.status ?? "PENDING";
    if (status === "PENDING") pendingCount++;
    else if (status === "IN_PROGRESS" || status === "REVIEW") inProgressCount++;
    else if (status === "COMPLETED") completedCount++;
  }

  return (
    <div className="max-w-5xl">
      {/*
        Personal earnings sit ABOVE the queue, per spec. No project-wide or
        colleague figures are loaded on this page at all.
      */}
      {mine ? (
        <div className="mb-5">
          <CompensationKpiCards
            data={{
              pendingPayout: mine.pendingPayout,
              pendingCount: mine.pendingCount + mine.awaitingVerificationCount,
              currentMonthPayout: mine.currentMonthPayout,
            }}
          />
        </div>
      ) : null}

      {/* Page Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="eyebrow mb-2">Post-Production</p>
          <h1 className="font-serif text-3xl font-bold">Antrean Editor</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Proyek dengan pilihan foto terkunci yang menunggu kurasi dan penyuntingan.
          </p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Menunggu Editing", value: pendingCount },
          { label: "Sedang Diproses / Review", value: inProgressCount },
          { label: "Selesai", value: completedCount },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white border border-border rounded-lg p-5 shadow-sm"
          >
            <p className="text-2xl font-semibold">{stat.value}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Queue Table */}
      <div className="bg-white border border-border rounded-lg overflow-hidden shadow-sm">
        {projects.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-[#fafafa]">
                <th className="text-left font-medium text-muted-foreground px-6 py-3">
                  Project
                </th>
                <th className="text-left font-medium text-muted-foreground px-6 py-3 hidden sm:table-cell">
                  Customer
                </th>
                <th className="text-left font-medium text-muted-foreground px-6 py-3">
                  Deliverables
                </th>
                <th className="text-left font-medium text-muted-foreground px-6 py-3 hidden md:table-cell">
                  Locked Date
                </th>
                <th className="text-left font-medium text-muted-foreground px-6 py-3">
                  Editor Status
                </th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {projects.map((p) => {
                const task = taskByProjectId.get(p.id);
                let manifest: ManifestItem[] = [];
                if (task?.manifest_json && Array.isArray(task.manifest_json)) {
                  manifest = task.manifest_json as ManifestItem[];
                } else if (favoritesByProjectId.has(p.id)) {
                  manifest = favoritesByProjectId.get(p.id)!;
                }

                const filenames = manifest
                  .map((item) => item.file_name)
                  .filter((n): n is string => Boolean(n));

                const deliverableCount =
                  task?.deliverable_count ||
                  filenames.length ||
                  p.selection_quota_max ||
                  0;

                const editorStatus: EditorTaskStatus = task?.status ?? "PENDING";
                const statusStyle =
                  editorStatusStyles[editorStatus] || editorStatusStyles.PENDING;

                return (
                  <tr key={p.id} className="hover:bg-[#fafafa] transition-colors">
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/projects/${p.id}`}
                        className="block group"
                      >
                        <p className="font-medium group-hover:underline underline-offset-4">
                          {p.name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {p.slug} • {p.photography_type}
                        </p>
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground hidden sm:table-cell">
                      {customerMap[p.customer_id] ?? "—"}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-[#09090b]">
                        {deliverableCount}
                      </span>{" "}
                      <span className="text-xs text-muted-foreground">
                        photos (max {p.selection_quota_max || 20})
                      </span>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground hidden md:table-cell">
                      {p.selection_locked_at ? (
                        <div>
                          <p className="font-medium text-[#3f3f46]">
                            {new Date(p.selection_locked_at).toLocaleDateString(
                              "id-ID",
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              }
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(p.selection_locked_at).toLocaleTimeString(
                              "id-ID",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}{" "}
                            WIB
                          </p>
                        </div>
                      ) : (
                        <span className="text-[#a1a1aa]">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle.class}`}
                      >
                        {statusStyle.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <ManifestExportButton
                          projectName={p.name}
                          projectSlug={p.slug}
                          filenames={filenames}
                          manifest={manifest}
                        />
                        <Button asChild size="sm" variant="ghost">
                          <Link
                            href={`/admin/projects/${p.id}`}
                            className="inline-flex p-2.5 min-h-11 min-w-11 items-center justify-center text-fog hover:text-foreground"
                          >
                            <ChevronRight size={16} />
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState
            icon={<Clock size={28} />}
            title="Belum ada proyek dalam antrean editing"
            description="Proyek muncul di sini secara otomatis setelah klien mengunci pilihan fotonya. Selama antrean kosong, tidak ada pekerjaan pasca-produksi yang menunggu."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/projects">
                  <FolderKanban size={16} className="mr-1.5" /> Lihat Proyek
                </Link>
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
