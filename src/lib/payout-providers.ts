/**
 * Payout providers offered on the profile form.
 *
 * Lives OUTSIDE `src/app/actions/profile.ts` because a `"use server"` module may
 * only export async functions — exporting this object from there fails the
 * build with "A 'use server' file can only export async functions, found
 * object." It is dependency-free so Client Components can import it.
 */
export const PAYOUT_PROVIDERS = [
  { value: "BCA", label: "BCA", kind: "BANK" as const },
  { value: "Mandiri", label: "Mandiri", kind: "BANK" as const },
  { value: "BNI", label: "BNI", kind: "BANK" as const },
  { value: "BRI", label: "BRI", kind: "BANK" as const },
  { value: "Seabank", label: "Seabank", kind: "BANK" as const },
  { value: "GoPay", label: "GoPay", kind: "EWALLET" as const },
  { value: "OVO", label: "OVO", kind: "EWALLET" as const },
] as const;

export type PayoutProvider = (typeof PAYOUT_PROVIDERS)[number];
