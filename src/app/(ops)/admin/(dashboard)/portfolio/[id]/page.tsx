import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageOps } from "@/lib/auth/roles";
import { getPortfolioPage } from "@/app/actions/portfolio";
import { LayoutEditor } from "@/components/admin/portfolio/layout-editor";

export const metadata: Metadata = {
  title: "Editor Portofolio — Elts.",
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PortfolioEditorPage({ params }: Props) {
  await requirePageOps("/admin/portfolio");
  const { id } = await params;
  const bundle = await getPortfolioPage(id);

  if (!bundle) notFound();

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1aa]">
            Editor Portofolio
          </p>
          <h1 className="mt-1 text-xl font-semibold text-[#18181b]">{bundle.page.title}</h1>
          <p className="mt-0.5 font-mono text-xs text-[#71717a]">/portfolio/{bundle.page.slug}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
            bundle.page.status === "published"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          {bundle.page.status === "published" ? "Terbit" : "Draf"}
        </span>
      </header>

      <LayoutEditor
        pageId={bundle.page.id}
        slug={bundle.page.slug}
        title={bundle.page.title}
        status={bundle.page.status}
        category={bundle.page.category}
        tags={bundle.page.tags}
        coverUrl={bundle.page.cover_url}
        sections={bundle.sections.map((s) => ({ id: s.id, layout: s.layout, sort_order: s.sort_order }))}
      />
    </div>
  );
}
