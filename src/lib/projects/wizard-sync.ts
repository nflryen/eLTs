import type { ServicePillarType, ProjectSectorSpecs } from "@/types/sectors";
import { getDefaultSectorSpecs } from "@/types/sectors";
import type { PricelistPackage, PricelistCategory } from "@/lib/pricelist";

/**
 * Matches a pricelist category slug to the most appropriate studio service pillar.
 */
export function matchCategoryToPillar(categorySlug: string): ServicePillarType {
  const s = categorySlug.toLowerCase();
  if (s.includes("broadcast") || s.includes("stream")) {
    return "BROADCAST_LIVE_STREAMING";
  }
  if (s.includes("video") || s.includes("aftermovie") || s.includes("commercial") || s.includes("event-documentation")) {
    return "COMMERCIAL_VIDEO";
  }
  return "EVENT_GRADUATION_PHOTO";
}

/**
 * Filters pricelist categories relevant to the selected service pillar.
 */
export function getPillarCategories(
  pillar: ServicePillarType,
  categories: PricelistCategory[]
): PricelistCategory[] {
  return categories.filter((cat) => {
    if (pillar === "BROADCAST_LIVE_STREAMING") {
      return cat.slug.includes("broadcast") || cat.slug.includes("stream");
    }
    if (pillar === "COMMERCIAL_VIDEO") {
      return cat.slug.includes("video") || cat.slug === "event-documentation";
    }
    // EVENT_GRADUATION_PHOTO
    return !cat.slug.includes("broadcast") && (
      cat.slug.includes("photo") ||
      cat.slug.includes("wedding") ||
      cat.slug === "event-documentation"
    );
  });
}

/**
 * Maps a category slug to the canonical PostgreSQL photography_type enum.
 */
export function resolvePhotographyTypeFromCategory(
  categorySlug: string
): "wedding" | "prewedding" | "graduation" | "couple" | "event" {
  const s = categorySlug.toLowerCase();
  if (s.includes("wedding")) return "wedding";
  if (s.includes("prewedding")) return "prewedding";
  if (s.includes("grad")) return "graduation";
  if (s.includes("couple")) return "couple";
  return "event";
}

/**
 * Extracts explicit edited photo quota if mentioned in package inclusions (e.g. "40 Edited Photos").
 */
export function extractPhotoQuotaFromIncludes(includes: string[]): number | null {
  for (const item of includes) {
    const match = item.match(/(\d+)\+?\s+Edited Photos/i);
    if (match) {
      const q = parseInt(match[1], 10);
      if (q > 0) return q;
    }
  }
  return null;
}

/**
 * Synchronizes a chosen pricelist package into the project's sector_specs payload.
 */
export function syncPackageToSectorSpecs(
  pillar: ServicePillarType,
  pkg: PricelistPackage,
  category: PricelistCategory,
  existingSpecs?: ProjectSectorSpecs
): ProjectSectorSpecs {
  const specs: ProjectSectorSpecs = existingSpecs
    ? JSON.parse(JSON.stringify(existingSpecs))
    : getDefaultSectorSpecs(pillar);

  // Attach structured package metadata for Call Sheet, RAB, and Invoicing
  specs.package = {
    id: pkg.id,
    name: pkg.name,
    categoryName: category.name,
    categorySlug: category.slug,
    priceIdr: pkg.priceIdr,
    duration: pkg.duration,
    crew: pkg.crew,
    includes: pkg.includes,
  };

  // Synchronize sector-specific deliverables
  if (pillar === "COMMERCIAL_VIDEO") {
    if (!specs.video) {
      specs.video = getDefaultSectorSpecs("COMMERCIAL_VIDEO").video;
    }
    if (specs.video && pkg.includes.length > 0) {
      specs.video.targetDeliverables = [...pkg.includes];
    }
  } else if (pillar === "EVENT_GRADUATION_PHOTO") {
    if (!specs.photo) {
      specs.photo = getDefaultSectorSpecs("EVENT_GRADUATION_PHOTO").photo;
    }
    if (specs.photo && pkg.includes.length > 0) {
      specs.photo.shotList = [...pkg.includes];
    }
    const quota = extractPhotoQuotaFromIncludes(pkg.includes);
    if (quota && specs.photo) {
      specs.photo.proofingQuotaMax = quota;
      specs.photo.proofingQuotaMin = Math.min(15, quota);
    }
  } else if (pillar === "BROADCAST_LIVE_STREAMING") {
    if (!specs.broadcast) {
      specs.broadcast = getDefaultSectorSpecs("BROADCAST_LIVE_STREAMING").broadcast;
    }
    if (specs.broadcast && pkg.includes.length > 0) {
      const prefix = `Paket: ${pkg.name}`;
      const joined = pkg.includes.join(" • ");
      specs.broadcast.techNotes = specs.broadcast.techNotes
        ? `${prefix} | ${joined} | ${specs.broadcast.techNotes}`
        : `${prefix} | ${joined}`;
    }
  }

  return specs;
}
