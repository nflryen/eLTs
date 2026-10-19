import type { Metadata } from "next";
import { requireOps } from "@/lib/auth/roles";
import { getInventoryAssets } from "@/app/actions/admin-inventory";
import { InventoryDirectoryClient } from "@/components/admin/inventory/inventory-directory-client";

export const metadata: Metadata = {
  title: "Master Inventory & Equipment Hub - Elts. Admin",
  description: "Manajemen katalog aset hardware, studio in-house kits, partner-owned, dan vendor sewa rental Banyumas.",
  robots: { index: false, follow: false },
};

export default async function InventoryPage() {
  await requireOps();

  const assetsResult = await getInventoryAssets();
  const initialAssets = assetsResult.assets || [];

  return (
    <div className="max-w-7xl mx-auto py-2">
      <InventoryDirectoryClient initialAssets={initialAssets} />
    </div>
  );
}
