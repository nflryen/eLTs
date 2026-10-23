import test from "node:test";
import assert from "node:assert/strict";
import {
  addBlock,
  appendTemplateToLayout,
  clampBlock,
  EMPTY_LAYOUT,
  expandLayoutRows,
  findFirstPhotoUrl,
  LAYOUT_TEMPLATES,
  layoutToGridStyle,
  moveBlock,
  normaliseLayout,
  removeBlock,
  resizeBlock,
  trimTrailingEmptyRows,
  updateBlock,
  type LayoutBlock,
} from "../src/lib/portfolio/layout";

/*
 * Portfolio layout geometry.
 *
 * These functions decide what appears on the PUBLIC site. A block that escapes
 * the grid renders overlapping or off-canvas where nobody signed in can notice,
 * so the clamps are asserted directly rather than only through the UI.
 */

const GRID = { cols: 12, rows: 8 };

function block(over: Partial<LayoutBlock> = {}): LayoutBlock {
  return { id: "b1", type: "photo", x: 0, y: 0, w: 6, h: 4, z: 1, fit: "cover", ...over };
}

test("clampBlock keeps a block inside the grid", () => {
  assert.deepEqual(clampBlock(block({ x: 20 }), GRID), block({ x: 6 }), "x clamped to cols - w");
  assert.deepEqual(clampBlock(block({ y: 20 }), GRID), block({ y: 4 }), "y clamped to rows - h");
  assert.deepEqual(clampBlock(block({ x: -5 }), GRID), block({ x: 0 }));
  assert.deepEqual(clampBlock(block({ y: -5 }), GRID), block({ y: 0 }));
});

test("clampBlock enforces a 1x1 minimum", () => {
  /* A resize handle dragged past the block's own origin would otherwise produce
     w = 0, which CSS Grid renders as a collapsed, invisible cell. */
  assert.equal(clampBlock(block({ w: 0 }), GRID).w, 1);
  assert.equal(clampBlock(block({ w: -3 }), GRID).w, 1);
  assert.equal(clampBlock(block({ h: 0 }), GRID).h, 1);
  assert.equal(clampBlock(block({ h: -2 }), GRID).h, 1);
});

test("clampBlock can never exceed the full grid width", () => {
  const wide = clampBlock(block({ w: 99 }), GRID);
  assert.equal(wide.w, GRID.cols);
  assert.equal(wide.x, 0);
});

test("moveBlock translates and clamps in one step", () => {
  assert.deepEqual(moveBlock(block(), 2, 1, GRID), block({ x: 2, y: 1 }));
  /* Pushing right past the edge lands flush, not off-canvas. */
  assert.deepEqual(moveBlock(block(), 100, 0, GRID), block({ x: 6 }));
  /* And never negative. */
  assert.deepEqual(moveBlock(block(), -100, -100, GRID), block({ x: 0, y: 0 }));
});

test("resizeBlock clamps to the grid edge and the 1x1 minimum", () => {
  assert.deepEqual(resizeBlock(block(), 2, 2, GRID), block({ w: 8, h: 6 }));
  assert.deepEqual(resizeBlock(block(), 100, 100, GRID), block({ w: 12, h: 8 }));
  assert.deepEqual(resizeBlock(block(), -100, -100, GRID), block({ w: 1, h: 1 }));
});

test("layoutToGridStyle emits 1-based CSS grid placement", () => {
  /* CSS Grid lines are 1-based, the layout model is 0-based. An off-by-one here
     shifts every block by one cell on the public site. */
  assert.deepEqual(layoutToGridStyle(block({ x: 0, y: 0, w: 6, h: 4, z: 2 })), {
    gridColumn: "1 / span 6",
    gridRow: "1 / span 4",
    zIndex: 2,
  });
  assert.deepEqual(layoutToGridStyle(block({ x: 6, y: 5, w: 6, h: 3, z: 1 })), {
    gridColumn: "7 / span 6",
    gridRow: "6 / span 3",
    zIndex: 1,
  });
});

test("addBlock places new blocks below existing ones, never on top", () => {
  const one = addBlock(EMPTY_LAYOUT, { type: "photo" });
  assert.equal(one.blocks.length, 1);
  assert.equal(one.blocks[0].y, 0);

  const two = addBlock(one, { type: "text", html: "<p>x</p>" });
  assert.equal(two.blocks.length, 2);
  /* y must start at or after the previous block's bottom edge. */
  assert.ok(two.blocks[1].y >= one.blocks[0].y + one.blocks[0].h);
  assert.equal(two.blocks[1].type, "text");
});

test("addBlock assigns unique ids", () => {
  let layout = EMPTY_LAYOUT;
  for (let i = 0; i < 5; i += 1) layout = addBlock(layout, { type: "photo" });
  const ids = layout.blocks.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "every block id must be unique");
});

test("removeBlock is a no-op for an unknown id", () => {
  const layout = addBlock(EMPTY_LAYOUT, { type: "photo" });
  assert.equal(removeBlock(layout, "nope").blocks.length, 1);
  assert.equal(removeBlock(layout, layout.blocks[0].id).blocks.length, 0);
});

