/**
 * Jakarta-timezone date/time formatting.
 *
 * WHY THIS EXISTS
 * ---------------
 * Supabase returns `timestamptz` as UTC ISO strings (e.g.
 * `2026-10-03T00:30:00+00:00` for a 07:30 WIB roll). Slicing those strings
 * (`iso.slice(11, 16)`) silently produces UTC clock times — so a roll time of
 * 07:30 WIB rendered as "00:30". Every display of a timestamp must go through
 * these helpers so the studio always reads Jakarta wall-clock time.
 */

export const JAKARTA_TZ = "Asia/Jakarta";

/** "07:30" in Jakarta, from any ISO timestamp. */
export function jakartaTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: JAKARTA_TZ,
  });
}

/** "07:30:00" in Jakarta — for the call-sheet roll line. */
export function jakartaTimeSeconds(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: JAKARTA_TZ,
  });
}

/** "Sabtu, 3 Oktober 2026" in Jakarta. */
export function jakartaLongDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: JAKARTA_TZ,
  });
}

/** "3 Okt" in Jakarta. */
export function jakartaShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: JAKARTA_TZ,
  });
}

/**
 * Builds a Jakarta-local ISO instant from a plain date + wall-clock time.
 * Used for the countdown, where the target must be an absolute instant.
 */
export function jakartaInstant(dateStr: string, timeStr: string): string {
  const [h, m, s] = timeStr.split(":");
  return `${dateStr}T${(h ?? "00").padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}:${(s ?? "00").padStart(2, "0")}+07:00`;
}
