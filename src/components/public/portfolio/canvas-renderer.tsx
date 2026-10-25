"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Expand } from "lucide-react";
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

function PhotoBlock({
  block,
  onClick,
}: {
  block: LayoutBlock;
  onClick?: () => void;
}) {
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

  const imageElement = (
    <div className="group relative h-full w-full overflow-hidden bg-[#f4f4f5]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={block.publicUrl}
        alt=""
        loading="lazy"
        draggable={false}
        className="h-full w-full select-none transition-transform duration-500 ease-out group-hover:scale-105"
        style={{
          objectFit: fit,
          objectPosition: `${posX} ${posY}`,
          transform: zoom > 1 ? `scale(${zoom})` : undefined,
          transformOrigin: `${posX} ${posY}`,
        }}
      />
      {onClick && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-300 group-hover:bg-black/20">
          <div className="rounded-full bg-black/50 p-2.5 text-white opacity-0 backdrop-blur-xs transition-all duration-300 group-hover:opacity-100 group-hover:scale-105 shadow-md">
            <Expand size={16} />
          </div>
        </div>
      )}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Buka foto layar penuh"
        className="block h-full w-full text-left cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090b]"
      >
        {imageElement}
      </button>
    );
  }

  return imageElement;
}

function TextBlock({ block }: { block: LayoutBlock }) {
  return (
    <div
      className="h-full w-full overflow-hidden p-3 text-[14px] leading-relaxed text-[#3f3f46] [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h3]:text-xl [&_h3]:font-bold [&_h3]:tracking-tight [&_p]:mt-2"
      dangerouslySetInnerHTML={{ __html: block.html ?? "" }}
    />
  );
}

export function CanvasRenderer({
  layout,
  onPhotoClick,
}: {
  layout: LayoutDoc;
  onPhotoClick?: (block: LayoutBlock) => void;
}) {
  const { cols, rows } = layout.grid;
  const ordered = [...layout.blocks].sort((a, b) => a.z - b.z);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number>(1);

  // Exact unscaled height based on the editor's design geometry
  const designHeight = rows * ROW_PX + (rows - 1) * CELL_GAP + CANVAS_PAD * 2;

  useEffect(() => {
    function computeScale() {
      if (!containerRef.current) return;
      const currentWidth = containerRef.current.clientWidth;
      if (currentWidth > 0) {
        setScale(Math.min(1, currentWidth / DESIGN_WIDTH));
      }
    }

    computeScale();

    // ResizeObserver watches fluid container changes on viewport resize or split-screen
    const ro = new ResizeObserver(() => computeScale());
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", computeScale);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", computeScale);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-[1200px] mx-auto overflow-hidden"
      style={{
        aspectRatio: `${DESIGN_WIDTH} / ${designHeight}`,
      }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: DESIGN_WIDTH,
          height: designHeight,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <div
          className="relative w-full h-full"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, ${ROW_PX}px)`,
            gap: `${CELL_GAP}px`,
            padding: `${CANVAS_PAD}px`,
            boxSizing: "border-box",
          }}
        >
          {ordered.map((block) => (
            <div
              key={block.id}
              style={blockStyle(block)}
              className="relative min-w-0 min-h-0 overflow-hidden rounded-[8px]"
            >
              {block.type === "photo" ? (
                <PhotoBlock
                  block={block}
                  onClick={onPhotoClick ? () => onPhotoClick(block) : undefined}
                />
              ) : (
                <TextBlock block={block} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
