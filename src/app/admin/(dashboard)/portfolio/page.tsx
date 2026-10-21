import type { Metadata } from "next";
import { requirePageOps } from "@/lib/auth/roles";
import { listPortfolioPages } from "@/app/actions/portfolio";
import { PortfolioPageList } from "@/components/admin/portfolio/page-list";

export const metadata: Metadata = {
  title: "Portofolio & CMS — Elts.",
  robots: { index: false, follow: false },
};

/**
 * Portfolio CMS index.
 *
 * Gated at ADMIN (80), matching the RLS write policy on portfolio_pages. The
 * page guard redirects; the database refuses independently — a draft portfolio
 * cannot be published by a caller who bypasses the UI.
 */
export default async function PortfolioAdminPage() {
  await requirePageOps("/admin/portfolio");
  const pages = await listPortfolioPages();

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1aa]">
          Marketing
        </p>
        <h1 className="mt-1 text-xl font-semibold text-[#18181b]">Portofolio & CMS</h1>
        <p className="mt-1 text-sm text-[#71717a]">
          Susun halaman portofolio dengan editor grid, lalu publikasikan ke situs publik.
        </p>
      </header>

      <PortfolioPageList pages={pages} />
    </div>
  );
}
