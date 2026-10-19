/**
 * Role metadata shared by the server layout and the client view-as switcher.
 *
 * Deliberately dependency-free and free of "server-only" / "client-only"
 * imports so both a Server Component and a Client Component can import it.
 */

export type RoleKey =
  | "SUPER_ADMIN"
  | "FOUNDER"
  | "ADMIN"
  | "WORKER"
  | "FREELANCER"
  | "CLIENT";

export const ROLE_RANK: Record<RoleKey, number> = {
  SUPER_ADMIN: 120,
  FOUNDER: 100,
  ADMIN: 80,
  WORKER: 60,
  FREELANCER: 30,
  CLIENT: 10,
};

export const ROLE_LABEL: Record<RoleKey, string> = {
  SUPER_ADMIN: "Super Admin",
  FOUNDER: "Founder",
  ADMIN: "Operations Lead",
  WORKER: "Kreatif",
  FREELANCER: "Field Crew",
  CLIENT: "Client",
};

/**
 * Roles a SUPER_ADMIN may preview.
 *
 * FREELANCER and CLIENT are excluded on purpose: they do not have an
 * `/admin` surface at all, and they authenticate through magic links and
 * gallery sessions rather than a staff identity. Pre-rendering the admin shell
 * as a role that can never reach it would be a misleading preview.
 */
export const PREVIEWABLE_ROLES = [
  "SUPER_ADMIN",
  "FOUNDER",
  "ADMIN",
  "WORKER",
] as const satisfies readonly RoleKey[];

export type PreviewableRole = (typeof PREVIEWABLE_ROLES)[number];

export function isPreviewableRole(value: unknown): value is PreviewableRole {
  return (
    typeof value === "string" &&
    (PREVIEWABLE_ROLES as readonly string[]).includes(value)
  );
}
