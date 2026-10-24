import test from "node:test";
import assert from "node:assert/strict";
import { matchCategoryToPillar } from "../src/lib/projects/wizard-sync";
import {
  syncPackageToSectorSpecs,
  resolvePhotographyTypeFromCategory,
  extractPhotoQuotaFromIncludes,
} from "../src/lib/projects/wizard-sync";
import type { PricelistPackage, PricelistCategory } from "../src/lib/pricelist";

const samplePackage: PricelistPackage = {
  id: "pkg-1",
  slug: "intimate",
  name: "Intimate",
  priceIdr: 1650000,
  duration: "Up to 4 Hours",
  maxPersons: null,
  crew: ["1 Main Photographer", "1 Videographer"],
  includes: [
    "40 Edited Photos (Color Correction & Retouching)",
    "1 Cinematic Highlight Video (1-2 minutes)",
    "Free Concept & Moodboard Reference",
    "Unlimited Photos (Google Drive)",
  ],
  badge: null,
  notes: null,
};

const sampleCategory: PricelistCategory = {
  id: "cat-1",
  slug: "wedding-engagement",
  name: "Wedding & Engagement",
  description: "Wedding packages",
  packages: [samplePackage],
};

test("matchCategoryToPillar categorizes categories accurately", () => {
  assert.equal(matchCategoryToPillar("broadcast-live-streaming"), "BROADCAST_LIVE_STREAMING");
  assert.equal(matchCategoryToPillar("graduation-video"), "COMMERCIAL_VIDEO");
  assert.equal(matchCategoryToPillar("graduation-photo"), "EVENT_GRADUATION_PHOTO");
  assert.equal(matchCategoryToPillar("wedding-engagement"), "EVENT_GRADUATION_PHOTO");
  assert.equal(matchCategoryToPillar("event-documentation"), "COMMERCIAL_VIDEO");
});

test("resolvePhotographyTypeFromCategory resolves correct database enum", () => {
  assert.equal(resolvePhotographyTypeFromCategory("wedding-engagement"), "wedding");
  assert.equal(resolvePhotographyTypeFromCategory("graduation-photo"), "graduation");
  assert.equal(resolvePhotographyTypeFromCategory("graduation-video"), "graduation");
  assert.equal(resolvePhotographyTypeFromCategory("event-documentation"), "event");
  assert.equal(resolvePhotographyTypeFromCategory("broadcast-live-streaming"), "event");
});

test("extractPhotoQuotaFromIncludes extracts quota when present", () => {
  assert.equal(
    extractPhotoQuotaFromIncludes([
      "40 Edited Photos (Color Correction & Retouching)",
      "1 Highlight Video",
    ]),
    40
  );
  assert.equal(
    extractPhotoQuotaFromIncludes([
      "120+ Edited Photos",
      "Full video",
    ]),
    120
  );
  assert.equal(
    extractPhotoQuotaFromIncludes([
      "Unlimited Photos",
      "Full Video",
    ]),
    null
  );
});

test("syncPackageToSectorSpecs populates photo sector shotList and metadata", () => {
  const specs = syncPackageToSectorSpecs("EVENT_GRADUATION_PHOTO", samplePackage, sampleCategory);
  assert.ok(specs.photo);
  assert.deepEqual(specs.photo.shotList, samplePackage.includes);
  const pkgMeta = specs.package as { name?: string; priceIdr?: number } | undefined;
  assert.equal(pkgMeta?.name, "Intimate");
  assert.equal(pkgMeta?.priceIdr, 1650000);
});

test("syncPackageToSectorSpecs populates video sector targetDeliverables", () => {
  const videoPkg: PricelistPackage = {
    ...samplePackage,
    name: "Video Highlight",
    includes: [
      "1 Cinematic Aftermovie (2-3 minutes)",
      "Teaser 15s Instagram Reels",
    ],
  };
  const specs = syncPackageToSectorSpecs("COMMERCIAL_VIDEO", videoPkg, sampleCategory);
  assert.ok(specs.video);
  assert.deepEqual(specs.video.targetDeliverables, videoPkg.includes);
  const pkgMeta = specs.package as { name?: string; priceIdr?: number } | undefined;
  assert.equal(pkgMeta?.name, "Video Highlight");
});

test("syncPackageToSectorSpecs populates broadcast sector techNotes and metadata", () => {
  const broadcastPkg: PricelistPackage = {
    ...samplePackage,
    name: "2-Cam Broadcast",
    includes: [
      "2 Cameras Full HD",
      "VJ / Operator vMix",
      "Direct Stream to YouTube",
    ],
  };
  const specs = syncPackageToSectorSpecs("BROADCAST_LIVE_STREAMING", broadcastPkg, sampleCategory);
  assert.ok(specs.broadcast);
  assert.match(specs.broadcast.techNotes ?? "", /2 Cameras Full HD/);
  const pkgMeta = specs.package as { name?: string; priceIdr?: number } | undefined;
  assert.equal(pkgMeta?.name, "2-Cam Broadcast");
});
