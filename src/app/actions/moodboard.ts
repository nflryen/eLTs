"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServiceSupabase } from "@/lib/supabase/service";
import type {
  MoodboardCard,
  MoodboardComment,
  MoodboardCardType,
  MoodboardCardPayload,
  ShotListItem,
  AuthorRole,
} from "@/types/moodboard";

const uuidSchema = z.string().uuid();

/**
 * Fetches all visual brief cards for a project, along with attached comments and comment counts.
 */
export async function getMoodboardData(
  projectId: string
): Promise<{ cards: MoodboardCard[]; error?: string }> {
  if (!uuidSchema.safeParse(projectId).success) {
    return { cards: [], error: "Invalid project ID." };
  }

  const supabase = createServiceSupabase();

  // 1. Fetch all cards for project
  const { data: cardsData, error: cardsError } = await supabase
    .from("moodboard_cards")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (cardsError) {
    return { cards: [], error: cardsError.message };
  }

  const cardsList = cardsData ?? [];
  if (cardsList.length === 0) {
    return { cards: [] };
  }

  const cardIds = cardsList.map((c: { id: string }) => c.id);

  // 2. Fetch comments for all cards in one fast query
  const { data: commentsData, error: commentsError } = await supabase
    .from("moodboard_comments")
    .select("*")
    .in("card_id", cardIds)
    .order("created_at", { ascending: true });

  if (commentsError) {
    console.error("Error fetching moodboard comments:", commentsError);
  }

  const commentsByCardId: Record<string, MoodboardComment[]> = {};
  for (const comment of (commentsData ?? []) as MoodboardComment[]) {
    if (!commentsByCardId[comment.card_id]) {
      commentsByCardId[comment.card_id] = [];
    }
    commentsByCardId[comment.card_id].push(comment);
  }

  // 3. Assemble combined cards with attached comments
  const cards: MoodboardCard[] = cardsList.map((c: {
    id: string;
    project_id: string;
    card_type: string;
    title: string;
    payload: unknown;
    sort_order: number;
    created_at: string;
  }) => {
    const cardComments = commentsByCardId[c.id] || [];
    return {
      id: c.id,
      project_id: c.project_id,
      card_type: c.card_type as MoodboardCardType,
      title: c.title,
      payload: (c.payload || {}) as MoodboardCardPayload,
      sort_order: c.sort_order ?? 0,
      created_at: c.created_at,
      comments: cardComments,
      comment_count: cardComments.length,
    };
  });

  return { cards };
}

/**
 * Adds a new card to the project's visual brief moodboard.
 */
export async function addMoodboardCard(
  projectId: string,
  cardType: string,
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

  if (!validTypes.includes(cardType as MoodboardCardType)) {
    return { success: false, error: `Invalid card type: ${cardType}` };
  }

  const trimmedTitle = title.trim();
  if (!trimmedTitle || trimmedTitle.length > 200) {
    return { success: false, error: "Title must be between 1 and 200 characters." };
  }

  const supabase = createServiceSupabase();

  // Find next sort order
  const { data: latestCard } = await supabase
    .from("moodboard_cards")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSortOrder = (latestCard?.sort_order ?? -1) + 1;

  const { data: createdCard, error: insertError } = await supabase
    .from("moodboard_cards")
    .insert({
      project_id: projectId,
      card_type: cardType,
      title: trimmedTitle,
      payload: payload || {},
      sort_order: nextSortOrder,
    })
    .select()
    .single();

  if (insertError || !createdCard) {
    return {
      success: false,
      error: insertError?.message || "Failed to add moodboard card.",
    };
  }

  revalidatePath(`/admin/projects/${projectId}`);

  return {
    success: true,
    card: {
      ...(createdCard as unknown as MoodboardCard),
      comments: [],
      comment_count: 0,
    },
  };
}

/**
 * Toggles a checkable item in a SHOT_LIST card with optimistic feedback support.
 */
export async function toggleShotListItem(
  cardId: string,
  itemIndex: number,
  checked: boolean
): Promise<{ success: boolean; error?: string; items?: ShotListItem[] }> {
  if (!uuidSchema.safeParse(cardId).success) {
    return { success: false, error: "Invalid card ID." };
  }

  const supabase = createServiceSupabase();

  const { data: card, error: fetchErr } = await supabase
    .from("moodboard_cards")
    .select("id, project_id, card_type, payload")
    .eq("id", cardId)
    .single();

  if (fetchErr || !card) {
    return { success: false, error: "Moodboard card not found." };
  }

  if (card.card_type !== "SHOT_LIST") {
    return { success: false, error: "Card is not a shot list." };
  }

  const currentPayload = (card.payload || {}) as MoodboardCardPayload;
  const items: ShotListItem[] = [...(currentPayload.items || [])];

  if (itemIndex < 0 || itemIndex >= items.length) {
    return { success: false, error: "Shot list item index out of bounds." };
  }

  items[itemIndex] = {
    ...items[itemIndex],
    checked,
  };

  const updatedPayload: MoodboardCardPayload = {
    ...currentPayload,
    items,
  };

  const { error: updateErr } = await supabase
    .from("moodboard_cards")
    .update({ payload: updatedPayload })
    .eq("id", cardId);

  if (updateErr) {
    return { success: false, error: updateErr.message };
  }

  revalidatePath(`/admin/projects/${card.project_id}`);

  return { success: true, items };
}

/**
 * Appends a threaded comment to a visual brief card.
 */