test("updateBlock clamps the patched result and cannot change the id", () => {
  const layout = addBlock(EMPTY_LAYOUT, { type: "photo" });
  const id = layout.blocks[0].id;
  const moved = updateBlock(layout, id, { x: 999, id: "hijacked" } as Partial<LayoutBlock>);
  assert.equal(moved.blocks[0].id, id, "id must be immutable through a patch");
  assert.equal(moved.blocks[0].x, GRID.cols - moved.blocks[0].w);
});

test("normaliseLayout repairs untrusted JSON instead of throwing", () => {
  /*
   * The database trigger validates writes, but rows can arrive from an older
   * schema, a hand-edited column, or a future client. A public page that drops
   * one malformed block is far better than one that 500s.
   */
  const fromJunk = normaliseLayout({ blocks: "not-an-array" });
  assert.deepEqual(fromJunk.blocks, []);
  assert.equal(fromJunk.grid.cols, 12);

  const repaired = normaliseLayout({
    grid: { cols: 999, rows: -4 },
    blocks: [
      { id: "a", type: "photo", x: 50, y: 50, w: 0, h: 0, z: 1 },
      { type: "unknown" },
      null,
    ],
  });
  assert.equal(repaired.grid.cols, 24, "cols clamped to the allowed maximum");
  assert.equal(repaired.grid.rows, 1, "rows clamped to the allowed minimum");
  assert.equal(repaired.blocks.length, 2, "the null entry is discarded");
  for (const b of repaired.blocks) {
    assert.ok(b.w >= 1 && b.h >= 1);
    assert.ok(b.x + b.w <= repaired.grid.cols);
    assert.ok(["photo", "text"].includes(b.type));
  }

  /* Missing ids are regenerated so React keys stay stable and unique. */
  assert.ok(repaired.blocks.every((b) => typeof b.id === "string" && b.id.length > 0));
});

test("every shipped template is valid for the default grid", () => {
  for (const tpl of LAYOUT_TEMPLATES) {
    const doc = tpl.build();
    assert.ok(doc.blocks.length > 0, `${tpl.id} must not be empty`);
    for (const b of doc.blocks) {
      assert.ok(b.x >= 0 && b.y >= 0, `${tpl.id}:${b.id} negative origin`);
      assert.ok(b.w >= 1 && b.h >= 1, `${tpl.id}:${b.id} non-positive size`);
      assert.ok(
        b.x + b.w <= doc.grid.cols,
        `${tpl.id}:${b.id} exceeds grid width (${b.x}+${b.w} > ${doc.grid.cols})`,
      );
      /*
       * Round-trip through normaliseLayout and compare GEOMETRY, not the whole
       * object: the normaliser fills in defaults (`fit`, `mediaId`) that a
       * compact template literal omits. A deep-equal here would fail on those
       * additive defaults while telling us nothing about whether the template
       * is drawable.
       */
      const roundTripped = normaliseLayout(doc).blocks;
      assert.equal(roundTripped.length, doc.blocks.length);
      for (const [i, b] of doc.blocks.entries()) {
        const rt = roundTripped[i];
        assert.deepEqual(
          { x: rt.x, y: rt.y, w: rt.w, h: rt.h, type: rt.type },
          { x: b.x, y: b.y, w: b.w, h: b.h, type: b.type },
          `${tpl.id}:${b.id} geometry changed through normalisation`,
        );
      }
    }
  }
});

test("findFirstPhotoUrl returns the first photo with publicUrl in reading order", () => {
  assert.equal(findFirstPhotoUrl(null), null);
  assert.equal(findFirstPhotoUrl({}), null);
  assert.equal(findFirstPhotoUrl({ blocks: [{ type: "text", html: "hello" }] }), null);

  const doc = {
    version: 1,
    grid: { cols: 12, rows: 8 },
    blocks: [
      { id: "t1", type: "text", x: 0, y: 0, w: 12, h: 2, z: 1, html: "<h1>Title</h1>" },
      {
        id: "p2",
        type: "photo",
        x: 6,
        y: 2,
        w: 6,
        h: 4,
        z: 2,
        publicUrl: "https://res.cloudinary.com/demo/image/upload/second.webp",
      },
      {
        id: "p1",
        type: "photo",
        x: 0,
        y: 2,
        w: 6,
        h: 4,
        z: 1,
        publicUrl: "https://res.cloudinary.com/demo/image/upload/first.webp",
      },
    ],
  };

  // In visual reading order (y=2 x=0 comes before y=2 x=6):
  assert.equal(
    findFirstPhotoUrl(doc),
    "https://res.cloudinary.com/demo/image/upload/first.webp",
  );

  // Empty or whitespace-only publicUrls are ignored:
  const docWithEmpty = {
    version: 1,
    grid: { cols: 12, rows: 8 },
    blocks: [
      { id: "p0", type: "photo", x: 0, y: 0, w: 6, h: 4, z: 1, publicUrl: "   " },
      {
        id: "p1",
        type: "photo",
        x: 6,
        y: 0,
        w: 6,
        h: 4,
        z: 2,
        publicUrl: "https://res.cloudinary.com/demo/image/upload/valid.webp",
      },
    ],
  };
  assert.equal(
    findFirstPhotoUrl(docWithEmpty),
    "https://res.cloudinary.com/demo/image/upload/valid.webp",
  );
});

