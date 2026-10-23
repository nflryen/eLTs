import test from "node:test";
import assert from "node:assert/strict";
import { getCloudinaryConfig } from "../src/lib/env";
import { findFirstPhotoUrl } from "../src/lib/portfolio/layout";

test("getCloudinaryConfig resolves credentials from CLOUDINARY_URL if separate vars are missing", () => {
  const originalEnv = { ...process.env };

  try {
    // 1. Separate vars present
    process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
    process.env.CLOUDINARY_API_KEY = "111111";
    process.env.CLOUDINARY_API_SECRET = "secret-abc";
    delete process.env.CLOUDINARY_URL;

    assert.deepEqual(getCloudinaryConfig(), {
      cloudName: "test-cloud",
      apiKey: "111111",
      apiSecret: "secret-abc",
    });

    // 2. Only CLOUDINARY_URL present
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    process.env.CLOUDINARY_URL = "cloudinary://222222:url-secret@url-cloud";

    assert.deepEqual(getCloudinaryConfig(), {
      cloudName: "url-cloud",
      apiKey: "222222",
      apiSecret: "url-secret",
    });

    // 3. Neither present -> throws
    delete process.env.CLOUDINARY_URL;
    assert.throws(() => getCloudinaryConfig(), /Cloudinary is not configured/);
  } finally {
    process.env = originalEnv;
  }
});

test("findFirstPhotoUrl extracts first photo in reading order across layout blocks", () => {
  const layout = {
    version: 1,
    grid: { cols: 12, rows: 8 },
    blocks: [
      { id: "b1", type: "text", x: 0, y: 0, w: 12, h: 2, html: "Intro" },
      { id: "b2", type: "photo", x: 0, y: 2, w: 6, h: 4, publicUrl: "https://res.cloudinary.com/demo/image/upload/hero.webp" },
      { id: "b3", type: "photo", x: 6, y: 2, w: 6, h: 4, publicUrl: "https://res.cloudinary.com/demo/image/upload/detail.webp" },
    ],
  };

  assert.equal(
    findFirstPhotoUrl(layout),
    "https://res.cloudinary.com/demo/image/upload/hero.webp",
  );
});

test("findFirstPhotoUrl returns null if layout has only text blocks or missing publicUrl", () => {
  assert.equal(findFirstPhotoUrl({ blocks: [] }), null);
  assert.equal(
    findFirstPhotoUrl({
      blocks: [
        { id: "b1", type: "text", x: 0, y: 0, w: 12, h: 4, html: "No photos here" },
      ],
    }),
    null,
  );
  assert.equal(
    findFirstPhotoUrl({
      blocks: [
        { id: "p1", type: "photo", x: 0, y: 0, w: 6, h: 4, publicUrl: null },
        { id: "p2", type: "photo", x: 6, y: 0, w: 6, h: 4, publicUrl: "" },
      ],
    }),
    null,
  );
});
