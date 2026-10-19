/**
 * Pillar-aware workspace configuration.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every project previously mounted all eight workspace modules regardless of
 * what kind of work it was. A live broadcast opened with a client photo-proofing
 * engine, and a graduation shoot carried minute-by-minute rundown scaffolding it
 * would never use. That is not a missing feature — it is noise on every screen.
 *
 * WHY A TABLE AND NOT `if/else`
 * -----------------------------
 * Scattered conditionals drift: two components disagree, a new pillar gets
 * handled in one place and forgotten in another. This module is the single
 * source of truth, exhaustively typed, so adding a pillar without deciding its
 * modules is a compile error rather than a silent bug.
 *
 * HIDDEN, NOT GREYED OUT
 * ----------------------
 * Per product direction, unrelated modules are removed from the primary tab
 * strip entirely (zero clutter). They remain discoverable through an overflow
 * disclosure that names the reason, and an admin may force-enable one for a
 * hybrid shoot.
 */

export type Pillar =
  | "EVENT_GRADUATION_PHOTO"
  | "BROADCAST_LIVE_STREAMING"
  | "COMMERCIAL_VIDEO";

/** Every module the console can mount. */
export type FeatureId =
  | "callsheet"
  | "sector"
  | "crew"
  | "gear"
  | "invoice"
  | "rab"
  | "media"
  | "proofing";

export type PillarConfig = {
  id: Pillar;
  /** Human label used in the folder card tag and the console header. */
  label: string;
  /** Short badge text for dense surfaces (folder card chip). */
  tag: string;
  /** Modules mounted for this pillar, in tab order. */
  modules: readonly FeatureId[];
  /**
   * Modules intentionally excluded, with the operator-facing reason.
   * Keys must not overlap `modules`; enforced by `assertPillarConfig`.
   */
  excluded: Partial<Record<FeatureId, string>>;
};

const COMMON: readonly FeatureId[] = ["callsheet", "sector", "crew", "gear", "invoice", "rab"];

export const PILLAR_CONFIG: Record<Pillar, PillarConfig> = {
  EVENT_GRADUATION_PHOTO: {
    id: "EVENT_GRADUATION_PHOTO",
    label: "Wisuda & Foto",
    tag: "Graduation",
    // Proofing is the heart of this pillar: the client picks favourites, the
    // studio locks selection, and hi-res delivery unlocks on payment.
    // `callsheet` is excluded below, so the shared core is filtered explicitly.
    modules: [...COMMON.filter((id) => id !== "callsheet"), "media", "proofing"],
    excluded: {
      // This pillar is driven by the client's photo selection, not by a
      // minute-by-minute cue sheet the operator would never maintain.
      callsheet: "Rundown menit-per-menit tidak dipakai pada sesi foto wisuda.",
    },
  },

  BROADCAST_LIVE_STREAMING: {
    id: "BROADCAST_LIVE_STREAMING",
    label: "Siaran Langsung",
    tag: "Broadcast",
    // Signal, crew positions and gear manifests are the job. Photo proofing is
    // meaningless: there is no gallery to curate during a live switch.
    modules: ["callsheet", "sector", "crew", "gear", "invoice", "rab", "media"],
    excluded: {
      proofing: "Proofing tidak berlaku untuk produksi siaran langsung — tidak ada sesi pemilihan foto klien.",
    },
  },

  COMMERCIAL_VIDEO: {
    id: "COMMERCIAL_VIDEO",
    label: "Produksi Komersial",
    tag: "Commercial",
    // Shoots on a schedule with a deliverable, so both allocation and delivery
    // matter. Proofing stays available for client review cuts.
    modules: [...COMMON, "media", "proofing"],
    excluded: {},
  },
};

export const ALL_PILLARS = Object.keys(PILLAR_CONFIG) as Pillar[];

/** Type guard for an arbitrary database string. */
export function isPillar(value: unknown): value is Pillar {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PILLAR_CONFIG, value);
}

/**
 * Resolve a project's pillar config.
 *
 * An unknown or missing pillar returns the FULL matrix rather than an empty one:
 * a data problem must never hide a module the operator legitimately needs.
 * `isFallback` lets the console warn instead of pretending the config matched.
 */
export function resolvePillarConfig(raw: string | null | undefined): {
  config: PillarConfig;
  isFallback: boolean;
} {
  if (isPillar(raw)) return { config: PILLAR_CONFIG[raw], isFallback: false };
  return { config: FALLBACK_CONFIG, isFallback: true };
}

/** Everything enabled — used for unknown pillars and the force-enable escape hatch. */
export const FALLBACK_CONFIG: PillarConfig = {
  id: "COMMERCIAL_VIDEO",
  label: "Semua Modul",
  tag: "Lainnya",
  modules: [...COMMON, "media", "proofing"],
  excluded: {},
};

/** Modules hidden for this pillar, with reasons, for the overflow disclosure. */
export function excludedModules(
  config: PillarConfig,
  forceEnabled: readonly FeatureId[] = []
): Array<{ id: FeatureId; reason: string }> {
  return (Object.entries(config.excluded) as Array<[FeatureId, string]>)
    .filter(([id]) => !forceEnabled.includes(id))
    .map(([id, reason]) => ({ id, reason }));
}

/**
 * Tabs to render: the pillar's modules plus any admin force-enabled ones, in a
 * stable canonical order so force-enabling does not reshuffle the tab strip.
 */
export function visibleModules(
  config: PillarConfig,
  forceEnabled: readonly FeatureId[] = []
): FeatureId[] {
  const CANONICAL: readonly FeatureId[] = [
    "callsheet", "sector", "crew", "gear", "invoice", "rab", "media", "proofing",
  ];
  const enabled = new Set<FeatureId>([...config.modules, ...forceEnabled]);
  return CANONICAL.filter((id) => enabled.has(id));
}
