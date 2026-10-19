"use client";

import React, { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import {
  Sparkles,
  MessageSquare,
  Plus,
  Trash2,
  ExternalLink,
  X,
  CheckCircle2,
  Circle,
} from "lucide-react";
import type {
  MoodboardCard,
  MoodboardCardType,
  MoodboardComment,
  MoodboardCardPayload,
} from "@/types/moodboard";
import {
  getMoodboardData,
  addMoodboardCard,
  deleteMoodboardCard,
  toggleShotListItem,
  seedDefaultMoodboard,
} from "@/app/actions/moodboard";
import { CardCommentDrawer } from "@/components/client/moodboard/card-comment-drawer";

interface MoodboardReviewProps {
  projectId: string;
  projectSlug?: string;
  projectName?: string;
  directorName?: string;
  initialCards?: MoodboardCard[];
}

export function MoodboardReview({
  projectId,
  projectSlug,
  directorName = "Studio Director",
  initialCards,
}: MoodboardReviewProps) {
  const [cards, setCards] = useState<MoodboardCard[]>(initialCards || []);
  const [isLoading, setIsLoading] = useState(!initialCards);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // New card form state
  const [newType, setNewType] = useState<MoodboardCardType>("IMAGE_REF");
  const [newTitle, setNewTitle] = useState("");
  const [imgUrl, setImgUrl] = useState("");
  const [imgTags, setImgTags] = useState("");
  const [imgCaption, setImgCaption] = useState("");
  const [swatchHexes, setSwatchHexes] = useState("#0A0A0A, #4A1FB8, #F4EFEA");
  const [paletteDesc, setPaletteDesc] = useState("");
  const [shotItemsRaw, setShotItemsRaw] = useState("");
  const [techVenue, setTechVenue] = useState("");
  const [techEquip, setTechEquip] = useState("");
  const [techLight, setTechLight] = useState("");
  const [techTimeline, setTechTimeline] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  // Load cards if not passed via props
  useEffect(() => {
    if (!initialCards) {
      let isMounted = true;
      getMoodboardData(projectId).then((res) => {
        if (isMounted) {
          setCards(res.cards || []);
          setIsLoading(false);
        }
      });
      return () => {
        isMounted = false;
      };
    }
  }, [projectId, initialCards]);

  const activeCard = cards.find((c) => c.id === selectedCardId) ?? null;

  // ── Toggle Shot List Item ────────────────────────────────────────────────
  async function handleToggleShot(cardId: string, itemIndex: number) {
    const targetCard = cards.find((c) => c.id === cardId);
    if (!targetCard || !targetCard.payload.items) return;
    const currentItem = targetCard.payload.items[itemIndex];
    if (!currentItem) return;

    const newChecked = !currentItem.checked;

    // Optimistic local update
    setCards((prev) =>
      prev.map((c) => {
        if (c.id !== cardId || !c.payload.items) return c;
        const nextItems = [...c.payload.items];
        nextItems[itemIndex] = {
          ...nextItems[itemIndex],
          checked: newChecked,
        };
        return {
          ...c,
          payload: { ...c.payload, items: nextItems },
        };
      })
    );

    const res = await toggleShotListItem(cardId, itemIndex, newChecked);
    if (!res.success) {
      // Revert
      setCards((prev) =>
        prev.map((c) => {
          if (c.id !== cardId || !c.payload.items) return c;
          const reverted = [...c.payload.items];
          reverted[itemIndex] = {
            ...reverted[itemIndex],
            checked: !newChecked,
          };
          return {
            ...c,
            payload: { ...c.payload, items: reverted },
          };
        })
      );
    }
  }

  // ── Delete Card ──────────────────────────────────────────────────────────
  async function handleDeleteCard(cardId: string) {
    if (!confirm("Are you sure you want to remove this visual brief card?")) {
      return;
    }

    const previousCards = [...cards];
    setCards((prev) => prev.filter((c) => c.id !== cardId));

    const res = await deleteMoodboardCard(cardId);
    if (!res.success) {
      alert("Failed to delete card: " + (res.error || "Unknown error"));
      setCards(previousCards);
    }
  }

  // ── Seed Default Cards ───────────────────────────────────────────────────
  function handleSeed() {
    startTransition(async () => {
      const res = await seedDefaultMoodboard(projectId);
      if (res.success) {
        const fresh = await getMoodboardData(projectId);
        setCards(fresh.cards || []);
      } else {
        alert("Could not load template: " + res.error);
      }
    });
  }

  // ── Handle Hex Copy ──────────────────────────────────────────────────────
  async function handleCopyHex(hex: string) {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedHex(hex);
      setTimeout(() => setCopiedHex(null), 2000);
    } catch {
      setCopiedHex(hex);
      setTimeout(() => setCopiedHex(null), 2000);
    }
  }

  // ── Create Card Submission ───────────────────────────────────────────────
  async function handleCreateCard(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) {
      setFormError("Title is required.");
      return;
    }

    setFormError(null);
    let payload: MoodboardCardPayload = {};

    if (newType === "IMAGE_REF") {
      payload = {
        imageUrl: imgUrl.trim() || undefined,
        tags: imgTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        caption: imgCaption.trim() || undefined,
      };
    } else if (newType === "COLOR_SWATCH") {
      const hexList = swatchHexes
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean);
      payload = {
        paletteName: newTitle,
        description: paletteDesc.trim() || undefined,
        swatches: hexList.map((hex) => ({
          hex: hex.startsWith("#") ? hex : `#${hex}`,
          label: hex,
        })),
      };
    } else if (newType === "SHOT_LIST") {
      const lines = shotItemsRaw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      payload = {
        items: lines.map((line) => ({
          text: line,
          checked: false,
          category: "General",
        })),
      };
    } else if (newType === "TECH_NOTE") {
      payload = {
        venueDirectives: techVenue.trim() || undefined,
        equipmentNotes: techEquip.trim() || undefined,
        lightingDirective: techLight.trim() || undefined,
        timelineNotes: techTimeline.trim() || undefined,
      };
    }

    const res = await addMoodboardCard(projectId, newType, newTitle, payload);
    if (!res.success || !res.card) {
      setFormError(res.error || "Failed to create card.");
      return;
    }

    setCards((prev) => [...prev, res.card as MoodboardCard]);
    setIsCreating(false);
    setNewTitle("");
    setImgUrl("");
    setImgTags("");
    setImgCaption("");
    setPaletteDesc("");
    setShotItemsRaw("");
    setTechVenue("");
    setTechEquip("");
    setTechLight("");
    setTechTimeline("");
  }

  // ── Comment Added Callback ────────────────────────────────────────────────
  function handleCommentAdded(cardId: string, newComment: MoodboardComment) {
    setCards((prev) =>
      prev.map((c) => {
        if (c.id !== cardId) return c;
        const nextComments = [...(c.comments || []), newComment];
        return {
          ...c,
          comments: nextComments,
          comment_count: nextComments.length,
        };
      })
    );
  }

  return (
    <section className="bg-white border border-border rounded-sm overflow-hidden shadow-xs">
      {/* ── Section Header ──────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-border flex flex-wrap items-center justify-between gap-4 bg-[#fafafa]">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground bg-[#ececee] px-2 py-0.5 rounded-xs font-semibold">
              Creative Direction
            </span>
            <span className="text-xs text-muted-foreground">
              {cards.length} visual {cards.length === 1 ? "card" : "cards"}
            </span>
          </div>
          <h2 className="text-lg font-serif font-bold text-foreground mt-1">
            Visual Moodboard & Production Brief
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Client reference cards, tone swatches, shot sequences, and studio
            discussion threads.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {projectSlug && (
            <Link
              href={`/gallery/${projectSlug}/moodboard`}
              target="_blank"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-11 text-xs font-medium border border-border bg-white hover:bg-[#f4f4f5] text-foreground rounded-xs transition-colors shadow-xs"
            >
              <ExternalLink className="size-3.5 text-muted-foreground" />
              <span>Preview Client Board</span>
            </Link>
          )}

          {cards.length === 0 && (
            <button
              type="button"
              onClick={handleSeed}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-11 text-xs font-medium bg-[#ff5a00]/10 text-[#ff5a00] border border-[#ff5a00]/40 hover:bg-[#ff5a00]/15 rounded-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="size-3.5 text-[#ff5a00]" />
              <span>{isPending ? "Generating..." : "Load Studio Template"}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsCreating((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 min-h-11 text-xs font-medium bg-[#09090b] hover:bg-[#27272a] text-white rounded-xs transition-colors shadow-xs cursor-pointer"
          >
            <Plus className="size-3.5" />
            <span>{isCreating ? "Close Form" : "Add Brief Card"}</span>
          </button>
        </div>
      </div>

      {/* ── Inline Card Creator ─────────────────────────────────────────── */}
      {isCreating && (
        <form
          onSubmit={handleCreateCard}
          className="p-6 border-b border-border bg-[#09090b] text-[#d4d4d8]"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <Sparkles className="size-4 text-[#ff5a00]" />
              <span>Create Visual Brief Card</span>
            </h3>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center text-[#a1a1aa] hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>

          {formError && (
            <div className="mb-4 p-2.5 bg-[#ff5a00]/15 border border-[#ff5a00]/40 text-xs text-[#ff5a00] rounded-xs">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[11px] font-mono uppercase text-[#a1a1aa] mb-1">
                Card Type
              </label>
              <select
                value={newType}
                onChange={(e) =>
                  setNewType(e.target.value as MoodboardCardType)
                }
                className="w-full text-xs bg-[#18181b] border border-[#3f3f46] rounded-xs px-3 py-2 min-h-11 text-white focus:outline-none focus:border-[#71717a]"
              >
                <option value="IMAGE_REF">IMAGE_REF — Visual Reference</option>
                <option value="COLOR_SWATCH">
                  COLOR_SWATCH — Color Palette
                </option>
                <option value="SHOT_LIST">
                  SHOT_LIST — Checklist & Sequences
                </option>
                <option value="TECH_NOTE">
                  TECH_NOTE — Technical Directive
                </option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-mono uppercase text-[#a1a1aa] mb-1">
                Card Title
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Cinematic Direct Sun & Contrast"
                className="w-full text-xs bg-[#18181b] border border-[#3f3f46] rounded-xs px-3 py-2 min-h-11 text-white placeholder:text-[#71717a] focus:outline-none focus:border-[#71717a]"
              />
            </div>
          </div>

          {/* Type-specific inputs */}
          {newType === "IMAGE_REF" && (
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-[11px] font-mono uppercase text-[#a1a1aa] mb-1">
                  Image URL
                </label>
                <input
                  type="text"
                  value={imgUrl}
                  onChange={(e) => setImgUrl(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full text-xs bg-[#18181b] border border-[#3f3f46] rounded-xs px-3 py-2 min-h-11 text-white placeholder:text-[#71717a] focus:outline-none focus:border-[#71717a]"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-mono uppercase text-[#a1a1aa] mb-1">
                    Tags (comma separated)
                  </label>
                  <input
                    type="text"
                    value={imgTags}
                    onChange={(e) => setImgTags(e.target.value)}
                    placeholder="35mm Grain, Silhouette, Golden Hour"
                    className="w-full text-xs bg-[#18181b] border border-[#3f3f46] rounded-xs px-3 py-2 min-h-11 text-white placeholder:text-[#71717a] focus:outline-none focus:border-[#71717a]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase text-[#a1a1aa] mb-1">
                    Caption / Mood Note
                  </label>
                  <input
                    type="text"
                    value={imgCaption}
                    onChange={(e) => setImgCaption(e.target.value)}
                    placeholder="Observe contrast and organic posture"
                    className="w-full text-xs bg-[#18181b] border border-[#3f3f46] rounded-xs px-3 py-2 min-h-11 text-white placeholder:text-[#71717a] focus:outline-none focus:border-[#71717a]"
                  />
                </div>
              </div>
            </div>
          )}

          {newType === "COLOR_SWATCH" && (
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-[11px] font-mono uppercase text-[#a1a1aa] mb-1">
                  Hex Colors (comma separated)
                </label>
                <input
                  type="text"
                  value={swatchHexes}
                  onChange={(e) => setSwatchHexes(e.target.value)}
                  placeholder="#0A0A0A, #4A1FB8, #F4EFEA, #7E7365"
                  className="w-full text-xs bg-[#18181b] border border-[#3f3f46] rounded-xs px-3 py-2 min-h-11 text-white placeholder:text-[#71717a] focus:outline-none focus:border-[#71717a] font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase text-[#a1a1aa] mb-1">
                  Palette Description
                </label>
                <input
                  type="text"
                  value={paletteDesc}
                  onChange={(e) => setPaletteDesc(e.target.value)}
                  placeholder="Balanced tone distribution for set and grading"
                  className="w-full text-xs bg-[#18181b] border border-[#3f3f46] rounded-xs px-3 py-2 min-h-11 text-white placeholder:text-[#71717a] focus:outline-none focus:border-[#71717a]"
                />
              </div>
            </div>
          )}

          {newType === "SHOT_LIST" && (
            <div className="mb-4">
              <label className="block text-[11px] font-mono uppercase text-[#a1a1aa] mb-1">
                Shot Items (one per line)
              </label>
              <textarea
                rows={4}
                value={shotItemsRaw}
                onChange={(e) => setShotItemsRaw(e.target.value)}
                placeholder="Wide atmospheric establishing shot&#10;Tight portrait 85mm catchlight&#10;Motion-blur transition"
                className="w-full text-xs bg-[#18181b] border border-[#3f3f46] rounded-xs p-3 text-white placeholder:text-[#71717a] focus:outline-none focus:border-[#71717a]"
              />
            </div>
          )}

          {newType === "TECH_NOTE" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[11px] font-mono uppercase text-[#a1a1aa] mb-1">
                  Venue Directives
                </label>
                <input
                  type="text"
                  value={techVenue}
                  onChange={(e) => setTechVenue(e.target.value)}
                  placeholder="Studio A - daylight stage with blackout drapes"
                  className="w-full text-xs bg-[#18181b] border border-[#3f3f46] rounded-xs px-3 py-2 min-h-11 text-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase text-[#a1a1aa] mb-1">
                  Equipment Notes
                </label>
                <input
                  type="text"
                  value={techEquip}
                  onChange={(e) => setTechEquip(e.target.value)}
                  placeholder="Hasselblad X2D 100C + Aputure 600d"
                  className="w-full text-xs bg-[#18181b] border border-[#3f3f46] rounded-xs px-3 py-2 min-h-11 text-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase text-[#a1a1aa] mb-1">
                  Lighting Specs
                </label>
                <input
                  type="text"
                  value={techLight}
                  onChange={(e) => setTechLight(e.target.value)}
                  placeholder="5600K key + 1/4 CTO rim light"
                  className="w-full text-xs bg-[#18181b] border border-[#3f3f46] rounded-xs px-3 py-2 min-h-11 text-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase text-[#a1a1aa] mb-1">
                  Timeline / Call Times
                </label>
                <input
                  type="text"
                  value={techTimeline}
                  onChange={(e) => setTechTimeline(e.target.value)}
                  placeholder="Call 08:30 WIB | Wrap 17:00 WIB"
                  className="w-full text-xs bg-[#18181b] border border-[#3f3f46] rounded-xs px-3 py-2 min-h-11 text-white focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-3 py-1.5 min-h-11 text-xs text-[#a1a1aa] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 min-h-11 bg-white text-[#09090b] font-medium text-xs rounded-xs hover:bg-[#ececee] transition-colors cursor-pointer"
            >
              Save Card
            </button>
          </div>
        </form>
      )}

      {/* ── Cards Grid ──────────────────────────────────────────────────── */}
      <div className="p-6 bg-[#fafafa]">
        {isLoading ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            Loading visual brief...
          </div>
        ) : cards.length === 0 ? (
          <div className="border border-dashed border-[#ececee] rounded-sm p-10 text-center">
            <div className="w-10 h-10 rounded-full bg-[#f4f4f5] flex items-center justify-center text-muted-foreground mx-auto mb-3">
              <Sparkles className="size-5 text-[#ff5a00]" />
            </div>
            <h4 className="text-sm font-medium text-foreground">
              No Creative Cards Added
            </h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto mb-4">
              Add visual reference cards, color swatches, shot wishlists, and
              production directives for client collaboration.
            </p>
            <button
              type="button"
              onClick={handleSeed}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 min-h-11 text-xs font-medium bg-[#09090b] text-white rounded-xs hover:bg-[#27272a] transition-colors shadow-xs cursor-pointer"
            >
              <Sparkles className="size-3.5 text-[#ff5a00]" />
              <span>Load Studio Brief Template</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-start">
            {cards.map((card) => (
              <div
                key={card.id}
                className="bg-white border border-border rounded-sm shadow-xs overflow-hidden flex flex-col hover:border-[#d4d4d8] transition-colors"
              >
                {/* Header */}
                <div className="px-4 py-2.5 border-b border-border flex items-center justify-between bg-[#fafafa]">
                  <span
                    className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-xs border font-semibold ${
                      card.card_type === "IMAGE_REF"
                        ? "bg-[#09090b] text-white border-[#09090b]"
                        : card.card_type === "COLOR_SWATCH"
                          ? "bg-[#f4f4f5] text-[#3f3f46] border-[#d4d4d8]"
                          : card.card_type === "SHOT_LIST"
                            ? "bg-[#ff5a00]/10 text-[#ff5a00] border-[#ff5a00]/40"
                            : "bg-[#fafafa] text-[#3f3f46] border-[#ececee]"
                    }`}
                  >
                    {card.card_type.replace("_", " ")}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedCardId(card.id)}
                      className="p-1.5 min-h-11 min-w-11 text-[#52525b] hover:text-[#09090b] rounded-xs hover:bg-[#ececee] transition-colors cursor-pointer flex items-center justify-center gap-1 text-xs"
                      title="Open discussion thread"
                    >
                      <MessageSquare className="size-3.5" />
                      <span className="font-mono text-[11px]">
                        {card.comment_count ?? card.comments?.length ?? 0}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCard(card.id)}
                      className="p-1.5 min-h-11 min-w-11 text-[#a1a1aa] hover:text-[#ff5a00] rounded-xs hover:bg-[#ff5a00]/10 transition-colors cursor-pointer flex items-center justify-center"
                      title="Delete card"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>

                {/* Title */}
                <div className="px-4 pt-3 pb-1">
                  <h4 className="text-xs font-semibold text-foreground">
                    {card.title}
                  </h4>
                </div>

                {/* Content */}
                <div className="px-4 py-2 flex-1">
                  {/* IMAGE_REF */}
                  {card.card_type === "IMAGE_REF" && (
                    <div className="space-y-2">
                      {card.payload.imageUrl && (
                        <div className="rounded-xs overflow-hidden bg-[#f4f4f5] border border-border">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={card.payload.imageUrl}
                            alt={card.title}
                            className="w-full h-40 object-cover"
                          />
                        </div>
                      )}
                      {card.payload.caption && (
                        <p className="text-[11px] text-muted-foreground italic">
                          &ldquo;{card.payload.caption}&rdquo;
                        </p>
                      )}
                      {card.payload.tags && (
                        <div className="flex flex-wrap gap-1">
                          {card.payload.tags.map((t, idx) => (
                            <span
                              key={idx}
                              className="text-[9px] bg-[#f4f4f5] text-[#52525b] px-1.5 py-0.2 rounded-xs font-mono"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* COLOR_SWATCH */}
                  {card.card_type === "COLOR_SWATCH" && (
                    <div className="space-y-2">
                      {card.payload.description && (
                        <p className="text-[11px] text-muted-foreground">
                          {card.payload.description}
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {card.payload.swatches?.map((s, idx) => (
                          <div
                            key={idx}
                            onClick={() => handleCopyHex(s.hex)}
                            className="p-1.5 border border-border rounded-xs hover:border-[#d4d4d8] cursor-pointer bg-[#fafafa] transition-colors"
                          >
                            <div
                              className="w-full h-8 rounded-xs border border-black/10 mb-1"
                              style={{ backgroundColor: s.hex }}
                            />
                            <div className="flex items-center justify-between text-[10px] font-mono">
                              <span className="font-semibold">{s.hex}</span>
                              {copiedHex === s.hex && (
                                <span className="text-[#09090b]">Copied</span>
                              )}
                            </div>
                            {s.label && (
                              <p className="text-[10px] text-muted-foreground truncate">
                                {s.label}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SHOT_LIST */}
                  {card.card_type === "SHOT_LIST" && (
                    <ul className="space-y-1.5 text-xs">
                      {card.payload.items?.map((item, idx) => (
                        <li
                          key={idx}
                          onClick={() => handleToggleShot(card.id, idx)}
                          className="flex items-start gap-2 p-1.5 min-h-11 rounded-xs hover:bg-[#f4f4f5] cursor-pointer transition-colors"
                        >
                          <button
                            type="button"
                            className="mt-0.5 shrink-0 min-h-11 min-w-11 flex items-center"
                            aria-label={
                              item.checked ? "Uncheck item" : "Check item"
                            }
                          >
                            {item.checked ? (
                              <CheckCircle2 className="size-4 text-[#09090b]" />
                            ) : (
                              <Circle className="size-4 text-[#a1a1aa]" />
                            )}
                          </button>
                          <span
                            className={`text-[11px] leading-tight ${
                              item.checked
                                ? "line-through text-muted-foreground"
                                : "text-foreground"
                            }`}
                          >
                            {item.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* TECH_NOTE */}
                  {card.card_type === "TECH_NOTE" && (
                    <div className="space-y-2 text-[11px] text-muted-foreground divide-y divide-border/60">
                      {card.payload.venueDirectives && (
                        <div className="pt-1.5 first:pt-0">
                          <span className="font-semibold text-foreground block">
                            Venue:
                          </span>
                          {card.payload.venueDirectives}
                        </div>
                      )}
                      {card.payload.equipmentNotes && (
                        <div className="pt-1.5">
                          <span className="font-semibold text-foreground block">
                            Equipment:
                          </span>
                          {card.payload.equipmentNotes}
                        </div>
                      )}
                      {card.payload.lightingDirective && (
                        <div className="pt-1.5">
                          <span className="font-semibold text-foreground block">
                            Lighting:
                          </span>
                          {card.payload.lightingDirective}
                        </div>
                      )}
                      {card.payload.timelineNotes && (
                        <div className="pt-1.5">
                          <span className="font-semibold text-foreground block">
                            Timeline:
                          </span>
                          <span className="font-mono">
                            {card.payload.timelineNotes}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer Thread Trigger */}
                <div className="px-4 py-2.5 border-t border-border bg-[#fafafa] flex items-center justify-between text-[11px]">
                  <button
                    type="button"
                    onClick={() => setSelectedCardId(card.id)}
                    className="text-[#52525b] hover:text-[#09090b] font-medium flex items-center gap-1 min-h-11 cursor-pointer"
                  >
                    <MessageSquare className="size-3" />
                    <span>Thread ({card.comments?.length || 0})</span>
                  </button>

                  <span className="text-muted-foreground text-[10px] font-mono">
                    {card.comments && card.comments.length > 0
                      ? `${card.comments[card.comments.length - 1].author_role}`
                      : "No notes"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Threaded Comment Drawer for Studio Director ─────────────────── */}
      <CardCommentDrawer
        card={activeCard}
        isOpen={Boolean(activeCard)}
        onClose={() => setSelectedCardId(null)}
        onCommentAdded={handleCommentAdded}
        defaultAuthorRole="STUDIO"
        defaultAuthorName={directorName}
      />
    </section>
  );
}