export async function addMoodboardComment(
  cardId: string,
  content: string,
  authorRole: AuthorRole = "CLIENT",
  authorName: string = "Guest"
): Promise<{ success: boolean; error?: string; comment?: MoodboardComment }> {
  if (!uuidSchema.safeParse(cardId).success) {
    return { success: false, error: "Invalid card ID." };
  }

  const trimmedContent = content.trim();
  if (trimmedContent.length < 1 || trimmedContent.length > 2000) {
    return {
      success: false,
      error: "Comment must be between 1 and 2,000 characters.",
    };
  }

  const role: AuthorRole = authorRole === "STUDIO" ? "STUDIO" : "CLIENT";
  const name =
    authorName.trim() || (role === "STUDIO" ? "Studio Director" : "Client");

  const supabase = createServiceSupabase();

  // Verify card exists and retrieve project_id for cache revalidation
  const { data: card, error: cardErr } = await supabase
    .from("moodboard_cards")
    .select("id, project_id")
    .eq("id", cardId)
    .single();

  if (cardErr || !card) {
    return { success: false, error: "Moodboard card not found." };
  }

  const { data: newComment, error: insertErr } = await supabase
    .from("moodboard_comments")
    .insert({
      card_id: cardId,
      author_role: role,
      author_name: name,
      content: trimmedContent,
    })
    .select()
    .single();

  if (insertErr || !newComment) {
    return {
      success: false,
      error: insertErr?.message || "Failed to record comment.",
    };
  }

  revalidatePath(`/admin/projects/${card.project_id}`);

  return {
    success: true,
    comment: newComment as MoodboardComment,
  };
}

/**
 * Deletes a moodboard card and cascades comment removal.
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
    .single();

  const { error } = await supabase
    .from("moodboard_cards")
    .delete()
    .eq("id", cardId);

  if (error) {
    return { success: false, error: error.message };
  }

  if (card?.project_id) {
    revalidatePath(`/admin/projects/${card.project_id}`);
  }

  return { success: true };
}

/**
 * Seeds a comprehensive visual brief board template for a project.
 */
export async function seedDefaultMoodboard(
  projectId: string
): Promise<{ success: boolean; error?: string; count?: number }> {
  if (!uuidSchema.safeParse(projectId).success) {
    return { success: false, error: "Invalid project ID." };
  }

  const supabase = createServiceSupabase();

  const initialCards = [
    {
      project_id: projectId,
      card_type: "IMAGE_REF",
      title: "Atmospheric Editorial & Directional Light",
      sort_order: 0,
      payload: {
        imageUrl:
          "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1200&q=80",
        tags: ["Editorial", "35mm Grain", "Directional Lighting", "Chiaroscuro"],
        caption:
          "Sculptural shadow play with natural window diffusion. Emphasize organic movement, relaxed posture, and tactile silhouettes.",
        aspectRatio: "portrait",
      },
    },
    {
      project_id: projectId,
      card_type: "COLOR_SWATCH",
      title: "Calibrated Tonal Palette & Textures",
      sort_order: 1,
      payload: {
        paletteName: "Charcoal & Electric Noir",
        description:
          "Harmonized palette balancing deep onyx blacks with ethereal ivory and vibrant violet gel accents for contemporary high-fashion energy.",
        swatches: [
          {
            hex: "#0A0A0A",
            label: "Onyx Deep",
            note: "Key negative space & backdrop shadows",
          },
          {
            hex: "#4A1FB8",
            label: "Electric Violet",
            note: "Secondary gel kick & editorial rim light",
          },
          {
            hex: "#F4EFEA",
            label: "Ivory Canvas",
            note: "Wardrobe silks, natural highlights & paper",
          },
          {
            hex: "#7E7365",
            label: "Raw Umber",
            note: "Earthy architectural textures & skin midtones",
          },
        ],
      },
    },
    {
      project_id: projectId,
      card_type: "SHOT_LIST",
      title: "Core Sequences & Wishlist Framework",
      sort_order: 2,
      payload: {
        items: [
          {
            text: "Wide cinematic establishing shot highlighting spatial volume and dramatic architectural shadows",
            checked: true,
            category: "Atmosphere",
          },
          {
            text: "Tight 85mm portrait capturing raw emotional gaze with subtle catchlights",
            checked: true,
            category: "Portraits",
          },
          {
            text: "Candid shutter-drag motion blur during walking transition between sets",
            checked: false,
            category: "Movement",
          },
          {
            text: "Curated macro composition framing jewelry, raw textiles, and delicate hand placement",
            checked: false,
            category: "Details",
          },
          {
            text: "Experimental low-angle silhouette against the tinted studio diffusion wall",
            checked: false,
            category: "Experimental",
          },
        ],
      },
    },
    {
      project_id: projectId,
      card_type: "TECH_NOTE",
      title: "Technical Directives & Production Logistics",
      sort_order: 3,
      payload: {
        venueDirectives:
          "Main stage high-bay studio (South window exposure). Blackout acoustic drapes engaged for Section II lighting transition.",
        equipmentNotes:
          "Primary System: Hasselblad X2D 100C + 38V / 90V prime lenses. Secondary Run-and-Gun: Sony FX3 with anamorphic adapter.",
        lightingDirective:
          "Key: 1200W Daylight through 8x8 diffusion scrim. Rim: Aputure 600c with violet gel at 18% intensity. Maintain minimum 4:1 key-to-fill ratio.",
        timelineNotes:
          "08:30 WIB Set Call & Wardrobe Prep | 09:30 WIB Rig & Light Test | 10:00 WIB - 16:30 WIB Production Run.",
      },
    },
  ];

  const { error: insertError } = await supabase
    .from("moodboard_cards")
    .insert(initialCards);

  if (insertError) {
    return { success: false, error: insertError.message };
  }

  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true, count: initialCards.length };
}
