import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requirePageStaff } from "@/lib/auth/roles";
import { loadWorkspace } from "@/lib/workspace";
import { ProjectConsole } from "@/components/admin/workspace/project-console";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const data = await loadWorkspace(id);
  return {
    title: data ? `${data.project.name} — Studio OS` : "Proyek — Studio OS",
    robots: { index: false, follow: false },
  };
}

/**
 * Project Console route.
 *
 * Server component: loads the whole workspace payload once, then hands it to the
 * client console. No column fallbacks, no synthetic values — the consolidated
 * schema (0001) is the single source of truth, so an unset field renders as an
 * honest empty state rather than an invented number.
 */
export default async function ProjectConsolePage({ params }: Props) {
  const { id } = await params;
  /*
   * STAFF (60), matching `loadWorkspace()`'s own `requireStaff()` gate and the
   * nav, which offers Proyek to every WORKER. `requireOps()` here alone turned a
   * WORKER's project link into a 500.
   *
   * The console prunes Money tabs from the rank passed below, and `loadWorkspace`
   * selects money columns conditionally, so a WORKER's payload never contains
   * fees or invoice totals to begin with.
   */
  const { rank } = await requirePageStaff();

  const data = await loadWorkspace(id);
  if (!data) notFound();

  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#71717a]">Memuat workspace…</div>}>
      <ProjectConsole data={data} rank={rank} />
    </Suspense>
  );
}
