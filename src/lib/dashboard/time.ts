import "server-only";

/**
 * Dashboard date boundaries.
 *
 * The studio runs on Asia/Jakarta (UTC+7, no DST). "Today" for a shoot count
 * means the Jakarta calendar day, not UTC — otherwise every shoot after 17:00
 * local would be counted on the following day, and the "Shoots Today" tile
 * would be wrong every single evening.
 *
 * Indonesia has observed no DST since 1963 and the offset is a fixed +07:00, so
 * the arithmetic here is exact rather than approximate.
 */

export const JKT_OFFSET_MS = 7 * 60 * 60 * 1000;

/** The Jakarta calendar date of `now`, as "YYYY-MM-DD". */
export function jktTodayIso(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + JKT_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The UTC instant at which the given Jakarta date begins.
 * `jktDayStartUtc("2026-10-19")` → "2026-10-18T17:00:00.000Z".
 */
export function jktDayStartUtc(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  // Date.UTC gives the UTC midnight of that calendar date; subtracting the
  // offset moves it back to the instant Jakarta midnight occurred.
  return new Date(Date.UTC(year, month - 1, day) - JKT_OFFSET_MS).toISOString();
}

/** The UTC instant at which the given Jakarta date ends (exclusive). */
export function jktDayEndUtc(dateIso: string): string {
  return new Date(new Date(jktDayStartUtc(dateIso)).getTime() + 24 * 60 * 60 * 1000).toISOString();
}

/** Current Jakarta wall clock as "HH:MM". */
export function jktClock(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + JKT_OFFSET_MS);
  const hours = String(shifted.getUTCHours()).padStart(2, "0");
  const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** "HH:MM" in Jakarta from an ISO timestamp; null when unparseable. */
export function jakartaClock(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  });
}

/**
 * First day of the month AFTER `monthStart`, as "YYYY-MM-DD".
 * Used as an exclusive upper bound so a receipt at 23:59 on the last day of the
 * month is included rather than dropped.
 */
export function endOfMonth(monthStart: string): string {
  const [year, month] = monthStart.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
}
