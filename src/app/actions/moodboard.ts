"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getRoleSession } from "@/lib/auth/roles";
import { getGallerySession } from "@/lib/auth/gallery";
import type { MoodboardCardRow } from "@/types/database";
import {
  canPerformMoodboardAction,
  deriveCommentAuthor,
  resolveMoodboardPrincipal,
  type MoodboardPrincipal,
} from "@/lib/auth/moodboard-access";
import type {
  MoodboardCard,
  MoodboardComment,
  MoodboardCardType,
  MoodboardCardPayload,
  ShotListItem,
  AuthorRole,
} from "@/types/moodboard";

const uuidSchema = z.string().uuid();

/*
 * AUTHORIZATION MODEL
 * -------------------
 * These actions previously ran on the service client with NO authentication at
 * all. `createServiceSupabase()` bypasses RLS by definition, so every exported
 * action here was an unauthenticated write endpoint: any visitor could delete
 * cards by UUID, and `addMoodboardComment` accepted `authorRole`/`authorName`
 * straight from the caller, so anyone could post as "STUDIO".
 *
 * Two principals are legitimate for a moodboard, and they are now resolved
 * SERVER-SIDE, never from arguments:
 *
 *   STUDIO  — an authenticated staff member with rank >= 60 who is authorised
 *             for the project. Author identity comes from their profile.
 *   CLIENT  — a holder of a gallery session for exactly this project. Author
 *             identity is "Client"; they may comment and tick shot-list items,
 *             but may not create or delete cards.
 *
 * `authorRole` and `authorName` are no longer parameters. They are derived.
 */

/**
 * Resolves who is calling, using the shared pure policy.
 *
 * All authorization DECISIONS live in `@/lib/auth/moodboard-access` so they are
 * unit-testable offline; this wrapper only gathers the inputs.
 */
async function resolvePrincipal(projectId: string): Promise<MoodboardPrincipal | null> {
  const staff = await getRoleSession().catch(() => null);
  const gallery = await getGallerySession().catch(() => null);

  return resolveMoodboardPrincipal({
    staff: staff
      ? { userId: staff.user.id, name: staff.displayName, rank: staff.rank }
      : null,
    galleryProjectId: gallery?.project_id ?? null,
    projectId,
  });
}

/**
 * Fetches all visual brief cards for a project, with comments and counts.
 */
export async function getMoodboardData(
  projectId: string
): Promise<{ cards: MoodboardCard[]; error?: string }> {
  if (!uuidSchema.safeParse(projectId).success) {
    return { cards: [], error: "Invalid project ID." };
  }

  const principal = await resolvePrincipal(projectId);
  if (!principal) return { cards: [], error: "Not authorised for this project." };

  const supabase = createServiceSupabase();

  const { data: cardsData, error: cardsError } = await supabase
    .from("moodboard_cards")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });

  if (cardsError) {
    return { cards: [], error: cardsError.message };
  }

  const cardsList = cardsData ?? [];
  const cardIds = cardsList.map((c: { id: string }) => c.id);

  let commentsByCard: Record<string, MoodboardComment[]> = {};
  if (cardIds.length > 0) {
    const { data: commentsData } = await supabase
      .from("moodboard_comments")
      .select("*")
      .in("card_id", cardIds)
      .order("created_at", { ascending: true });

    commentsByCard = (commentsData ?? []).reduce(
      (acc: Record<string, MoodboardComment[]>, row) => {
        const c = row as unknown as MoodboardComment;
        (acc[c.card_id] ??= []).push(c);
        return acc;
      },
      {}
    );
  }

  const cards: MoodboardCard[] = cardsList.map((row) => {
    const card = row as unknown as MoodboardCard;
    const comments = commentsByCard[card.id] ?? [];
    return { ...card, comments, comment_count: comments.length };
  });

  return { cards };
}

/**
 * Adds a new card to the project's visual brief moodboard.
 *
 * STUDIO only for TECH_NOTE; CLIENT may add image references and shot lists.
 */
export async function addMoodboardCard(
  projectId: string,
  cardType: MoodboardCardType,
  title: string,
  payload: MoodboardCardPayload = {}
): Promise<{ success: boolean; error?: string; card?: MoodboardCard }> {
  if (!uuidSchema.safeParse(projectId).success) {
    return { success: false, error: "Invalid project ID." };
  }

  const validTypes: MoodboardCardType[] = [
    "IMAGE_REF",
    "COLOR_SWATCH",
    "SHOT_LIST",
    "TECH_NOTE",
  ];

  if (!validTypes.includes(cardType)) {
    return { success: false, error: `Invalid card type: ${cardType}` };
  }

  const trimmedTitle = title.trim();
  if (!trimmedTitle || trimmedTitle.length > 200) {
    return { success: false, error: "Title must be between 1 and 200 characters." };
  }

  const principal = await resolvePrincipal(projectId);
  if (!principal) return { success: false, error: "Not authorised for this project." };

  if (!canPerformMoodboardAction(principal, "createCard", cardType)) {
    return { success: false, error: "Not permitted." };
  }

  const supabase = createServiceSupabase();

  const { data: latestCard } = await supabase
    .from("moodboard_cards")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = ((latestCard?.sort_order as number | undefined) ?? 0) + 1;

  const { data, error } = await supabase
    .from("moodboard_cards")
    .insert({
      project_id: projectId,
      card_type: cardType,
      title: trimmedTitle,
      payload,
      sort_order: nextOrder,
    })
    .select("*")
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/gallery`);
  return { success: true, card: data as unknown as MoodboardCard };
}

/**
 * Toggles a shot-list item's checked state.
 *
 * Both principals may do this — it is the client's approval mechanism.
 */
export async function toggleShotListItem(
  cardId: string,
  itemIndex: number,
  checked: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!uuidSchema.safeParse(cardId).success) {
    return { success: false, error: "Invalid card ID." };
  }

  if (!Number.isInteger(itemIndex) || itemIndex < 0) {
    return { success: false, error: "Invalid item index." };
  }

  const supabase = createServiceSupabase();

  const { data: card } = await supabase
    .from("moodboard_cards")
    .select("id, project_id, card_type, payload")
    .eq("id", cardId)
    .maybeSingle();

  if (!card) return { success: false, error: "Card not found." };

  const principal = await resolvePrincipal(card.project_id as string);
  if (!principal) return { success: false, error: "Not authorised for this project." };

  const payload = (card.payload ?? {}) as MoodboardCardPayload;
  const items: ShotListItem[] = Array.isArray(payload.shotList) ? payload.shotList : [];

  if (itemIndex >= items.length) {
    return { success: false, error: "Item not found." };
  }

  /*
   * Positional update, matching the caller's contract. The explicit state is
   * taken from the caller rather than toggled server-side so a double-click
   * cannot land on an unintended value.
   */
  const next = items.map((item, idx) => (idx === itemIndex ? { ...item, checked } : item));

  const { error } = await supabase
    .from("moodboard_cards")
    .update({ payload: { ...payload, shotList: next } })
    .eq("id", cardId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/admin/projects/${card.project_id}`);
  revalidatePath(`/gallery`);
  return { success: true };
}

