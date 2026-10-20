/**
 * Payroll period helpers.
 *
 * Kept out of `src/app/actions/payroll.ts` because a `"use server"` module may
 * export only async functions — a synchronous helper there fails the build with
 * "Server Actions must be async functions", and importing it from a Client
 * Component fails with "Export does not exist in target module".
 */

/** Current month as `YYYY-MM` in Jakarta time — the default payroll period. */
export function currentPayrollPeriod(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  })
    .format(now)
    .slice(0, 7);
}

/** `2026-10` -> `Oktober 2026`. */
export function payrollPeriodLabel(period: string): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return period;
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}
