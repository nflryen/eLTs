import { redirect } from "next/navigation";

/**
 * Consolidated into the Settings Hub.
 *
 * The role tier manager now lives at /settings/users so that every
 * account-level surface sits behind one layout and one guard. This route is
 * kept as a permanent redirect rather than deleted, because bookmarks, the
 * middleware rank map, and any printed runbook may still reference it.
 *
 * `redirect()` here is unconditional: /settings/users performs the actual
 * SUPER_ADMIN check and redirects unauthorised callers onward.
 */
export default function LegacyAdminUsersPage() {
  redirect("/settings/users");
}
