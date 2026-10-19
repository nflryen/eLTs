import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireOps } from "@/lib/auth/roles";
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
  await requireOps();

  const data = await loadWorkspace(id);
  if (!data) notFound();

  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#71717a]">Memuat workspace…</div>}>
      <ProjectConsole data={data} />
    </Suspense>
  );
}
