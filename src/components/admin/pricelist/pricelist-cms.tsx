"use client";

import { useState } from "react";
import type {
  PricelistAddonRow,
  PricelistCategoryRow,
  PricelistPackageRow,
} from "@/app/actions/admin-pricelist";
import { AddonPanel } from "@/components/admin/pricelist/addon-panel";
import { CategoryPanel } from "@/components/admin/pricelist/category-panel";
import { PackagePanel } from "@/components/admin/pricelist/package-panel";
import { cn } from "@/lib/utils";

type Tab = "categories" | "packages" | "addons";

/**
 * Tab shell for the three pricelist tables.
 *
 * WHY TABS AND NOT ONE SCROLLING PAGE
 * -----------------------------------
 * The three tables are edited in different rhythms: categories are structural
 * and rarely touched, packages are edited whenever a price changes, add-ons sit
 * between. Stacking all three means an operator scrolls past sixteen package
 * cards to reach the add-on they came for. Tabs keep each edit surface one click
 * from the header, and the counts on the tab labels answer "is my row in here?"
 * before the click.
 *
 * The panels are mounted only when selected — each holds its own form state, and
 * keeping three live draft forms would let an operator type into a hidden one.
 */
export function PricelistCms({
  categories,
  packages,
  addons,
  packageCounts,
  leadCounts,
}: {
  categories: PricelistCategoryRow[];
  packages: PricelistPackageRow[];
  addons: PricelistAddonRow[];
  packageCounts: Record<string, number>;
  leadCounts: Record<string, number>;
}) {
  const [tab, setTab] = useState<Tab>("packages");

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "categories", label: "Kategori", count: categories.length },
    { id: "packages", label: "Paket", count: packages.length },
    { id: "addons", label: "Add-on", count: addons.length },
  ];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Tabel pricelist"
        className="flex gap-1 rounded-[14px] border border-cloud bg-snow p-1"
      >
        {tabs.map((entry) => {
          const active = tab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`pricelist-panel-${entry.id}`}
              id={`pricelist-tab-${entry.id}`}
              onClick={() => setTab(entry.id)}
              className={cn(
                "flex-1 rounded-[12px] px-3 py-2 text-xs font-medium transition-colors",
                active
                  ? "bg-graphite text-snow"
                  : "text-fog hover:bg-paper hover:text-graphite",
              )}
            >
              {entry.label}
              <span className={cn("ml-1.5 text-[10px]", active ? "text-mist" : "text-ash")}>
                {entry.count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`pricelist-panel-${tab}`}
        aria-labelledby={`pricelist-tab-${tab}`}
      >
        {tab === "categories" ? (
          <CategoryPanel categories={categories} packageCounts={packageCounts} />
        ) : null}
        {tab === "packages" ? (
          <PackagePanel
            packages={packages}
            categories={categories}
            leadCounts={leadCounts}
          />
        ) : null}
        {tab === "addons" ? <AddonPanel addons={addons} /> : null}
      </div>
    </div>
  );
}
