/**
 * Roles that Super Admin may assign through the role tier manager.
 *
 * Lives OUTSIDE `src/app/actions/role-management.ts` because a `"use server"`
 * module may only export async functions — exporting this array from there
 * fails the build with "A 'use server' file can only export async functions,
 * found object." Same constraint that moved PAYOUT_PROVIDERS out of
 * `actions/profile.ts`.
 *
 * CLIENT is deliberately absent: clients do not authenticate as staff and are
 * provisioned through gallery sessions, not role assignment.
 */
import { ROLE_LABEL, ROLE_RANK, type RoleKey } from "@/lib/auth/role-meta";

export const ASSIGNABLE_ROLE_KEYS = [
  "SUPER_ADMIN",
  "FOUNDER",
  "ADMIN",
  "WORKER",
  "EDITOR",
  "FREELANCER",
] as const satisfies ReadonlyArray<RoleKey>;

export type AssignableRole = { key: RoleKey; label: string; rank: number };

export const ASSIGNABLE_ROLES: ReadonlyArray<AssignableRole> = ASSIGNABLE_ROLE_KEYS.map(
  (key) => ({ key, label: ROLE_LABEL[key] ?? key, rank: ROLE_RANK[key] }),
).sort((a, b) => b.rank - a.rank);
