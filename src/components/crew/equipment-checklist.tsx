"use client";

import { useState } from "react";
import { Camera, Check, Wrench, ShieldCheck } from "lucide-react";

interface EquipmentChecklistProps {
  allocatedEquipment: string[];
}

export function EquipmentChecklist({
  allocatedEquipment,
}: EquipmentChecklistProps) {
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

  const toggleItem = (item: string) => {
    setCheckedItems((prev) => ({
      ...prev,
      [item]: !prev[item],
    }));
  };

  const totalCount = allocatedEquipment.length;
  const readyCount = allocatedEquipment.filter((item) => checkedItems[item]).length;
  const isAllReady = totalCount > 0 && readyCount === totalCount;

  return (
    <div className="bg-card border border-border rounded-xl p-6 sm:p-7 shadow-sm">
      <div className="flex items-center justify-between border-b border-border/80 pb-4 mb-5">
        <div className="flex items-center gap-2.5 text-xs font-semibold tracking-wider uppercase text-muted-foreground">
          <Camera className="size-4 text-foreground" />
          <span>Stasiun Peralatan & Gear Loadout</span>
        </div>
        {totalCount > 0 && (
          <span
            className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
              isAllReady
                ? "bg-[#09090b]/5 text-[#09090b] border border-[#09090b]/25"
                : "bg-secondary text-foreground"
            }`}
          >
            {readyCount} / {totalCount} Siap
          </span>
        )}
      </div>

      {totalCount === 0 ? (
        <div className="py-8 text-center text-muted-foreground border border-dashed border-border rounded-lg bg-secondary/20">
          <Wrench className="size-8 mx-auto mb-2 opacity-40 text-muted-foreground" />
          <p className="text-xs font-medium text-foreground">
            Tidak Ada Alokasi Gear Khusus
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Kru membawa standar personal kit sesuai role title.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs text-muted-foreground mb-3">
            Centang setiap perangkat keras sebelum berangkat untuk memastikan tidak ada aksesoris atau baterai yang tertinggal.
          </p>

          <div className="space-y-2">
            {allocatedEquipment.map((item, idx) => {
              const isChecked = !!checkedItems[item];
              return (
                <button
                  key={`${item}-${idx}`}
                  type="button"
                  onClick={() => toggleItem(item)}
                  className={`w-full text-left p-3.5 min-h-11 rounded-lg border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                    isChecked
                      ? "bg-[#09090b]/5 border-[#09090b]/25 text-[#09090b]"
                      : "bg-secondary/30 border-border/70 hover:border-border hover:bg-secondary/50 text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`size-5 rounded flex items-center justify-center shrink-0 transition-colors border ${
                        isChecked
                          ? "bg-[#09090b] border-[#09090b] text-white"
                          : "border-border bg-background"
                      }`}
                    >
                      {isChecked && <Check className="size-3.5 stroke-[2.5]" />}
                    </div>
                    <span
                      className={`text-xs font-medium leading-relaxed truncate ${
                        isChecked ? "line-through text-muted-foreground" : ""
                      }`}
                    >
                      {item}
                    </span>
                  </div>

                  <span
                    className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded shrink-0 ${
                      isChecked
                        ? "bg-[#09090b]/10 text-[#09090b]"
                        : "bg-background border border-border text-muted-foreground"
                    }`}
                  >
                    {isChecked ? "Ready" : "Check"}
                  </span>
                </button>
              );
            })}
          </div>

          {isAllReady && (
            <div className="mt-4 p-3 rounded-lg bg-[#09090b]/5 border border-[#09090b]/25 flex items-center gap-2 text-[#09090b] text-xs">
              <ShieldCheck className="size-4 shrink-0 text-[#09090b]" />
              <span>Semua perlengkapan telah diperiksa dan siap untuk operasional produksi.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
