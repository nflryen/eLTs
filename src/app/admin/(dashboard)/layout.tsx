import type { Metadata } from "next";
import { StudioShell } from "@/components/admin/studio-shell";

export const metadata: Metadata = {
  title: "Studio OS — Elts.",
  robots: { index: false, follow: false },
};

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
