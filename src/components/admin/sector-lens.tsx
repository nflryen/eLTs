"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Radio, Video, Camera } from "lucide-react";
import { setSectorLens } from "@/app/actions/sector-lens";
import { SECTORS, type SectorId } from "@/lib/sector-lens";

const ICONS: Record<SectorId, React.ReactNode> = {
  ALL: <Layers size={13} />,
  BROADCAST_LIVE_STREAMING: <Radio size={13} />,
  COMMERCIAL_VIDEO: <Video size={13} />,
  EVENT_GRADUATION_PHOTO: <Camera size={13} />,
};

/**
 * Sector lens selector.
 *
 * Horizontally scrollable with snap so it never overflows on a phone, and every
 * target clears 44px. Tapping persists the choice to a cookie and refreshes the
 * server data — one tap, remembered forever.
 */
export function SectorLens({ active }: { active: SectorId }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const select = (id: SectorId) => {
    if (id === active) return;
    startTransition(async () => {
      await setSectorLens(id);
      router.refresh();
    });
  };

  return (
    <div
      role="tablist"
      aria-label="Filter sektor"
      className="no-scrollbar -mx-1 flex snap-x snap-mandatory items-center gap-1.5 overflow-x-auto px-1 py-1"
    >
      {SECTORS.map((sector) => {
        const isActive = sector.id === active;
        return (
          <button
            key={sector.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => select(sector.id)}
            className={`flex h-11 shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-[10000px] px-3.5 text-xs font-semibold transition-colors cursor-pointer ${
              isActive
                ? "bg-[#09090b] text-white"
                : "border border-[#ececee] bg-white text-[#3f3f46] hover:bg-[#fafafa]"
            } ${isPending && isActive ? "opacity-70" : ""}`}
          >
            {ICONS[sector.id]}
            <span className="hidden sm:inline">{sector.label}</span>
            <span className="sm:hidden">{sector.short}</span>
          </button>
        );
      })}
    </div>
  );
}
