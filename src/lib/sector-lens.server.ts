import "server-only";
import { cookies } from "next/headers";
import { SECTOR_COOKIE, resolveSector, type SectorId } from "@/lib/sector-lens";

/**
 * Server half of the sector lens. Split from the constants module so client
 * components can import `SECTORS` without pulling `next/headers` into the
 * browser bundle.
 *
 * WHY A COOKIE, NOT A URL PARAM
 * -----------------------------
 * The previous cockpit filter was a `?sector=` search param that reset to ALL
 * on every navigation, forcing the operator to re-select their focus dozens of
 * times a day. A cookie makes the lens survive navigation, so the OS feels like
 * it remembers what you are working on.
 */

export async function readSectorLens(): Promise<SectorId> {
  const store = await cookies();
  return resolveSector(store.get(SECTOR_COOKIE)?.value);
}