/**
 * Appends a threaded comment to a visual brief card.
 *
 * The author identity is DERIVED, never supplied. This is the fix for the
 * identity-spoofing hole: the previous signature was
 * `addMoodboardComment(cardId, content, authorRole, authorName)` and both
 * author fields were written verbatim, so any caller could post as STUDIO.
 */
export async function addMoodboardComment(
  cardId: string,
  content: string
): Promise<{ success: boolean; error?: string; comment?: MoodboardComment }> {
  if (!uuidSchema.safeParse(cardId).success) {
    return { success: false, error: "Invalid card ID." };
  }

  const trimmedContent = content.trim();
  if (trimmedContent.length < 1 || trimmedContent.length > 2000) {
    return { success: false, error: "Comment must be between 1 and 2,000 characters." };
  }

  const supabase = createServiceSupabase();

  const { data: card, error: cardErr } = await supabase
    .from("moodboard_cards")
    .select("id, project_id")
    .eq("id", cardId)
    .maybeSingle();

  if (cardErr || !card) {
    return { success: false, error: "Moodboard card not found." };
  }

  const principal = await resolvePrincipal(card.project_id as string);
  if (!principal) return { success: false, error: "Not authorised for this project." };

  const author = deriveCommentAuthor(principal);
  const role: AuthorRole = author.role;
  const name = author.name;

  const { data, error } = await supabase
    .from("moodboard_comments")
    .insert({
      card_id: cardId,
      content: trimmedContent,
      author_role: role,
      author_name: name,
    })
    .select("*")
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath(`/admin/projects/${card.project_id}`);
  revalidatePath(`/gallery`);
  return { success: true, comment: data as unknown as MoodboardComment };
}

/**
 * Deletes a card. STUDIO only, and only for a project the caller may access.
 */
export async function deleteMoodboardCard(
  cardId: string
): Promise<{ success: boolean; error?: string }> {
  if (!uuidSchema.safeParse(cardId).success) {
    return { success: false, error: "Invalid card ID." };
  }

  const supabase = createServiceSupabase();

  const { data: card } = await supabase
    .from("moodboard_cards")
    .select("project_id")
    .eq("id", cardId)
    .maybeSingle();

  if (!card) return { success: false, error: "Card not found." };

  const principal = await resolvePrincipal(card.project_id as string);
  if (!principal) return { success: false, error: "Not authorised for this project." };

  if (!canPerformMoodboardAction(principal, "deleteCard")) {
    return { success: false, error: "Not permitted." };
  }

  const { error } = await supabase.from("moodboard_cards").delete().eq("id", cardId);
  if (error) return { success: false, error: error.message };

  revalidatePath(`/admin/projects/${card.project_id}`);
  revalidatePath(`/gallery`);
  return { success: true };
}

/**
 * Seeds the default visual brief template. STUDIO only — it is a bulk write.
 */
export async function seedDefaultMoodboard(
  projectId: string
): Promise<{ success: boolean; error?: string; count?: number }> {
  if (!uuidSchema.safeParse(projectId).success) {
    return { success: false, error: "Invalid project ID." };
  }

  const principal = await resolvePrincipal(projectId);
  if (!principal) return { success: false, error: "Not authorised for this project." };

  if (!canPerformMoodboardAction(principal, "seedDefaults")) {
    return { success: false, error: "Not permitted." };
  }

  const supabase = createServiceSupabase();

  const { count } = await supabase
    .from("moodboard_cards")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  if ((count ?? 0) > 0) {
    return { success: false, error: "Moodboard already has cards." };
  }

  const initialCards: MoodboardCardRow[] = [
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      card_type: "IMAGE_REF",
      title: "Atmospheric Editorial & Directional Light",
      sort_order: 1,
      payload: {
        imageUrl: "",
        tags: ["editorial", "moody"],
        caption: "Reference for low-key directional lighting.",
        aspectRatio: "4:5",
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as MoodboardCardRow,
  ];

  const { error } = await supabase.from("moodboard_cards").insert(initialCards);
  if (error) return { success: false, error: error.message };

  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true, count: initialCards.length };
}
