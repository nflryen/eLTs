"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { X, Send, MessageSquare, ShieldCheck, User } from "lucide-react";
import type {
  MoodboardCard,
  MoodboardComment,
  AuthorRole,
} from "@/types/moodboard";
import { addMoodboardComment } from "@/app/actions/moodboard";

interface CardCommentDrawerProps {
  card: MoodboardCard | null;
  isOpen: boolean;
  onClose: () => void;
  onCommentAdded?: (cardId: string, comment: MoodboardComment) => void;
  defaultAuthorRole?: AuthorRole;
  defaultAuthorName?: string;
}

export function CardCommentDrawer({
  card,
  isOpen,
  onClose,
  onCommentAdded,
  defaultAuthorRole = "CLIENT",
  defaultAuthorName = "",
}: CardCommentDrawerProps) {
  /*
   * The thread shown is "the card's comments, plus anything added in this
   * session". Keeping the source of truth in props and appending locally means
   * there is nothing to synchronise on open, so no `setState` runs inside an
   * effect (which React 19 flags as a cascading render).
   */
  const [localComments, setLocalComments] = useState<MoodboardComment[]>([]);
  const [syncedCardId, setSyncedCardId] = useState<string | null>(null);

  /*
   * Reset the local additions when the drawer switches cards — derived during
   * render, the pattern React documents for "adjust state when a prop changes".
   * A WORKER-visible comment on card A must not appear on card B.
   */
  const currentCardId = card?.id ?? null;
  if (currentCardId !== syncedCardId) {
    setSyncedCardId(currentCardId);
    setLocalComments([]);
  }

  const comments = useMemo<MoodboardComment[]>(() => {
    const serverComments = card?.comments ?? [];
    if (localComments.length === 0) return serverComments;
    // Local entries win on id: an optimistic item is replaced, not duplicated.
    const localIds = new Set(localComments.map((c) => c.id));
    return [...serverComments.filter((c) => !localIds.has(c.id)), ...localComments];
  }, [card?.comments, localComments]);

  const [text, setText] = useState("");
  /*
   * The author field starts from the prop and is then user-owned. Initialising
   * `useState(defaultAuthorName)` already covers the first mount, so the old
   * "seed it if empty" effect only ever fired on a later prop change — and wrote
   * state during render's commit phase. Deriving the fallback at the point of
   * use is equivalent and has no effect.
   */
  const [authorNameDraft, setAuthorNameDraft] = useState<string | null>(null);
  const authorName = authorNameDraft ?? defaultAuthorName;
  const [authorRole, setAuthorRole] = useState<AuthorRole>(defaultAuthorRole);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom of thread when new comments arrive
  useEffect(() => {
    if (isOpen) {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [comments, isOpen]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !card) return null;

  async function handleSendComment(e: React.FormEvent) {
    e.preventDefault();
    if (!card) return;

    const trimmed = text.trim();
    if (!trimmed || isSubmitting) return;

    const finalName =
      authorName.trim() ||
      (authorRole === "STUDIO" ? "Studio Director" : "Client");

    // 1. Optimistic comment
    const tempId = `temp-${Date.now()}`;
    const optimisticComment: MoodboardComment = {
      id: tempId,
      card_id: card.id,
      author_role: authorRole,
      author_name: finalName,
      content: trimmed,
      created_at: new Date().toISOString(),
    };

    setLocalComments((prev) => [...prev, optimisticComment]);
    setText("");
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      /*
       * Author identity is derived server-side from the authenticated
       * principal. Passing authorRole/authorName here was the identity-spoofing
       * vector; the optimistic row below uses the same derived values only for
       * instant paint, and is replaced by the server's row on success.
       */
      const res = await addMoodboardComment(card.id, trimmed);

      if (!res.success || !res.comment) {
        throw new Error(res.error || "Failed to post comment");
      }

      // Replace optimistic comment with confirmed server comment
      const serverComment = res.comment;
      setLocalComments((prev) =>
        prev.map((c) => (c.id === tempId ? serverComment : c))
      );
      if (onCommentAdded) {
        onCommentAdded(card.id, serverComment);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Could not post comment.";
      setErrorMsg(message);
      // Rollback optimistic comment
      setLocalComments((prev) => prev.filter((c) => c.id !== tempId));
      setText(trimmed); // restore user's text
    } finally {
      setIsSubmitting(false);
      textareaRef.current?.focus();
    }
  }

  function formatTime(iso: string) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "just now";
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-title"
          className="w-screen max-w-md bg-[#18181B] text-zinc-100 shadow-2xl flex flex-col border-l border-zinc-800"
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-zinc-800/80 flex items-start justify-between bg-[#121214]">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-mono tracking-widest px-2 py-0.5 rounded-xs bg-zinc-800 text-zinc-300 border border-zinc-700/50">
                  {card.card_type.replace("_", " ")}
                </span>
                <span className="text-xs text-zinc-400 flex items-center gap-1">
                  <MessageSquare className="size-3" />
                  {comments.length} {comments.length === 1 ? "note" : "notes"}
                </span>
              </div>
              <h2
                id="drawer-title"
                className="mt-2 text-base font-medium text-white line-clamp-1"
              >
                {card.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-400 hover:text-white p-1 rounded-sm hover:bg-zinc-800 transition-colors"
              aria-label="Close comment panel"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Thread / Comment History */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {comments.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-12 text-zinc-400">
                <div className="w-10 h-10 rounded-full bg-zinc-800/80 flex items-center justify-center text-zinc-300 mb-3 border border-zinc-700/50">
                  <MessageSquare className="size-5" />
                </div>
                <p className="text-sm font-medium text-zinc-200">
                  No discussion notes yet
                </p>
                <p className="text-xs mt-1 text-zinc-400 max-w-xs leading-relaxed">
                  Start the conversation regarding visual direction, styling
                  refinements, or production requirements.
                </p>
              </div>
            ) : (
              comments.map((comment) => {
                const isStudio = comment.author_role === "STUDIO";
                return (
                  <div
                    key={comment.id}
                    className={`rounded-sm p-4 border transition-all ${
                      isStudio
                        ? "bg-zinc-900/90 border-zinc-700/80"
                        : "bg-zinc-900/40 border-zinc-800/80"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase rounded-xs ${
                            isStudio
                              ? "bg-amber-400/10 text-amber-300 border border-amber-400/20"
                              : "bg-zinc-800 text-zinc-300 border border-zinc-700/40"
                          }`}
                        >
                          {isStudio ? (
                            <>
                              <ShieldCheck className="size-2.5" />
                              Studio
                            </>
                          ) : (
                            <>
                              <User className="size-2.5" />
                              Client
                            </>
                          )}
                        </span>
                        <span className="text-xs font-medium text-zinc-200">
                          {comment.author_name}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-zinc-400">
                        {formatTime(comment.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                      {comment.content}
                    </p>
                  </div>
                );
              })
            )}
            <div ref={threadEndRef} />
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div className="mx-6 mb-2 px-3 py-2 bg-red-950/60 border border-red-800/80 rounded-sm text-xs text-red-300 flex items-center justify-between">
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="text-red-400 hover:text-red-200"
              >
                &times;
              </button>
            </div>
          )}

          {/* Comment Composer */}
          <form
            onSubmit={handleSendComment}
            className="p-5 border-t border-zinc-800 bg-[#121214]"
          >
            <div className="flex items-center gap-2 mb-2.5">
              <input
                type="text"
                value={authorName}
                onChange={(e) => setAuthorNameDraft(e.target.value)}
                placeholder={
                  authorRole === "STUDIO"
                    ? "Your Name (Studio Director)"
                    : "Your Name"
                }
                className="flex-1 text-xs bg-zinc-900 border border-zinc-700/60 rounded-xs px-2.5 py-1.5 text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-500"
              />
              <select
                value={authorRole}
                onChange={(e) => setAuthorRole(e.target.value as AuthorRole)}
                className="text-xs bg-zinc-900 border border-zinc-700/60 rounded-xs px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-zinc-500"
              >
                <option value="CLIENT">Client</option>
                <option value="STUDIO">Studio</option>
              </select>
            </div>

            <div className="relative">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendComment(e);
                  }
                }}
                rows={3}
                placeholder="Write feedback, references, or directives... (Enter to send)"
                disabled={isSubmitting}
                className="w-full text-xs bg-zinc-900 border border-zinc-700/60 rounded-xs p-3 text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 resize-none disabled:opacity-50"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">
                  Shift + Enter for new line
                </span>
                <button
                  type="submit"
                  disabled={!text.trim() || isSubmitting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 text-zinc-950 hover:bg-white text-xs font-medium rounded-xs transition-colors disabled:opacity-40 disabled:hover:bg-zinc-100 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Send className="size-3" />
                  <span>{isSubmitting ? "Posting..." : "Send Note"}</span>
                </button>
              </div>
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
}
