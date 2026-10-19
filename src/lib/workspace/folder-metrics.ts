import "server-only";

import type { ServiceSupabaseClient } from "@/lib/supabase/service";

/**
 * Folder-card metrics in one pass.
 *
 * WHY NOT PER-CARD QUERIES
 * ------------------------
 * The card grid shows media count, crew count and storage for every visible
 * project. Fetching those inside a `map` is the classic N+1: 20 projects means
 * 60 round trips and a grid that pops in unevenly.
 *
 * Instead one query grabs all rows for the visible project ids and the counts
 * are folded in memory. Three queries total regardless of grid size.
 */

export type FolderMetrics = {
  mediaCount: number;
  crewCount: number;
  favoriteCount: number;
  /** Total bytes of the project's media, or null when not measurable. */
  storageBytes: number | null;
};

const EMPTY: FolderMetrics = { mediaCount: 0, crewCount: 0, favoriteCount: 0, storageBytes: null };

export async function loadFolderMetrics(
  supabase: ServiceSupabaseClient,
  projectIds: string[]
): Promise<Map<string, FolderMetrics>> {
  const result = new Map<string, FolderMetrics>();
  if (projectIds.length === 0) return result;

  for (const id of projectIds) result.set(id, { ...EMPTY });

  /*
   * `media` is one row per asset. Size lives in `file_size`; older rows
   * predate the column, so the sum skips nulls rather than reporting 0 bytes
   * for a project that certainly has files.
   */
  const [mediaRes, crewRes, favRes] = await Promise.all([
    supabase.from("media").select("project_id, file_size").in("project_id", projectIds),
    supabase
      .from("project_crew_assignments")
      .select("project_id, revoked_at")
      .in("project_id", projectIds)
      .is("revoked_at", null),
    supabase.from("favorites").select("project_id").in("project_id", projectIds),
  ]);

  // A failed query must not fabricate counts; the row keeps its honest zero.
  if (!mediaRes.error && mediaRes.data) {
    const sizes = new Map<string, { count: number; bytes: number; measured: boolean }>();
    for (const row of mediaRes.data) {
      const id = row.project_id as string;
      const entry = sizes.get(id) ?? { count: 0, bytes: 0, measured: false };
      entry.count += 1;
      const size = row.file_size;
      if (typeof size === "number" && Number.isFinite(size)) {
        entry.bytes += size;
        entry.measured = true;
      }
      sizes.set(id, entry);
    }
    for (const [id, entry] of sizes) {
      const current = result.get(id) ?? { ...EMPTY };
      result.set(id, {
        ...current,
        mediaCount: entry.count,
        storageBytes: entry.measured ? entry.bytes : null,
      });
    }
  }

  if (!crewRes.error && crewRes.data) {
    const counts = new Map<string, number>();
    for (const row of crewRes.data) {
      const id = row.project_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, count] of counts) {
      const current = result.get(id) ?? { ...EMPTY };
      result.set(id, { ...current, crewCount: count });
    }
  }

  if (!favRes.error && favRes.data) {
    const counts = new Map<string, number>();
    for (const row of favRes.data) {
      const id = row.project_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, count] of counts) {
      const current = result.get(id) ?? { ...EMPTY };
      result.set(id, { ...current, favoriteCount: count });
    }
  }

  return result;
}

/** Human byte size for the folder card. `null` renders as an em dash. */
export function formatStorage(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}