test("appendTemplateToLayout appends template blocks sequentially below existing blocks", () => {
  const base = {
    version: 1,
    grid: { cols: 12, rows: 8 },
    blocks: [
      { id: "b1", type: "photo" as const, x: 0, y: 0, w: 12, h: 5, z: 1, publicUrl: "test.webp" },
    ],
  };
  const tpl = LAYOUT_TEMPLATES[0].build(); // photo-grid (rows: 8)

  const combined = appendTemplateToLayout(base, tpl);
  assert.equal(combined.blocks.length, base.blocks.length + tpl.blocks.length);
  assert.ok(combined.grid.rows >= 13, "rows expanded to fit both");

  // Newly added blocks should start at or after y=5
  const addedBlocks = combined.blocks.slice(base.blocks.length);
  for (const b of addedBlocks) {
    assert.ok(b.y >= 5, `appended block y (${b.y}) must be >= 5`);
    assert.notEqual(b.id, "b1");
  }
});

test("expandLayoutRows extends rows without corrupting block geometry", () => {
  const base = {
    version: 1,
    grid: { cols: 12, rows: 8 },
    blocks: [{ id: "b1", type: "photo" as const, x: 0, y: 0, w: 6, h: 4, z: 1 }],
  };
  const expanded = expandLayoutRows(base, 6);
  assert.equal(expanded.grid.rows, 14);
  assert.equal(expanded.blocks.length, 1);
  assert.equal(expanded.blocks[0].h, 4);
});

test("normaliseLayout preserves cropX, cropY, zoom and fit", () => {
  const raw = {
    version: 1,
    grid: { cols: 12, rows: 8 },
    blocks: [
      {
        id: "p1",
        type: "photo",
        x: 0,
        y: 0,
        w: 6,
        h: 4,
        cropX: 25,
        cropY: 80,
        zoom: 1.8,
        fit: "contain",
        publicUrl: "photo.webp",
      },
    ],
  };
  const normalised = normaliseLayout(raw);
  const b = normalised.blocks[0];
  assert.equal(b.cropX, 25);
  assert.equal(b.cropY, 80);
  assert.equal(b.zoom, 1.8);
  assert.equal(b.fit, "contain");
});

test("trimTrailingEmptyRows trims dead whitespace rows below active blocks", () => {
  // Empty layout stays 8 rows
  assert.equal(trimTrailingEmptyRows(EMPTY_LAYOUT).grid.rows, 8);

  // Layout with 20 rows but blocks only reach row 6 collapses to 6 rows
  const doc = {
    version: 1,
    grid: { cols: 12, rows: 20 },
    blocks: [
      { id: "b1", type: "photo" as const, x: 0, y: 0, w: 6, h: 4, z: 1 },
      { id: "b2", type: "photo" as const, x: 6, y: 2, w: 6, h: 4, z: 2 }, // y=2, h=4 -> bottom is 6
    ],
  };
  const trimmed = trimTrailingEmptyRows(doc);
  assert.equal(trimmed.grid.rows, 6);
  assert.equal(trimmed.blocks.length, 2);

  // Layout with blocks reaching row 2 keeps a minimum floor of 4 rows
  const shallow = {
    version: 1,
    grid: { cols: 12, rows: 12 },
    blocks: [{ id: "b1", type: "text" as const, x: 0, y: 0, w: 12, h: 2, z: 1 }],
  };
  assert.equal(trimTrailingEmptyRows(shallow).grid.rows, 4);
});

test("normaliseLayout preserves independent mobileCropX, mobileCropY, mobileZoom and mobileFit", () => {
  const raw = {
    version: 1,
    grid: { cols: 12, rows: 8 },
    blocks: [
      {
        id: "p1",
        type: "photo",
        x: 0,
        y: 0,
        w: 6,
        h: 4,
        cropX: 30,
        cropY: 40,
        zoom: 1.2,
        fit: "cover",
        mobileCropX: 75,
        mobileCropY: 15,
        mobileZoom: 1.9,
        mobileFit: "contain",
        publicUrl: "photo.webp",
      },
    ],
  };
  const normalised = normaliseLayout(raw);
  const b = normalised.blocks[0];
  // Desktop values
  assert.equal(b.cropX, 30);
  assert.equal(b.cropY, 40);
  assert.equal(b.zoom, 1.2);
  assert.equal(b.fit, "cover");
  // Mobile independent values
  assert.equal(b.mobileCropX, 75);
  assert.equal(b.mobileCropY, 15);
  assert.equal(b.mobileZoom, 1.9);
  assert.equal(b.mobileFit, "contain");
});
