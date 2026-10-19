"use client";

import { useTransition, useState } from "react";
import { Trash2, Image as ImageIcon, Video, Heart } from "lucide-react";
import { deleteProjectMedia } from "@/app/actions/admin-media";
import type { MediaRow } from "@/types/database";

type MediaItem = Pick<
  MediaRow,
  "id" | "type" | "file_name" | "thumbnail_key" | "width" | "height" | "file_size" | "created_at"
> & { favorites_count: number };

interface Props {
  media: MediaItem[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaGrid({ media }: Props) {
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeletingId(id);
    setConfirmId(null);
    startTransition(async () => {
      await deleteProjectMedia(id);
      setDeletingId(null);
    });
  };

  if (media.length === 0) {
    return (
      <div className="bg-white border border-border rounded-[12px] px-6 py-16 text-center">
        <ImageIcon size={32} className="text-border mx-auto mb-3" />
        <p className="font-medium mb-1">No media yet</p>
        <p className="text-sm text-muted-foreground">
          Upload photos or videos using the dropzone above.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {media.map((m) => {
        const isDeleting = deletingId === m.id;
        const isConfirming = confirmId === m.id;

        return (
          <div
            key={m.id}
            className={`group relative rounded-[12px] overflow-hidden bg-[#fafafa] aspect-square border border-border ${isDeleting ? "opacity-50" : ""}`}
          >
            {/* Thumbnail */}
            {m.thumbnail_key ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.thumbnail_key}
                alt={m.file_name}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                {m.type === "video" ? (
                  <Video size={24} />
                ) : (
                  <ImageIcon size={24} />
                )}
              </div>
            )}

            {/* Video badge */}
            {m.type === "video" && (
              <span className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                VIDEO
              </span>
            )}

            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end p-2 opacity-0 group-hover:opacity-100">
              <div className="w-full flex items-end justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs truncate leading-tight">{m.file_name}</p>
                  <p className="text-white/70 text-[10px]">{formatBytes(m.file_size)}</p>
                </div>
                {m.favorites_count > 0 && (
                  <div className="flex items-center gap-1 text-white bg-[#ff5a00]/100/90 rounded-[12px] px-1.5 py-0.5 text-[10px] font-medium shrink-0">
                    <Heart size={10} className="fill-white" />
                    <span>{m.favorites_count}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Delete button */}
            {!isConfirming ? (
              <button
                type="button"
                aria-label={`Delete ${m.file_name}`}
                onClick={() => setConfirmId(m.id)}
                disabled={isPending}
                className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-[#ff5a00] text-white rounded p-1 opacity-0 group-hover:opacity-100 transition-all"
              >
                <Trash2 size={12} />
              </button>
            ) : (
              // Confirm overlay
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-1.5 p-2">
                <p className="text-white text-xs text-center font-medium">Delete?</p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleDelete(m.id)}
                    disabled={isPending}
                    className="bg-[#ff5a00] hover:bg-[#c2410c] text-white text-[10px] px-2 py-1 rounded font-medium"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="bg-white/20 hover:bg-white/30 text-white text-[10px] px-2 py-1 rounded font-medium"
                  >
                    No
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
