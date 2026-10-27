import type { Metadata } from "next";
import { StudioShell } from "@/components/admin/studio-shell";

export const metadata: Metadata = {
  title: "Studio OS — Elts.",
  robots: { index: false, follow: false },
};

/*
 * FORCE DYNAMIC — not an optimisation, a CORRECTNESS requirement.
 *
 * Every route under this layout is per-user: it reads cookies, resolves the
 * caller's role from the database, and renders a sidebar that differs by rank.
 * Without this directive Next.js attempts to prerender it at build time, which
 * has two failure modes:
 *
 *   1. BUILD FAILURE. `createServerSupabase()` validates the environment before
 *      it ever awaits `cookies()`. During prerender there is no request, the
 *      config is unavailable on some build environments, and the throw surfaces
 *      as "Error occurred prerendering page /admin".
 *
 *   2. SILENTLY WRONG OUTPUT — worse than the build error. On a build WITH env
 *      vars present, prerendering succeeds and captures the render of an
 *      unauthenticated request: a page whose only content is "redirect to
 *      /admin/login". That static artifact could then be served to a signed-in
 *      operator. An authenticated surface must never be prerendered, regardless
 *      of whether the build happens to succeed.
 */
export const dynamic = "force-dynamic";

/**
 * Admin dashboard layout.
 *
 * The shell itself lives in `components/admin/studio-shell.tsx` and is mounted
 * by BOTH this layout and `/settings/layout.tsx`, so the sidebar, topbar and
 * responsive wrapper are identical on every authenticated surface. See that
 * file for the nav map and rank gates.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <StudioShell>{children}</StudioShell>;
}
