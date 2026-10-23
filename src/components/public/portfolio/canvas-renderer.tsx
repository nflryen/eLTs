"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { layoutToGridStyle, type LayoutDoc, type LayoutBlock } from "@/lib/portfolio/layout";

/**
 * Public renderer for a portfolio layout document.
 *
 * EXACT PROPORTIONAL SCALING ARCHITECTURE
 * ---------------------------------------
 * The authored canvas is designed on a 1200px 12-column grid system with 12px gaps
 * and 70px rows.
 *
 * To ensure that the public render on ANY screen (from a 390px phone to a 4K monitor)
 * strictly preserves the exact grid layout, positioning, multi-column arrangement, and
 * image framing authored in the editor, we use proportional container scaling:
 *
 *   1. The container has an unscaled design width of 1200px.
 *   2. For any container width W < 1200px, scale = W / 1200.
 *   3. The container's height is designHeight * scale.
 *   4. CSS `aspectRatio: 1200 / designHeight` ensures zero Cumulative Layout Shift (CLS = 0)
 *      even during initial server-side rendering before hydration.
 *   5. Cell aspect ratios and image cropping parameters (cropX, cropY, fit, zoom) are
 *      preserved 100% identically between the editor and public render without any
 *      unexpected clipping or forced stacking.
 */

const DESIGN_WIDTH = 1200;
const CELL_GAP = 12;
const ROW_PX = 70;
const CANVAS_PAD = 12;

function blockStyle(block: LayoutBlock): CSSProperties {
  return layoutToGridStyle(block);
}

function PhotoBlock({ block }: { block: LayoutBlock }) {
  if (!block.publicUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#f4f4f5] text-[11px] uppercase tracking-[0.18em] text-[#a1a1aa]">
        No image
      </div>
    );
  }

  // Consistent framing matching the editor canvas
  const posX = typeof block.cropX === "number" ? `${block.cropX}%` : "50%";
  const posY = typeof block.cropY === "number" ? `${block.cropY}%` : "50%";
  const zoom = typeof block.zoom === "number" && block.zoom > 1 ? block.zoom : 1;
  const fit = block.fit === "contain" ? "contain" : "cover";

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#f4f4f5]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={block.publicUrl}
        alt=""
        loading="lazy"
        draggable={false}
        className="h-full w-full select-none"
        style={{
          objectFit: fit,
          objectPosition: `${posX} ${posY}`,
          transform: zoom > 1 ? `scale(${zoom})` : undefined,
          transformOrigin: `${posX} ${posY}`,
        }}
      />
    </div>
  );
}

function TextBlock({ block }: { block: LayoutBlock }) {
  return (
    <div
      className="h-full w-full overflow-hidden p-3 text-[14px] leading-relaxed text-[#3f3f46] [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h3]:text-xl [&_h3]:font-bold [&_h3]:tracking-tight [&_p]:mt-2"
      dangerouslySetInnerHTML={{ __html: block.html ?? "" }}
    />
  );
}

export function CanvasRenderer({ layout }: { layout: LayoutDoc }) {
  const { cols, rows } = layout.grid;
  const ordered = [...layout.blocks].sort((a, b) => a.z - b.z);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number>(1);

  // Exact unscaled height based on the editor's design geometry
  const designHeight = CANVAS_PAD * 2 + rows * ROW_PX + Math.max(0, rows - 1) * CELL_GAP;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateScale = () => {
      const containerWidth = el.clientWidth;
      if (containerWidth > 0 && containerWidth < DESIGN_WIDTH) {
        setScale(containerWidth / DESIGN_WIDTH);
      } else {
        setScale(1);
      }
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scaledHeight = scale < 1 ? Math.ceil(designHeight * scale) : designHeight;

  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-[1200px] mx-auto overflow-hidden"
      style={{
        height: `${scaledHeight}px`,
        // CSS aspect-ratio ensures 0 layout shift during SSR before hydration
        aspectRatio: `${DESIGN_WIDTH} / ${designHeight}`,
      }}
    >
      <div
        className="relative grid rounded-xl border border-[#ececee] bg-[#fafafa]"
        style={{
          width: `${DESIGN_WIDTH}px`,
          height: `${designHeight}px`,
          gap: `${CELL_GAP}px`,
          padding: `${CANVAS_PAD}px`,
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridAutoRows: `${ROW_PX}px`,
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: "top left",
        }}
      >
        {ordered.map((block) => (
          <div
            key={block.id}
            style={blockStyle(block)}
            className="relative overflow-hidden rounded-[8px]"
          >
            {block.type === "photo" ? <PhotoBlock block={block} /> : <TextBlock block={block} />}
          </div>
        ))}
      </div>
    </div>
  );
}
