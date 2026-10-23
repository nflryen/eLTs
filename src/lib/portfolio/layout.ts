/**
 * Portfolio layout geometry — PURE functions, no React, no database.
 *
 * WHY PURE AND SEPARATE
 * --------------------
 * The drag-and-drop editor is the part of the CMS most likely to produce a
 * corrupt layout: a resize that overshoots the grid, a move that goes negative,
 * a block with zero width. Those bugs are invisible in the editor (the block
 * just looks odd) and catastrophic on the public site (an overlapping or
 * off-canvas block). Keeping the geometry pure means it is unit-testable
 * without a browser, a pointer, or a database.
 *
 * The same functions are used by the editor and by any server-side clamp, so
 * there is no second implementation to drift.
 */

export const LAYOUT_VERSION = 1;
export const DEFAULT_COLS = 12;

export type BlockType = "photo" | "text";

export interface LayoutBlock {
  id: string;
  type: BlockType;
  /** Grid cell coordinates, NOT pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /**
   * Photo source. `publicUrl` is what the PUBLIC renderer uses.
   *
   * WHY NOT mediaId: `public.media` is RLS-gated to rank >= 60 and its preview
   * route requires a client gallery session, so a mediaId would 401 for every
   * anonymous visitor viewing a published page. Weakening that policy to make
   * portfolios work would expose every client's private gallery. Instead a
   * portfolio photo points at an already-public asset (Cloudinary delivery URL).
   *
   * `mediaId` is retained for internal reference/traceability only.
   */
  publicUrl?: string | null;
  mediaId?: string | null;
  fit?: "cover" | "contain";
  /** Object position X percentage (0-100), default 50 */
  cropX?: number;
  /** Object position Y percentage (0-100), default 50 */
  cropY?: number;
  /** Zoom scale multiplier (1.0 - 3.0), default 1.0 */
  zoom?: number;
  /** text only — sanitised by the caller before render */
  html?: string;
}

export interface LayoutGrid {
  cols: number;
  rows: number;
}

export interface LayoutDoc {
  version: number;
  grid: LayoutGrid;
  blocks: LayoutBlock[];
}

export const EMPTY_LAYOUT: LayoutDoc = {
  version: LAYOUT_VERSION,
  grid: { cols: DEFAULT_COLS, rows: 8 },
  blocks: [],
};

/** Clamps a number into [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Forces a block to sit inside the grid with a positive size.
 *
 * Every mutation below funnels through this, so an invalid block cannot be
 * produced even if a caller computes a bad delta (e.g. a fast pointer move
 * across the canvas, or a resize started at the right edge).
 */
export function clampBlock(block: LayoutBlock, grid: LayoutGrid): LayoutBlock {
  const w = clamp(Math.round(block.w), 1, grid.cols);
  const h = clamp(Math.round(block.h), 1, grid.rows);
  const x = clamp(Math.round(block.x), 0, grid.cols - w);
  const y = clamp(Math.round(block.y), 0, grid.rows - h);
  return { ...block, x, y, w, h };
}

/** Moves a block by a cell delta, clamped to the grid. */
export function moveBlock(
  block: LayoutBlock,
  dx: number,
  dy: number,
  grid: LayoutGrid,
): LayoutBlock {
  return clampBlock({ ...block, x: block.x + dx, y: block.y + dy }, grid);
}

/** Resizes a block by a cell delta, clamped to a 1x1 minimum and the grid edge. */
export function resizeBlock(
  block: LayoutBlock,
  dw: number,
  dh: number,
  grid: LayoutGrid,
): LayoutBlock {
  return clampBlock({ ...block, w: block.w + dw, h: block.h + dh }, grid);
}

