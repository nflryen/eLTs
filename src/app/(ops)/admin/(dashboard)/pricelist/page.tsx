import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requirePageOps } from "@/lib/auth/roles";
import {
  listAddons,
  listCategories,
  listPackageLeadCounts,
  listPackages,
} from "@/app/actions/admin-pricelist";
import { PricelistCms } from "@/components/admin/pricelist/pricelist-cms";

export const metadata: Metadata = {
  title: "Pricelist CMS — Elts.",
  robots: { index: false, follow: false },
};

/**
 * Pricelist CMS.
 *
 * Gated at ADMIN (80), matching the RLS write policy in 0025. The page guard
 * redirects; the database refuses independently — a caller who bypasses this
 * screen still cannot write a price.
 *
 * No `dynamic` export: `(dashboard)/layout.tsx` already forces dynamic for
 * every admin route, and repeating it here would imply this page has a caching
 * problem the rest of the admin does not.
 */

export default async function PricelistAdminPage() {
  await requirePageOps("/admin/pricelist");

  /*
   * Four reads, run concurrently. `listPackageLeadCounts` is only needed to
   * explain a refused delete, but it is cheap (one column over the inquiry
   * table) and fetching it inline avoids a waterfall on a screen the operator
   * opens to change a price in a hurry.
   */
  const [categories, packages, addons, leadCounts] = await Promise.all([
    listCategories(),
    listPackages(),
    listAddons(),
    listPackageLeadCounts(),
  ]);

  const packageCounts: Record<string, number> = {};
  for (const pkg of packages) {
    packageCounts[pkg.category_id] = (packageCounts[pkg.category_id] ?? 0) + 1;
  }

  const archivedCount =
    categories.filter((row) => !row.is_active).length +
    packages.filter((row) => !row.is_active).length +
    addons.filter((row) => !row.is_active).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-ash">
            Marketing
          </p>
          <h1 className="mt-1 text-xl font-semibold text-graphite">Pricelist CMS</h1>
          <p className="mt-1 max-w-2xl text-sm text-fog">
            Harga yang tersimpan di sini adalah harga yang dilihat klien di halaman
            publik. Setiap perubahan langsung menggantikan angka lama — tidak perlu
            deploy ulang.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/pricelist"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[14px] border border-cloud bg-snow px-3 py-2 text-xs font-medium text-iron transition-colors hover:bg-paper"
          >
            <ExternalLink size={13} /> Lihat halaman publik
          </Link>
        </div>
      </header>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Kategori" value={categories.length} />
        <Stat label="Paket" value={packages.length} />
        <Stat label="Add-on" value={addons.length} />
        <Stat
          label="Diarsipkan"
          value={archivedCount}
          hint={archivedCount > 0 ? "tidak tampil di /pricelist" : undefined}
        />
      </div>

      <PricelistCms
        categories={categories}
        packages={packages}
        addons={addons}
        packageCounts={packageCounts}
        leadCounts={leadCounts}
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-[14px] border border-cloud bg-snow px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ash">{label}</p>
      <p className="text-lg font-semibold text-graphite">{value}</p>
      {hint ? <p className="text-[10px] text-ember">{hint}</p> : null}
    </div>
  );
}
