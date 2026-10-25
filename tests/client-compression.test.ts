import test from "node:test";
import assert from "node:assert/strict";
import {
  formatBytes,
  calculateConstrainedDimensions,
  isCompressibleImage,
  compressImageFile,
  DEFAULT_COMPRESSION_OPTIONS,
} from "../src/lib/images/compression";

test("formatBytes converts numbers to appropriate metric units", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(-10), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1024 * 1024), "1.0 MB");
  assert.equal(formatBytes(1024 * 1024 * 2.5), "2.5 MB");
  assert.equal(formatBytes(1024 * 1024 * 1024), "1.0 GB");
});

test("calculateConstrainedDimensions scales proportionally within bounds", () => {
  // Landscape scaling
  const landscape = calculateConstrainedDimensions(4000, 3000, 2048, 2048);
  assert.equal(landscape.width, 2048);
  assert.equal(landscape.height, 1536);
  assert.equal(landscape.scaled, true);

  // Portrait scaling
  const portrait = calculateConstrainedDimensions(3000, 4000, 2048, 2048);
  assert.equal(portrait.width, 1536);
  assert.equal(portrait.height, 2048);
  assert.equal(portrait.scaled, true);

  // Square scaling
  const square = calculateConstrainedDimensions(3000, 3000, 2048, 2048);
  assert.equal(square.width, 2048);
  assert.equal(square.height, 2048);
  assert.equal(square.scaled, true);

  // Already within bounds (no upscaling)
  const small = calculateConstrainedDimensions(1200, 800, 2048, 2048);
  assert.equal(small.width, 1200);
  assert.equal(small.height, 800);
  assert.equal(small.scaled, false);

  // Zero or invalid dimensions fallback
  const invalid = calculateConstrainedDimensions(0, -100, 2048, 2048);
  assert.equal(invalid.width, 1);
  assert.equal(invalid.height, 1);
  assert.equal(invalid.scaled, false);
});

test("isCompressibleImage accepts raster photos and excludes SVG and GIF", () => {
  const makeDummyFile = (type: string) =>
    new File(["dummy content"], "test.jpg", { type });

  assert.equal(isCompressibleImage(makeDummyFile("image/jpeg")), true);
  assert.equal(isCompressibleImage(makeDummyFile("image/png")), true);
  assert.equal(isCompressibleImage(makeDummyFile("image/webp")), true);
  assert.equal(isCompressibleImage(makeDummyFile("image/heic")), true);

  // Vector and animations must not be rasterized/flattened
  assert.equal(isCompressibleImage(makeDummyFile("image/svg+xml")), false);
  assert.equal(isCompressibleImage(makeDummyFile("image/gif")), false);

  // Non-images
  assert.equal(isCompressibleImage(makeDummyFile("video/mp4")), false);
  assert.equal(isCompressibleImage(makeDummyFile("application/pdf")), false);
});

test("compressImageFile degrades safely in non-browser context without crashing", async () => {
  const dummy = new File(["test data"], "photo.jpg", { type: "image/jpeg" });
  const result = await compressImageFile(dummy);

  assert.ok(result.file);
  assert.equal(result.wasCompressed, false);
  assert.equal(result.originalSize, dummy.size);
  assert.equal(result.compressedSize, dummy.size);
});

test("DEFAULT_COMPRESSION_OPTIONS enforce studio quality constraints", () => {
  assert.equal(DEFAULT_COMPRESSION_OPTIONS.maxWidth, 2048);
  assert.equal(DEFAULT_COMPRESSION_OPTIONS.maxHeight, 2048);
  assert.equal(DEFAULT_COMPRESSION_OPTIONS.quality, 0.85);
  assert.equal(DEFAULT_COMPRESSION_OPTIONS.mimeType, "image/webp");
  assert.equal(DEFAULT_COMPRESSION_OPTIONS.skipBelowBytes, 250 * 1024);
});
