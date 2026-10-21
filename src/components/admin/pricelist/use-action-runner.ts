"use client";

/*
 * One mutation runner for every pricelist panel.
 *
 * WHY A HOOK RATHER THAN PER-PANEL STATE
 * --------------------------------------
 * Twelve mutations across three panels all need the same four things: a pending
 * flag, the last operator-facing error, a `router.refresh()` after success, and
 * the guarantee that a returned `{ ok: false }` is SHOWN instead of silently
 * swallowed. Duplicating that in each panel is how one panel ends up refreshing
 * and another does not — and the one that does not looks like a save that failed.
 *
 * The action result type is structural (`{ ok, error? }`) rather than importing
 * `PricelistResult`, because a `"use server"` module's exported type is fine to
 * import but keeping the hook generic lets a read-only panel reuse it later.
 */

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export function useActionRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /*
   * Which row is mid-flight. A single boolean cannot express "this row's delete
   * is running", so the whole list would disable — and on a 16-row package table
   * that reads as the page freezing.
   */
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const run = useCallback(
    (key: string, fn: () => Promise<ActionResult>, onSuccess?: () => void) => {
      setError(null);
      setPendingKey(key);
      startTransition(async () => {
        try {
          const result = await fn();
          if (!result.ok) {
            setError(result.error);
            return;
          }
          onSuccess?.();
          /*
           * The lists are server data. Without this the row an operator just
           * edited keeps rendering its old value until a full reload, which
           * makes a successful save indistinguishable from a failed one.
           */
          router.refresh();
        } catch {
          /*
           * Authorization failures throw by design (see the action module). The
           * page guard has already gated this screen, so reaching here means the
           * session changed mid-session — say so instead of showing nothing.
           */
          setError("Sesi Anda tidak lagi memiliki izin untuk tindakan ini. Muat ulang halaman.");
        } finally {
          setPendingKey(null);
        }
      });
    },
    [router],
  );

  return { run, pending, pendingKey, error, setError };
}
