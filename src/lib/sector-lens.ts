/**
 * Sector lens — shared constants and pure predicates.
 *
 * CLIENT-SAFE. No `server-only`, no `next/headers`. The cookie-reading half
 * lives in `@/lib/sector-lens.server` so client components can import the
 * sector list without dragging the server boundary into the browser bundle.
 *
 * The lens is a VIEW concern only: it scopes aggregate queries and never
 * changes what a project IS. A project's pillar is fixed data.
 */

export const SECTOR_COOKIE = "elts-lens";

export const SECTORS = [
  { id: "ALL", label: "Semua", short: "Semua" },
  { id: "BROADCAST_LIVE_STREAMING", label: "Broadcast & FOH", short: "Broadcast" },
  { id: "COMMERCIAL_VIDEO", label: "Video Commercial", short: "Video" },
  { id: "EVENT_GRADUATION_PHOTO", label: "Foto & Wisuda", short: "Foto" },
] as const;

export type SectorId = (typeof SECTORS)[number]["id"];

/** Narrows any cookie value to a known sector, defaulting to ALL. */
export function resolveSector(value: unknown): SectorId {
  return SECTORS.some((s) => s.id === value) ? (value as SectorId) : "ALL";
}

/** The pillar filter to pass into a query: null means "no filter". */
export function sectorToPillar(lens: SectorId): string | null {
  return lens === "ALL" ? null : lens;
}