/** Appends a block at the first free row, defaulting to half-width. */
export function addBlock(
  layout: LayoutDoc,
  init: {
    type: BlockType;
    publicUrl?: string | null;
    mediaId?: string | null;
    html?: string;
    cropX?: number;
    cropY?: number;
    zoom?: number;
    fit?: "cover" | "contain";
  },
): LayoutDoc {
  const cols = layout.grid.cols;
  const w = Math.max(1, Math.floor(cols / 2));
  const h = init.type === "photo" ? 4 : 2;

  /*
   * Place below every existing block rather than at 0,0.
   * Expand grid rows dynamically so new blocks never get squashed at the bottom.
   */
  const nextY = layout.blocks.reduce((max, b) => Math.max(max, b.y + b.h), 0);
  const updatedRows = Math.max(layout.grid.rows, nextY + h + 2, 8);
  const grid: LayoutGrid = { cols, rows: updatedRows };

  const block: LayoutBlock = clampBlock(
    {
      id: `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      type: init.type,
      x: 0,
      y: nextY,
      w,
      h,
      z: layout.blocks.length + 1,
      publicUrl: init.publicUrl ?? null,
      mediaId: init.mediaId ?? null,
      fit: init.fit ?? "cover",
      cropX: init.cropX ?? 50,
      cropY: init.cropY ?? 50,
      zoom: init.zoom ?? 1,
      ...(init.type === "text" ? { html: init.html ?? "" } : {}),
    },
    grid,
  );

  return { ...layout, grid, blocks: [...layout.blocks, block] };
}

/** Removes a block by id. Missing ids are a no-op, not an error. */
export function removeBlock(layout: LayoutDoc, id: string): LayoutDoc {
  return { ...layout, blocks: layout.blocks.filter((b) => b.id !== id) };
}

/** Replaces one block by id, clamping it to the grid. */
export function updateBlock(
  layout: LayoutDoc,
  id: string,
  patch: Partial<LayoutBlock>,
): LayoutDoc {
  return {
    ...layout,
    blocks: layout.blocks.map((b) =>
      b.id === id ? clampBlock({ ...b, ...patch, id: b.id }, layout.grid) : b,
    ),
  };
}

/**
 * Coerces untrusted JSON (from the database, or a client) into a LayoutDoc.
 *
 * The database trigger already rejects bad layouts on write, but data can also
 * arrive from an older row, a hand-edited JSONB column, or a future client. The
 * renderer must never receive a block it cannot draw, so this repairs rather
 * than throws: a portfolio page that loses one malformed block is much better
 * than a public page that 500s.
 */
export function normaliseLayout(raw: unknown): LayoutDoc {
  if (!raw || typeof raw !== "object") return { ...EMPTY_LAYOUT };

  const doc = raw as Partial<LayoutDoc>;
  const cols = clamp(
    Number.isFinite(Number(doc.grid?.cols)) ? Number(doc.grid!.cols) : DEFAULT_COLS,
    1,
    24,
  );
  const rows = clamp(
    Number.isFinite(Number(doc.grid?.rows)) ? Number(doc.grid!.rows) : 8,
    1,
    200,
  );
  const grid: LayoutGrid = { cols, rows };

  const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
  const safeBlocks: LayoutBlock[] = blocks
    .map((b, index) => {
      if (!b || typeof b !== "object") return null;
      const candidate = b as Partial<LayoutBlock>;
      const type: BlockType = candidate.type === "text" ? "text" : "photo";
      return clampBlock(
        {
          id: typeof candidate.id === "string" && candidate.id ? candidate.id : `b_recovered_${index}`,
          type,
          x: Number.isFinite(Number(candidate.x)) ? Number(candidate.x) : 0,
          y: Number.isFinite(Number(candidate.y)) ? Number(candidate.y) : index * 2,
          w: Number.isFinite(Number(candidate.w)) ? Number(candidate.w) : Math.floor(cols / 2),
          h: Number.isFinite(Number(candidate.h)) ? Number(candidate.h) : 2,
          z: Number.isFinite(Number(candidate.z)) ? Number(candidate.z) : index + 1,
          publicUrl: typeof candidate.publicUrl === "string" ? candidate.publicUrl : null,
          mediaId: typeof candidate.mediaId === "string" ? candidate.mediaId : null,
          fit: candidate.fit === "contain" ? "contain" : "cover",
          cropX: typeof candidate.cropX === "number" && Number.isFinite(candidate.cropX)
            ? clamp(Math.round(candidate.cropX), 0, 100)
            : 50,
          cropY: typeof candidate.cropY === "number" && Number.isFinite(candidate.cropY)
            ? clamp(Math.round(candidate.cropY), 0, 100)
            : 50,
          zoom: typeof candidate.zoom === "number" && Number.isFinite(candidate.zoom)
            ? Number(clamp(candidate.zoom, 1, 3).toFixed(2))
            : 1,
          ...(type === "text" ? { html: typeof candidate.html === "string" ? candidate.html : "" } : {}),
        },
        grid,
      );
    })
    .filter((b): b is LayoutBlock => b !== null);

  return { version: LAYOUT_VERSION, grid, blocks: safeBlocks };
}

/**
 * CSS Grid placement for one block.
 *
 * Returned as a plain style object so the SAME function serves the admin canvas
 * and the public renderer — the only difference between them is the pixel width
 * of a column, which CSS Grid handles.
 */
export function layoutToGridStyle(block: LayoutBlock): {
  gridColumn: string;
  gridRow: string;
  zIndex: number;
} {
  return {
    gridColumn: `${block.x + 1} / span ${block.w}`,
    gridRow: `${block.y + 1} / span ${block.h}`,
    zIndex: block.z,
  };
}

/**
 * Starter templates. Each is a preset block array, so "template" is DATA rather
 * than a component — adding one needs no code change to the renderer.
 */
export const LAYOUT_TEMPLATES: ReadonlyArray<{ id: string; label: string; build: () => LayoutDoc }> = [
  {
    id: "photo-grid",
    label: "Grid Foto (4 Foto)",
    build: () => ({
      version: LAYOUT_VERSION,
      grid: { cols: 12, rows: 8 },
      blocks: [
        { id: "g1", type: "photo", x: 0, y: 0, w: 6, h: 4, z: 1, fit: "cover", mediaId: null },
        { id: "g2", type: "photo", x: 6, y: 0, w: 6, h: 4, z: 2, fit: "cover", mediaId: null },
        { id: "g3", type: "photo", x: 0, y: 4, w: 4, h: 4, z: 3, fit: "cover", mediaId: null },
        { id: "g4", type: "photo", x: 4, y: 4, w: 8, h: 4, z: 4, fit: "cover", mediaId: null },
      ],
    }),
  },
  {
    id: "editorial-split",
    label: "Editorial Split (Teks + Foto)",
    build: () => ({
      version: LAYOUT_VERSION,
      grid: { cols: 12, rows: 8 },
      blocks: [
        { id: "e1", type: "text", x: 0, y: 0, w: 5, h: 4, z: 1, html: "<h2>Judul Proyek</h2>" },
        { id: "e2", type: "photo", x: 5, y: 0, w: 7, h: 8, z: 2, fit: "cover", mediaId: null },
        { id: "e3", type: "text", x: 0, y: 4, w: 5, h: 4, z: 3, html: "<p>Deskripsi singkat cerita.</p>" },
      ],
    }),
  },
  {
    id: "case-study",
    label: "Case Study (Hero + 2 Kolom)",
    build: () => ({
      version: LAYOUT_VERSION,
      grid: { cols: 12, rows: 8 },
      blocks: [
        { id: "c1", type: "photo", x: 0, y: 0, w: 12, h: 5, z: 1, fit: "cover", mediaId: null },
        { id: "c2", type: "text", x: 0, y: 5, w: 6, h: 3, z: 2, html: "<h3>Tantangan</h3>" },
        { id: "c3", type: "text", x: 6, y: 5, w: 6, h: 3, z: 3, html: "<h3>Hasil</h3>" },
      ],
    }),
  },
  {
    id: "hero-cinema",
    label: "Hero Sinematik (Lebar + Kutipan)",
    build: () => ({
      version: LAYOUT_VERSION,
      grid: { cols: 12, rows: 8 },
      blocks: [
        { id: "hc1", type: "photo", x: 0, y: 0, w: 12, h: 6, z: 1, fit: "cover", mediaId: null },
        { id: "hc2", type: "text", x: 2, y: 6, w: 8, h: 2, z: 2, html: "<p style=\"text-align:center; font-style:italic;\">\"Setiap detik adalah kenangan yang tak tergantikan.\"</p>" },
      ],
    }),
  },
  {
    id: "triptych",
    label: "Triptych 3 Kolom (3 Foto Potret)",
    build: () => ({
      version: LAYOUT_VERSION,
      grid: { cols: 12, rows: 6 },
      blocks: [
        { id: "tr1", type: "photo", x: 0, y: 0, w: 4, h: 6, z: 1, fit: "cover", mediaId: null },
        { id: "tr2", type: "photo", x: 4, y: 0, w: 4, h: 6, z: 2, fit: "cover", mediaId: null },
        { id: "tr3", type: "photo", x: 8, y: 0, w: 4, h: 6, z: 3, fit: "cover", mediaId: null },
      ],
    }),
  },
  {
    id: "mosaic",
    label: "Mosaic Dinamis (1 Besar + 2 Kecil)",
    build: () => ({
      version: LAYOUT_VERSION,
      grid: { cols: 12, rows: 8 },
      blocks: [
        { id: "m1", type: "photo", x: 0, y: 0, w: 7, h: 8, z: 1, fit: "cover", mediaId: null },
        { id: "m2", type: "photo", x: 7, y: 0, w: 5, h: 4, z: 2, fit: "cover", mediaId: null },
        { id: "m3", type: "photo", x: 7, y: 4, w: 5, h: 4, z: 3, fit: "cover", mediaId: null },
      ],
    }),
  },
  {
    id: "quote-break",
    label: "Kutipan Editorial (Quote + 2 Foto)",
    build: () => ({
      version: LAYOUT_VERSION,
      grid: { cols: 12, rows: 7 },
      blocks: [
        { id: "qb1", type: "text", x: 1, y: 0, w: 10, h: 3, z: 1, html: "<h2>Keindahan dalam Kesederhanaan</h2><p>Momen berharga yang tertangkap secara alami dan jujur.</p>" },
        { id: "qb2", type: "photo", x: 0, y: 3, w: 6, h: 4, z: 2, fit: "cover", mediaId: null },
        { id: "qb3", type: "photo", x: 6, y: 3, w: 6, h: 4, z: 3, fit: "cover", mediaId: null },
      ],
    }),
  },
];

/**
 * Appends a template's blocks below existing layout content.
 * Offsets block y coordinates so they sit below the lowest existing block,
 * generates fresh unique IDs, and dynamically expands the canvas row count.
 */
export function appendTemplateToLayout(
  current: LayoutDoc,
  template: LayoutDoc,
): LayoutDoc {
  const maxY = current.blocks.reduce((max, b) => Math.max(max, b.y + b.h), 0);
  const offsetY = maxY > 0 ? maxY : 0;

  const newBlocks: LayoutBlock[] = template.blocks.map((b, index) => ({
    ...b,
    id: `b_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 6)}`,
    y: b.y + offsetY,
    z: current.blocks.length + index + 1,
  }));

  const totalRows = Math.max(current.grid.rows, offsetY + template.grid.rows, 8);

  return {
    ...current,
    grid: {
      cols: current.grid.cols,
      rows: totalRows,
    },
    blocks: [...current.blocks, ...newBlocks],
  };
}

/**
 * Expands the vertical canvas by adding extra rows at the bottom.
 */
export function expandLayoutRows(
  layout: LayoutDoc,
  additionalRows: number = 4,
): LayoutDoc {
  const maxY = layout.blocks.reduce((max, b) => Math.max(max, b.y + b.h), 0);
  const currentRows = Math.max(layout.grid.rows, maxY);
  return {
    ...layout,
    grid: {
      ...layout.grid,
      rows: clamp(currentRows + additionalRows, 8, 200),
    },
  };
}

/**
 * Scans a layout document for the first photo block that has a non-empty `publicUrl`.
 * Blocks are evaluated in visual reading order (y ascending, then x ascending).
 * Returns the public URL or null if no photo block has an image.
 */
export function findFirstPhotoUrl(layout: unknown): string | null {
  const doc = normaliseLayout(layout);
  const sorted = [...doc.blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const block of sorted) {
    if (block.type === "photo" && typeof block.publicUrl === "string") {
      const trimmed = block.publicUrl.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}
