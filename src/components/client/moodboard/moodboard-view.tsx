"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import {
  Images,
  Palette,
  CheckSquare,
  FileCode2,
  MessageSquare,
  Copy,
  Check,
  ArrowLeft,
  Maximize2,
  X,
  Sparkles,
  SlidersHorizontal,
  Search,
  CheckCircle2,
  Circle,
  Camera,
  MapPin,
  Clock,
  Zap,
} from "lucide-react";
import type {
  MoodboardCard,
  MoodboardCardType,
  MoodboardComment,
  AuthorRole,
} from "@/types/moodboard";
import {
  toggleShotListItem,
  seedDefaultMoodboard,
} from "@/app/actions/moodboard";
import { CardCommentDrawer } from "./card-comment-drawer";

interface MoodboardViewProps {
  initialCards: MoodboardCard[];
  projectId: string;
  projectSlug: string;
  projectName: string;
  shootDate?: string | null;
  photographyType?: string | null;
  userRole?: AuthorRole;
  userName?: string;
}

export function MoodboardView({
  initialCards,
  projectId,
  projectSlug,
  projectName,
  shootDate,
  photographyType,
  userRole = "CLIENT",
  userName = "Client",
}: MoodboardViewProps) {
  const [cards, setCards] = useState<MoodboardCard[]>(initialCards);
  const [activeFilter, setActiveFilter] = useState<"ALL" | MoodboardCardType>(
    "ALL"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{
    url: string;
    title: string;
    caption?: string;
  } | null>(null);

  const [isPending, startTransition] = useTransition();
  const [seedError, setSeedError] = useState<string | null>(null);

  // Active card for comment drawer
  const activeCard = cards.find((c) => c.id === selectedCardId) ?? null;

  // Filtered cards
  const filteredCards = cards.filter((card) => {
    if (activeFilter !== "ALL" && card.card_type !== activeFilter) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const titleMatch = card.title.toLowerCase().includes(q);
    const tagsMatch =
      card.payload.tags?.some((t) => t.toLowerCase().includes(q)) ?? false;
    const itemsMatch =
      card.payload.items?.some((i) => i.text.toLowerCase().includes(q)) ??
      false;
    return titleMatch || tagsMatch || itemsMatch;
  });

  // ── Optimistic Shot List Toggle ──────────────────────────────────────────
  async function handleToggleShotItem(cardId: string, itemIndex: number) {
    const targetCard = cards.find((c) => c.id === cardId);
    if (!targetCard || !targetCard.payload.items) return;

    const currentItem = targetCard.payload.items[itemIndex];
    if (!currentItem) return;

    const newChecked = !currentItem.checked;

    // 1. Optimistic local update
    setCards((prevCards) =>
      prevCards.map((c) => {
        if (c.id !== cardId || !c.payload.items) return c;
        const newItems = [...c.payload.items];
        newItems[itemIndex] = {
          ...newItems[itemIndex],
          checked: newChecked,
        };
        return {
          ...c,
          payload: {
            ...c.payload,
            items: newItems,
          },
        };
      })
    );

    // 2. Server mutation
    const res = await toggleShotListItem(cardId, itemIndex, newChecked);
    if (!res.success) {
      // Rollback on failure
      setCards((prevCards) =>
        prevCards.map((c) => {
          if (c.id !== cardId || !c.payload.items) return c;
          const revertedItems = [...c.payload.items];
          revertedItems[itemIndex] = {
            ...revertedItems[itemIndex],
            checked: !newChecked,
          };
          return {
            ...c,
            payload: {
              ...c.payload,
              items: revertedItems,
            },
          };
        })
      );
    }
  }

  // ── Comment Added Callback ────────────────────────────────────────────────
  function handleCommentAdded(cardId: string, newComment: MoodboardComment) {
    setCards((prevCards) =>
      prevCards.map((c) => {
        if (c.id !== cardId) return c;
        const updatedComments = [...(c.comments || []), newComment];
        return {
          ...c,
          comments: updatedComments,
          comment_count: updatedComments.length,
        };
      })
    );
  }

  // ── Copy Hex Value with Feedback ──────────────────────────────────────────
  async function handleCopyHex(hex: string) {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedHex(hex);
      setTimeout(() => {
        setCopiedHex((curr) => (curr === hex ? null : curr));
      }, 2000);
    } catch {
      // Clipboard fallback
      setCopiedHex(hex);
      setTimeout(() => setCopiedHex(null), 2000);
    }
  }

  // ── Seed Sample Visual Brief ──────────────────────────────────────────────
  function handleSeedMoodboard() {
    setSeedError(null);
    startTransition(async () => {
      const res = await seedDefaultMoodboard(projectId);
      if (!res.success) {
        setSeedError(res.error || "Failed to seed moodboard cards.");
      } else {
        window.location.reload();
      }
    });
  }

  // Count by type
  const counts = {
    ALL: cards.length,
    IMAGE_REF: cards.filter((c) => c.card_type === "IMAGE_REF").length,
    COLOR_SWATCH: cards.filter((c) => c.card_type === "COLOR_SWATCH").length,
    SHOT_LIST: cards.filter((c) => c.card_type === "SHOT_LIST").length,
    TECH_NOTE: cards.filter((c) => c.card_type === "TECH_NOTE").length,
  };

  return (
    <div className="min-h-screen bg-[#0E0E10] text-zinc-100 flex flex-col font-sans">
      {/* ── Top Bar / Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-[#0E0E10]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href={`/gallery/${projectSlug}`}
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 transition-colors group"
            >
              <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
              <span>Back to Gallery</span>
            </Link>
            <div className="h-4 w-px bg-zinc-800" />
            <Link href="/" className="wordmark text-lg text-white">
              Elts.
            </Link>
          </div>

          {/* Navigation Pill Tabs: Gallery vs Moodboard */}
          <nav
            aria-label="Project views"
            className="flex items-center p-1 bg-zinc-900 border border-zinc-800 rounded-sm"
          >
            <Link
              href={`/gallery/${projectSlug}`}
              className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1.5"
            >
              <Images className="size-3.5" />
              <span>Photos & Media</span>
            </Link>
            <span
              aria-current="page"
              className="px-3 py-1.5 text-xs font-medium bg-zinc-800 text-white rounded-xs border border-zinc-700/60 shadow-xs flex items-center gap-1.5"
            >
              <Sparkles className="size-3.5 text-amber-300" />
              <span>Visual Moodboard</span>
            </span>
          </nav>
        </div>
      </header>

      {/* ── Hero / Project Summary ───────────────────────────────────────── */}
      <section className="border-b border-zinc-800/80 bg-gradient-to-b from-[#141417] to-[#0E0E10] px-4 sm:px-6 py-10">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-mono tracking-widest text-zinc-400 uppercase">
                  Collaborative Visual Brief
                </span>
                {photographyType && (
                  <>
                    <span className="text-zinc-600">•</span>
                    <span className="text-[11px] font-mono tracking-wider text-amber-300/80 uppercase">
                      {photographyType}
                    </span>
                  </>
                )}
              </div>
              <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-normal tracking-tight text-white">
                {projectName}
              </h1>
              {shootDate && (
                <p className="mt-2 text-xs text-zinc-400 flex items-center gap-1.5">
                  <Clock className="size-3.5" />
                  Scheduled Shoot: {shootDate}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              {cards.length === 0 && (
                <button
                  type="button"
                  onClick={handleSeedMoodboard}
                  disabled={isPending}
                  className="px-4 py-2 bg-white text-zinc-950 hover:bg-zinc-200 text-xs font-medium rounded-xs transition-colors flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <Sparkles className="size-3.5 text-amber-600" />
                  <span>
                    {isPending ? "Generating..." : "Load Creative Template"}
                  </span>
                </button>
              )}
            </div>
          </div>

          {seedError && (
            <div className="mt-4 p-3 bg-red-950/50 border border-red-800 text-red-200 text-xs rounded-xs">
              {seedError}
            </div>
          )}
        </div>
      </section>

      {/* ── Filter & Search Toolbar ──────────────────────────────────────── */}
      <section className="border-b border-zinc-800/80 bg-[#121215] px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 scrollbar-none">
            <button
              type="button"
              onClick={() => setActiveFilter("ALL")}
              className={`px-3 py-1.5 rounded-xs text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeFilter === "ALL"
                  ? "bg-zinc-200 text-zinc-950 font-semibold"
                  : "bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
              }`}
            >
              <span>All Items</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  activeFilter === "ALL" ? "bg-zinc-300" : "bg-zinc-800"
                }`}
              >
                {counts.ALL}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter("IMAGE_REF")}
              className={`px-3 py-1.5 rounded-xs text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeFilter === "IMAGE_REF"
                  ? "bg-sky-400 text-zinc-950 font-semibold"
                  : "bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
              }`}
            >
              <Images className="size-3" />
              <span>Visuals</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  activeFilter === "IMAGE_REF" ? "bg-sky-500/30" : "bg-zinc-800"
                }`}
              >
                {counts.IMAGE_REF}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter("COLOR_SWATCH")}
              className={`px-3 py-1.5 rounded-xs text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeFilter === "COLOR_SWATCH"
                  ? "bg-emerald-400 text-zinc-950 font-semibold"
                  : "bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
              }`}
            >
              <Palette className="size-3" />
              <span>Color Palettes</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  activeFilter === "COLOR_SWATCH"
                    ? "bg-emerald-500/30"
                    : "bg-zinc-800"
                }`}
              >
                {counts.COLOR_SWATCH}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter("SHOT_LIST")}
              className={`px-3 py-1.5 rounded-xs text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeFilter === "SHOT_LIST"
                  ? "bg-amber-400 text-zinc-950 font-semibold"
                  : "bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
              }`}
            >
              <CheckSquare className="size-3" />
              <span>Shot Lists</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  activeFilter === "SHOT_LIST"
                    ? "bg-amber-500/30"
                    : "bg-zinc-800"
                }`}
              >
                {counts.SHOT_LIST}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveFilter("TECH_NOTE")}
              className={`px-3 py-1.5 rounded-xs text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeFilter === "TECH_NOTE"
                  ? "bg-purple-400 text-zinc-950 font-semibold"
                  : "bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
              }`}
            >
              <FileCode2 className="size-3" />
              <span>Tech Directives</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  activeFilter === "TECH_NOTE"
                    ? "bg-purple-500/30"
                    : "bg-zinc-800"
                }`}
              >
                {counts.TECH_NOTE}
              </span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search visual brief..."
              className="w-full text-xs bg-zinc-900/80 border border-zinc-800 rounded-xs pl-8 pr-3 py-1.5 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
            />
          </div>
        </div>
      </section>

      {/* ── Visual Cards Grid ────────────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        {filteredCards.length === 0 ? (
          <div className="border border-dashed border-zinc-800 rounded-sm p-12 text-center max-w-lg mx-auto my-12">
            <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 mx-auto mb-4">
              <SlidersHorizontal className="size-5" />
            </div>
            <h2 className="text-lg font-serif text-white mb-2">
              No Visual Cards Found
            </h2>
            <p className="text-xs text-zinc-400 leading-relaxed mb-6">
              {searchQuery
                ? `No cards matched the search query "${searchQuery}".`
                : "This moodboard does not contain cards for the selected view."}
            </p>
            {cards.length === 0 && (
              <button
                type="button"
                onClick={handleSeedMoodboard}
                disabled={isPending}
                className="px-4 py-2 bg-white text-zinc-950 hover:bg-zinc-200 text-xs font-medium rounded-xs transition-colors inline-flex items-center gap-2 cursor-pointer"
              >
                <Sparkles className="size-3.5 text-amber-600" />
                <span>Load Studio Sample Brief</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-max items-start">
            {filteredCards.map((card) => (
              <article
                key={card.id}
                className="bg-[#141416] border border-zinc-800/80 rounded-sm overflow-hidden flex flex-col hover:border-zinc-700/80 transition-all shadow-md group"
              >
                {/* ── Card Header ────────────────────────────────────── */}
                <div className="px-5 py-3.5 border-b border-zinc-800/60 flex items-center justify-between bg-[#18181B]/50">
                  <span
                    className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-xs border font-medium ${
                      card.card_type === "IMAGE_REF"
                        ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
                        : card.card_type === "COLOR_SWATCH"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : card.card_type === "SHOT_LIST"
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            : "bg-purple-500/10 text-purple-400 border-purple-500/20"
                    }`}
                  >
                    {card.card_type.replace("_", " ")}
                  </span>

                  {/* Comment Trigger Button */}
                  <button
                    type="button"
                    onClick={() => setSelectedCardId(card.id)}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white px-2 py-1 rounded-xs hover:bg-zinc-800 transition-colors cursor-pointer"
                    title="Open comments discussion"
                  >
                    <MessageSquare className="size-3.5" />
                    <span className="font-mono text-[11px]">
                      {card.comment_count ?? card.comments?.length ?? 0}
                    </span>
                  </button>
                </div>

                {/* ── Card Title ─────────────────────────────────────── */}
                <div className="px-5 pt-4 pb-2">
                  <h2 className="text-sm font-medium text-white group-hover:text-zinc-100 transition-colors">
                    {card.title}
                  </h2>
                </div>

                {/* ── Specific Card Content ──────────────────────────── */}
                <div className="px-5 py-3 flex-1 flex flex-col justify-between">
                  {/* TYPE 1: IMAGE_REF */}
                  {card.card_type === "IMAGE_REF" && (
                    <div className="space-y-3">
                      {card.payload.imageUrl && (
                        <div className="relative group/img overflow-hidden rounded-xs bg-zinc-900 border border-zinc-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={card.payload.imageUrl}
                            alt={card.title}
                            className="w-full h-56 object-cover object-center transition-transform duration-500 group-hover/img:scale-105"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewImage({
                                url: card.payload.imageUrl || "",
                                title: card.title,
                                caption: card.payload.caption,
                              })
                            }
                            className="absolute bottom-2 right-2 p-1.5 bg-black/70 hover:bg-black text-white rounded-xs backdrop-blur-xs transition-colors cursor-pointer"
                            title="Expand preview"
                          >
                            <Maximize2 className="size-3.5" />
                          </button>
                        </div>
                      )}

                      {card.payload.caption && (
                        <p className="text-xs text-zinc-300 leading-relaxed italic">
                          {`\u201C${card.payload.caption}\u201D`}
                        </p>
                      )}

                      {card.payload.tags && card.payload.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {card.payload.tags.map((tag, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-800 px-2 py-0.5 rounded-xs font-mono"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TYPE 2: COLOR_SWATCH */}
                  {card.card_type === "COLOR_SWATCH" && (
                    <div className="space-y-3.5">
                      {card.payload.description && (
                        <p className="text-xs text-zinc-300 leading-relaxed">
                          {card.payload.description}
                        </p>
                      )}

                      <div className="grid grid-cols-2 gap-2.5 pt-1">
                        {card.payload.swatches?.map((swatch, idx) => {
                          const isCopied = copiedHex === swatch.hex;
                          return (
                            <div
                              key={idx}
                              onClick={() => handleCopyHex(swatch.hex)}
                              className="p-2 bg-zinc-900/90 border border-zinc-800/80 rounded-xs hover:border-zinc-700 transition-colors cursor-pointer group/swatch"
                            >
                              <div
                                className="w-full h-12 rounded-xs border border-white/10 shadow-inner relative"
                                style={{ backgroundColor: swatch.hex }}
                              >
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/swatch:opacity-100 transition-opacity bg-black/30 backdrop-blur-xs">
                                  {isCopied ? (
                                    <span className="text-[10px] text-emerald-300 font-mono flex items-center gap-1 font-bold">
                                      <Check className="size-3" /> Copied
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-white font-mono flex items-center gap-1">
                                      <Copy className="size-3" /> Copy
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="mt-2 flex items-center justify-between">
                                <span className="font-mono text-[11px] font-semibold text-zinc-200">
                                  {swatch.hex}
                                </span>
                                {isCopied && (
                                  <span className="text-[9px] text-emerald-400 font-mono">
                                    Copied!
                                  </span>
                                )}
                              </div>
                              {swatch.label && (
                                <p className="text-[11px] text-zinc-400 font-medium truncate">
                                  {swatch.label}
                                </p>
                              )}
                              {swatch.note && (
                                <p className="text-[10px] text-zinc-500 leading-tight mt-0.5 line-clamp-2">
                                  {swatch.note}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* TYPE 3: SHOT_LIST */}
                  {card.card_type === "SHOT_LIST" && (
                    <div className="space-y-3">
                      {/* Progress bar */}
                      {card.payload.items && card.payload.items.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5 font-mono">
                            <span>Confirmed Wishlist</span>
                            <span>
                              {
                                card.payload.items.filter((i) => i.checked)
                                  .length
                              }{" "}
                              / {card.payload.items.length}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-400 transition-all duration-300"
                              style={{
                                width: `${Math.round(
                                  (card.payload.items.filter((i) => i.checked)
                                    .length /
                                    card.payload.items.length) *
                                    100
                                )}%`,
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Items */}
                      <ul className="space-y-2 pt-1">
                        {card.payload.items?.map((item, idx) => (
                          <li
                            key={idx}
                            onClick={() => handleToggleShotItem(card.id, idx)}
                            className="flex items-start gap-2.5 p-2 rounded-xs hover:bg-zinc-900/90 transition-colors cursor-pointer border border-transparent hover:border-zinc-800/80"
                          >
                            <button
                              type="button"
                              className="mt-0.5 shrink-0 text-zinc-400 hover:text-amber-400 transition-colors"
                              aria-label={
                                item.checked ? "Uncheck item" : "Check item"
                              }
                            >
                              {item.checked ? (
                                <CheckCircle2 className="size-4 text-amber-400" />
                              ) : (
                                <Circle className="size-4 text-zinc-600 hover:text-zinc-400" />
                              )}
                            </button>
                            <div className="flex-1">
                              <p
                                className={`text-xs leading-relaxed transition-all ${
                                  item.checked
                                    ? "line-through text-zinc-500"
                                    : "text-zinc-200"
                                }`}
                              >
                                {item.text}
                              </p>
                              {item.category && (
                                <span className="inline-block mt-1 text-[9px] font-mono uppercase tracking-wider text-zinc-500 bg-zinc-900 px-1.5 py-0.2 rounded-xs border border-zinc-800">
                                  {item.category}
                                </span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* TYPE 4: TECH_NOTE */}
                  {card.card_type === "TECH_NOTE" && (
                    <div className="space-y-3.5 text-xs text-zinc-300 leading-relaxed divide-y divide-zinc-800/60">
                      {card.payload.venueDirectives && (
                        <div className="pt-2 first:pt-0">
                          <div className="flex items-center gap-1.5 text-[10px] font-mono text-purple-400 uppercase tracking-wider mb-1">
                            <MapPin className="size-3" />
                            <span>Venue Directives</span>
                          </div>
                          <p className="text-zinc-300">
                            {card.payload.venueDirectives}
                          </p>
                        </div>
                      )}

                      {card.payload.equipmentNotes && (
                        <div className="pt-2">
                          <div className="flex items-center gap-1.5 text-[10px] font-mono text-purple-400 uppercase tracking-wider mb-1">
                            <Camera className="size-3" />
                            <span>Equipment Notes</span>
                          </div>
                          <p className="text-zinc-300">
                            {card.payload.equipmentNotes}
                          </p>
                        </div>
                      )}

                      {card.payload.lightingDirective && (
                        <div className="pt-2">
                          <div className="flex items-center gap-1.5 text-[10px] font-mono text-purple-400 uppercase tracking-wider mb-1">
                            <Zap className="size-3" />
                            <span>Lighting Specification</span>
                          </div>
                          <p className="text-zinc-300">
                            {card.payload.lightingDirective}
                          </p>
                        </div>
                      )}

                      {card.payload.timelineNotes && (
                        <div className="pt-2">
                          <div className="flex items-center gap-1.5 text-[10px] font-mono text-purple-400 uppercase tracking-wider mb-1">
                            <Clock className="size-3" />
                            <span>Timeline & Calls</span>
                          </div>
                          <p className="text-zinc-300 font-mono text-[11px]">
                            {card.payload.timelineNotes}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Card Footer ────────────────────────────────────── */}
                <div className="px-5 py-3 border-t border-zinc-800/60 bg-[#121214] flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => setSelectedCardId(card.id)}
                    className="text-zinc-400 hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer font-medium"
                  >
                    <MessageSquare className="size-3" />
                    <span>Discuss ({card.comments?.length || 0})</span>
                  </button>

                  {card.comments && card.comments.length > 0 && (
                    <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[150px]">
                      Latest: {card.comments[card.comments.length - 1].author_name}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {/* ── Image Lightbox Modal ─────────────────────────────────────────── */}
      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center">
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute -top-10 right-0 text-zinc-400 hover:text-white p-1"
            >
              <X className="size-6" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImage.url}
              alt={previewImage.title}
              className="max-h-[75vh] w-auto object-contain rounded-xs border border-zinc-800"
            />
            <div className="mt-3 text-center">
              <h3 className="text-sm font-medium text-white">
                {previewImage.title}
              </h3>
              {previewImage.caption && (
                <p className="text-xs text-zinc-400 mt-1 max-w-lg">
                  {previewImage.caption}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Threaded Comment Drawer ──────────────────────────────────────── */}
      <CardCommentDrawer
        card={activeCard}
        isOpen={Boolean(activeCard)}
        onClose={() => setSelectedCardId(null)}
        onCommentAdded={handleCommentAdded}
        defaultAuthorRole={userRole}
        defaultAuthorName={userName}
      />
    </div>
  );
}
