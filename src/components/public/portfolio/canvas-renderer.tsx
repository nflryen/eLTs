import type { CSSProperties } from "react";
import { layoutToGridStyle, type LayoutDoc, type LayoutBlock } from "@/lib/portfolio/layout";

/**
 * Public renderer for a portfolio layout document.
 *
 * SAME JSON, SAME CSS GRID AS THE EDITOR
 * --------------------------------------
 * Coordinates are grid CELLS, so the only thing that differs between the 1440px
 * admin canvas and a 390px phone is the pixel width of a column. That is what
 * CSS Grid already resolves on its own — which is why "what the team arranges is
 * what ships" with no second implementation to keep in step.
 *
 * NOT A CLIENT COMPONENT. There is no state, no pointer handling and no
 * hydration cost: this is static markup derived from the row that was just read.
 * Marking it `"use client"` would ship the geometry module to the browser for
 * nothing.
 */

/**
 * Placement for one block, as inline styles rather than Tailwind classes.
 *
 * The values are computed per block at render time, so they cannot be
 * utilities — `gridColumn: "4 / span 6"` is not a class name Tailwind can see.
 */
function blockStyle(block: LayoutBlock): CSSProperties {
  return layoutToGridStyle(block);
}

/**
 * Media resolution.
 *
 * `publicUrl` is the only source a public page may use. `public.media` is
 * RLS-gated to rank >= 60 and its preview route demands a client gallery
 * cookie, so a `mediaId` here would 401 for every anonymous visitor — and
 * relaxing that gate to make portfolios work would expose every client's
 * private gallery. An operator therefore pastes an already-public delivery URL
 * (Cloudinary) into the block.
 *
 * `mediaId` is still honoured for staff preview but is NOT a public fallback.
 * A block with no resolvable source renders an honest placeholder rather than a
 * broken image.
 */
function PhotoBlock({ block }: { block: LayoutBlock }) {
  if (!block.publicUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#f4f4f5] text-[11px] uppercase tracking-[0.18em] text-[#a1a1aa]">
        No image
      </div>
    );
  }

  // Desktop framing
  const dPosX = typeof block.cropX === "number" ? `${block.cropX}%` : "50%";
  const dPosY = typeof block.cropY === "number" ? `${block.cropY}%` : "50%";
  const dZoom = typeof block.zoom === "number" && block.zoom > 1 ? block.zoom : 1;
  const dFit = block.fit === "contain" ? "contain" : "cover";

  // Mobile framing (falls back to desktop framing if unset)
  const mPosX = typeof block.mobileCropX === "number" ? `${block.mobileCropX}%` : dPosX;
  const mPosY = typeof block.mobileCropY === "number" ? `${block.mobileCropY}%` : dPosY;
  const mZoom = typeof block.mobileZoom === "number" && block.mobileZoom > 1 ? block.mobileZoom : dZoom;
  const mFit = (block.mobileFit ?? block.fit) === "contain" ? "contain" : "cover";

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Desktop viewport: renders with desktop framing */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={block.publicUrl}
        alt=""
        loading="lazy"
        className="hidden md:block h-full w-full"
        style={{
          objectFit: dFit,
          objectPosition: `${dPosX} ${dPosY}`,
          transform: dZoom > 1 ? `scale(${dZoom})` : undefined,
          transformOrigin: `${dPosX} ${dPosY}`,
        }}
      />
      {/* Mobile viewport: renders with independent mobile framing */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={block.publicUrl}
        alt=""
        loading="lazy"
        className="block md:hidden h-full w-full"
        style={{
          objectFit: mFit,
          objectPosition: `${mPosX} ${mPosY}`,
          transform: mZoom > 1 ? `scale(${mZoom})` : undefined,
          transformOrigin: `${mPosX} ${mPosY}`,
        }}
      />
    </div>
  );
}

function TextBlock({ block }: { block: LayoutBlock }) {
  /*
   * Rendered as markup on purpose: a rich-text block that flattened its HTML to
   * text would lose the headings and emphasis the operator authored. The trust
   * boundary is the write path — `requireOps()` (rank >= 80) gates the action
   * and the RLS policy in 0026 gates the row — not this renderer.
   */
  return (
    <div
      className="h-full w-full text-[15px] leading-relaxed text-[#3f3f46] [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:tracking-tight [&_h3]:font-serif [&_h3]:text-xl [&_h3]:tracking-tight [&_p]:mt-3"
      dangerouslySetInnerHTML={{ __html: block.html ?? "" }}
    />
  );
}

/**
 * Public canvas renderer.
 * Strictly adheres to the authored 12-column grid geometry across all viewports
 * so multi-column compositions, triptychs, and side-by-side photos designed in
 * the editor render with high fidelity on both desktop and mobile.
 */
export function CanvasRenderer({ layout }: { layout: LayoutDoc }) {
  const { cols, rows } = layout.grid;

  /*
   * Paint order is `z`, not array order: two blocks may share a cell (that is how
   * a caption sits over a photo), and the operator's z decides which is on top.
   * Sorting a COPY — mutating the prop would corrupt the caller's document.
   */
  const ordered = [...layout.blocks].sort((a, b) => a.z - b.z);

  return (
    <div
      className="relative grid w-full"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        gap: "clamp(6px, 1.5vw, 12px)",
        minHeight: `clamp(240px, ${rows * 7}vw, ${rows * 120}px)`,
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
  );
}
