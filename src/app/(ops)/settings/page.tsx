import { redirect } from "next/navigation";

/**
 * Settings hub index.
 *
 * Redirects to the first tab. Kept as a server component so the redirect is a
 * real 307 rather than a client-side push, and so a bookmarked `/settings`
 * lands deterministically.
 */
export default function SettingsIndexPage() {
  redirect("/settings/profile");
}
