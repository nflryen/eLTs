import "server-only";

/**
 * Telemetry value model.
 *
 * WHY NOT PLAIN NUMBERS
 * ---------------------
 * The previous cockpit initialised every figure to `0` and added to it inside a
 * `try`. When a query failed the dashboard showed a confident "Rp 0" and "0
 * proyek aktif" — indistinguishable from a genuinely quiet month. Operators
 * act on these tiles, so a wrong zero is worse than a visible gap.
 *
 * Every metric is therefore either:
 *   { state: "ok",    value }  — measured, trustworthy
 *   { state: "empty", value: 0 } — measured, and genuinely nothing exists yet
 *   { state: "error" }          — could not be measured; UI renders "—"
 *   { state: "hidden" }         — caller lacks the rank to see this metric
 *
 * "hidden" is deliberately distinct from "error" and "empty": a lower role must
 * not be able to infer restricted figures from the shape of the page.
 */
export type MetricStatus = "ok" | "empty" | "error" | "hidden";

export type Metric<T = number> =
  | { state: "ok"; value: T }
  | { state: "empty"; value: T }
  | { state: "error" }
  | { state: "hidden" };

export function ok<T>(value: T): Metric<T> {
  return { state: "ok", value };
}

export function emptyZero(): Metric<number> {
  return { state: "empty", value: 0 };
}

export function failed<T = number>(): Metric<T> {
  return { state: "error" };
}

export function hidden<T = number>(): Metric<T> {
  return { state: "hidden" };
}

/**
 * Type guard: narrows to the measured arms so `.value` is safe to read.
 * A `boolean`-returning helper would not narrow, forcing casts at every caller.
 */
export function isMeasured<T>(metric: Metric<T>): metric is Extract<Metric<T>, { state: "ok" | "empty" }> {
  return metric.state === "ok" || metric.state === "empty";
}

/** Read a metric for arithmetic without ever inventing a value. */
export function numericOrNull(metric: Metric<number>): number | null {
  return isMeasured(metric) ? metric.value : null;
}

/**
 * Wrap one query so a thrown client error and a PostgREST error both become
 * `error` rather than a silent zero.
 *
 * NOTE ON `head: true`: a count query resolves `{ data: null, count: N }`.
 * Treating a null payload as failure — as an earlier version did — made every
 * count tile render "—" even though the count had arrived. The selector
 * therefore receives the WHOLE response, so a caller can read `count` or `data`
 * as appropriate and decide for itself what "missing" means.
 */
export async function measure<Row, T>(
  query: PromiseLike<{ data: Row[] | null; count?: number | null; error: unknown }>,
  select: (response: { data: Row[] | null; count: number | null }) => T
): Promise<T> {
  try {
    const { data, count, error } = await query;
    if (error) return select({ data: null, count: null });
    return select({ data: data ?? null, count: typeof count === "number" ? count : null });
  } catch {
    return select({ data: null, count: null });
  }
}

/** Count helper: `null` count means "not measured", never "zero". */
export function countMetric(count: number | null | undefined): Metric {
  if (typeof count !== "number") return failed();
  return count === 0 ? emptyZero() : ok(count);
}
