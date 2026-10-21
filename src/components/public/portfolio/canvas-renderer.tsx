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

  return (
    // The layout cell is the sizing authority, so the image fills it. next/image
    // needs intrinsic dimensions a grid cell does not have.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={block.publicUrl}
      alt=""
      loading="lazy"
      className="h-full w-full"
      style={{ objectFit: block.fit === "contain" ? "contain" : "cover" }}
    />
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
 * The public canvas, rendered twice for two layouts.
 *
 * WHY BOTH A GRID AND A FLEX STACK ARE IN THE MARKUP
 * --------------------------------------------------
 * The authored grid is meaningless at 390px: a 6/12 block becomes 160px wide and
 * a photo in a 2-row cell becomes a letterbox slot. Collapsing to one column
 * would be expressible in Tailwind, but the *placement* of every block would
 * then need `md:` overrides whose values are computed per block — impossible in
 * class names. Emitting both trees and letting `md:` hide one keeps the styles
 * fully computed while still costing nothing: the hidden tree is not painted and
 * the DOM node count is small (a layout has a handful of blocks).
 *
 * Row height is a clamp so a tall grid does not become a 3000px wall, and
 * `minHeight` keeps the proportion of a layout whose last row is empty.
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
    <>
      <div
        className="hidden md:grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          gap: "12px",
          minHeight: `clamp(320px, ${rows * 9}vw, ${rows * 120}px)`,
        }}
      >
        {ordered.map((block) => (
          <div
            key={block.id}
            style={blockStyle(block)}
            className="relative overflow-hidden rounded-[6px]"
          >
            {block.type === "photo" ? <PhotoBlock block={block} /> : <TextBlock block={block} />}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4 md:hidden">
        {ordered.map((block) => (
          <div
            key={block.id}
            /*
             * Aspect ratio replaces the grid cell's height. Deriving it from the
             * authored w:h preserves the operator's intended shape on a phone
             * without clipping the block to a fixed pixel height.
             */
            style={
              block.type === "photo"
                ? { aspectRatio: `${Math.max(1, block.w)} / ${Math.max(1, block.h)}` }
                : undefined
            }
            className="relative overflow-hidden rounded-[6px]"
          >
            {block.type === "photo" ? <PhotoBlock block={block} /> : <TextBlock block={block} />}
          </div>
        ))}
      </div>
    </>
  );
}
