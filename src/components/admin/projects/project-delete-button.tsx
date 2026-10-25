"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteProjectAction } from "@/app/actions/admin-projects";

interface ProjectDeleteButtonProps {
  projectId: string;
  projectName: string;
  variant?: "table-btn" | "card-btn";
}

export function ProjectDeleteButton({
  projectId,
  projectName,
  variant = "table-btn",
}: ProjectDeleteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      const res = await deleteProjectAction(projectId);
      if (res.success) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error || "Gagal menghapus proyek.");
      }
    });
  };

  return (
    <>
      {variant === "table-btn" ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          aria-label={`Hapus proyek ${projectName}`}
          className="inline-flex min-h-9 items-center justify-center rounded-[8px] border border-[#fecaca] px-2 text-[11px] font-semibold text-[#dc2626] transition-colors hover:bg-[#fef2f2] hover:border-[#f87171] cursor-pointer"
        >
          <Trash2 size={12} className="mr-1" />
          Hapus
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          aria-label={`Hapus proyek ${projectName}`}
          className="inline-flex p-1.5 rounded-full text-[#a1a1aa] hover:text-[#dc2626] hover:bg-[#fef2f2] transition-colors cursor-pointer"
        >
          <Trash2 size={13} />
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <Trash2 size={18} /> Hapus Proyek Permanen?
            </DialogTitle>
            <DialogDescription>
              Apakah Anda yakin ingin menghapus proyek <strong>&ldquo;{projectName}&rdquo;</strong>?
              Tindakan ini tidak dapat dibatalkan. Seluruh data jadwal, alokasi kru, galeri media, dan tagihan invoice terkait proyek ini akan dihapus secara permanen dari basis data.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="p-3 bg-[#fef2f2] border border-[#fecaca] rounded-lg text-xs text-[#dc2626] flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter className="mt-4 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Batal
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={handleDelete}
              disabled={pending}
              className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
            >
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {pending ? "Menghapus..." : "Hapus Permanen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
