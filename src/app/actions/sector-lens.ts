"use server";

import { cookies } from "next/headers";
import { SECTOR_COOKIE, resolveSector, type SectorId } from "@/lib/sector-lens";

/** Persists the sector lens. Survives navigation, unlike a search param. */
export async function setSectorLens(lens: SectorId): Promise<void> {
  const store = await cookies();
  store.set(SECTOR_COOKIE, resolveSector(lens), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}
