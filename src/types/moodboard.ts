export type MoodboardCardType =
  | "IMAGE_REF"
  | "COLOR_SWATCH"
  | "SHOT_LIST"
  | "TECH_NOTE";

export type AuthorRole = "CLIENT" | "STUDIO";

export interface MoodboardComment {
  id: string;
  card_id: string;
  author_role: AuthorRole;
  author_name: string;
  content: string;
  created_at: string;
}

export interface ShotListItem {
  text: string;
  checked: boolean;
  category?: string;
  note?: string;
}

export interface ColorSwatchItem {
  hex: string;
  label?: string;
  note?: string;
}

export interface MoodboardCardPayload {
  // IMAGE_REF
  imageUrl?: string;
  tags?: string[];
  caption?: string;
  aspectRatio?: "square" | "portrait" | "landscape" | "video";

  // COLOR_SWATCH
  swatches?: ColorSwatchItem[];
  paletteName?: string;
  description?: string;

  // SHOT_LIST
  items?: ShotListItem[];

  // TECH_NOTE
  venueDirectives?: string;
  equipmentNotes?: string;
  lightingDirective?: string;
  timelineNotes?: string;
  notes?: string;

  [key: string]: unknown;
}

export interface MoodboardCard {
  id: string;
  project_id: string;
  card_type: MoodboardCardType;
  title: string;
  payload: MoodboardCardPayload;
  sort_order: number;
  created_at: string;
  comments?: MoodboardComment[];
  comment_count?: number;
}
