/**
 * Projects view contract.
 *
 * Lives outside the client component because a `"use client"` module's exports
 * become client references: the server page cannot CALL `parseView` from there,
 * only render it. Keeping the parser here lets the server resolve the view on
 * first paint, which is what prevents a card/table flash after hydration.
 */

export type ProjectsView = "cards" | "list";

export const PROJECTS_VIEW_STORAGE_KEY = "elts:projects:view";

/**
 * Resolve the view from a URL parameter.
 *
 * Cards is the default because the directory is a visual browsing surface; the
 * table is the deliberate choice for dense administrative scanning.
 */
export function parseView(raw: string | null | undefined): ProjectsView {
  return raw === "list" ? "list" : "cards";
}
