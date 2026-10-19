"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Persisted sidebar collapse preference.
 *
 * WHY `useSyncExternalStore`
 * --------------------------
 * `localStorage` is an external store, not React state. Reading it in an effect
 * and calling `setState` would (a) trip `react-hooks/set-state-in-effect` and
 * (b) render the expanded sidebar for one frame before snapping to collapsed —
 * a visible stutter on every page load.
 *
 * This hook renders the SERVER snapshot (expanded) during hydration, then swaps
 * to the stored value in the same commit React uses for hydration. The width is
 * transitioned, so the swap reads as an intentional animation rather than a
 * flash.
 */

const STORAGE_KEY = "elts:sidebar:collapsed";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // A second tab changing the preference should update this one too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Private mode / disabled storage: stay expanded rather than break.
    return false;
  }
}

function writeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* non-fatal */
  }
  for (const listener of listeners) listener();
}

export function useSidebarCollapsed(): [boolean, () => void, (value: boolean) => void] {
  const collapsed = useSyncExternalStore(
    subscribe,
    readCollapsed,
    // Server/FIRST-RENDER snapshot: expanded. Must match the server HTML.
    () => false
  );

  const toggle = useCallback(() => writeCollapsed(!readCollapsed()), []);
  const set = useCallback((value: boolean) => writeCollapsed(value), []);

  return [collapsed, toggle, set];
}

export { STORAGE_KEY as SIDEBAR_STORAGE_KEY };
