/**
 * Moodboard authorization decisions, extracted as a PURE function.
 *
 * WHY THIS IS SEPARATE FROM THE SERVER ACTION
 * -------------------------------------------
 * The Server Action needs `next/headers`, cookies, and a database connection, so
 * it cannot be exercised by the offline test suite. The *decision* it makes can
 * be, and that decision is the security boundary: given a caller and a target
 * card, may this caller read / create / delete / comment?
 *
 * Keeping it pure means the rule is testable without a network and cannot drift
 * into the component layer.
 */

export type MoodboardPrincipal =
  | { kind: "STUDIO"; userId: string; name: string; rank: number }
  | { kind: "CLIENT"; projectId: string; name: string };

export type MoodboardAction =
  | "read"
  | "createCard"
  | "toggleShotListItem"
  | "comment"
  | "deleteCard"
  | "seedDefaults";

/** Card types only the studio may author. */
export const STUDIO_ONLY_CARD_TYPES = ["TECH_NOTE"] as const;

/** Minimum staff rank that may touch a moodboard at all. */
export const MOODBOARD_MIN_STAFF_RANK = 60;

/**
 * Resolves the principal, failing closed.
 *
 * Staff must be authorised for the project; a client must hold a gallery
 * session for EXACTLY this project. Anything else is `null` and every caller
 * treats that as "deny".
 */
export function resolveMoodboardPrincipal(input: {
  staff: { userId: string; name: string; rank: number } | null;
  /** Project id from the caller's gallery session, if any. */
  galleryProjectId: string | null;
  projectId: string;
}): MoodboardPrincipal | null {
  const { staff, galleryProjectId, projectId } = input;

  if (staff && staff.rank >= MOODBOARD_MIN_STAFF_RANK) {
    return { kind: "STUDIO", userId: staff.userId, name: staff.name || "Studio", rank: staff.rank };
  }

  /*
   * A gallery session is scoped to one project. Comparing it to the requested
   * project is what stops a client with access to project A from reading or
   * writing project B's board.
   */
  if (galleryProjectId && galleryProjectId === projectId) {
    return { kind: "CLIENT", projectId: galleryProjectId, name: "Client" };
  }

  return null;
}

/** Decides whether `principal` may perform `action` on a card of `cardType`. */
export function canPerformMoodboardAction(
  principal: MoodboardPrincipal | null,
  action: MoodboardAction,
  cardType?: string,
): boolean {
  if (!principal) return false;

  if (principal.kind === "STUDIO") return true;

  /* CLIENT permissions — deliberately narrow. */
  switch (action) {
    case "read":
    case "toggleShotListItem":
    case "comment":
      return true;
    case "createCard":
      /*
       * A client may add visual references and shot lists, but not studio-only
       * technical notes, and never without a concrete card type.
       */
      return Boolean(cardType) && !(STUDIO_ONLY_CARD_TYPES as readonly string[]).includes(cardType!);
    case "deleteCard":
    case "seedDefaults":
      return false;
    default:
      return false;
  }
}

/**
 * The author identity written to `moodboard_comments`.
 *
 * DERIVED, never supplied by the caller. The previous implementation accepted
 * `authorRole` and `authorName` as parameters and wrote them verbatim, which let
 * any caller post as "STUDIO".
 */
export function deriveCommentAuthor(principal: MoodboardPrincipal): {
  role: "STUDIO" | "CLIENT";
  name: string;
} {
  return principal.kind === "STUDIO"
    ? { role: "STUDIO", name: principal.name }
    : { role: "CLIENT", name: "Client" };
}
