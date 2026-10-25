import test from "node:test";
import assert from "node:assert/strict";
import {
  getHomepageFeaturedWorks,
  getAboutCollagePhotos,
  getTwelveHourRotationOffset,
} from "../src/lib/portfolio/homepage";
import { normaliseLayout, type LayoutDoc } from "../src/lib/portfolio/layout";

test("getHomepageFeaturedWorks returns valid work items with required attributes", async () => {
  const items = await getHomepageFeaturedWorks();
  assert.ok(Array.isArray(items), "Featured works must be an array");
  assert.ok(items.length > 0, "Must return at least 1 featured work");

  for (const item of items) {
    assert.ok(item.id, "Item must have an id");
    assert.ok(item.src, "Item must have an image src");
    assert.ok(item.title, "Item must have a title");
    assert.ok(item.slug, "Item must have a slug");
    assert.ok(item.category, "Item must have a category");
  }
});

test("portfolio layout extracts photo blocks for lightbox in reading order", () => {
  const layout: LayoutDoc = {
    version: 1,
    grid: { cols: 12, rows: 20 },
    blocks: [
      {
        id: "b-2",
        type: "photo",
        x: 6,
        y: 10,
        w: 6,
        h: 5,
        z: 2,
        publicUrl: "https://example.com/photo-2.jpg",
      },
      {
        id: "b-1",
        type: "photo",
        x: 0,
        y: 0,
        w: 6,
        h: 5,
        z: 1,
        publicUrl: "https://example.com/photo-1.jpg",
      },
      {
        id: "text-1",
        type: "text",
        x: 6,
        y: 0,
        w: 6,
        h: 4,
        z: 3,
        html: "<p>Intro</p>",
      },
      {
        id: "b-3",
        type: "photo",
        x: 0,
        y: 10,
        w: 6,
        h: 5,
        z: 4,
        publicUrl: "https://example.com/photo-3.jpg",
      },
    ],
  };

  const norm = normaliseLayout(layout);
  const photos = norm.blocks
    .filter((b) => b.type === "photo" && b.publicUrl)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  assert.equal(photos.length, 3);
  assert.equal(photos[0].id, "b-1");
  assert.equal(photos[1].id, "b-3");
  assert.equal(photos[2].id, "b-2");
});

test("getAboutCollagePhotos returns primary and secondary photo with valid image sources", async () => {
  const collage = await getAboutCollagePhotos();
  assert.ok(collage.primary, "Must have a primary collage photo");
  assert.ok(collage.secondary, "Must have a secondary collage photo");
  assert.ok(collage.primary.src, "Primary must have an image src");
  assert.ok(collage.secondary.src, "Secondary must have an image src");
  assert.ok(collage.primary.alt, "Primary must have alt text");
  assert.ok(collage.secondary.alt, "Secondary must have alt text");
});

test("getTwelveHourRotationOffset wraps smoothly around length", () => {
  assert.equal(getTwelveHourRotationOffset(0), 0);
  assert.equal(getTwelveHourRotationOffset(1), 0);
  const offset5 = getTwelveHourRotationOffset(5);
  assert.ok(offset5 >= 0 && offset5 < 5);
  const offset10 = getTwelveHourRotationOffset(10);
  assert.ok(offset10 >= 0 && offset10 < 10);
});
