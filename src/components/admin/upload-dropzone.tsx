"use client";

import { startTransition, useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, X, CheckCircle2, AlertCircle, Loader2, RotateCcw } from "lucide-react";
import { prepareProjectMediaUpload, completeProjectMediaUpload } from "@/app/actions/admin-media";
import { formatUploadBytes, UPLOAD_ACCEPT, UPLOAD_CONCURRENCY } from "@/lib/uploads/policy";
import { uploadInChunks, runUploadQueue } from "@/lib/uploads/direct-upload";
import { runUploadSession, type UploadSession } from "@/lib/uploads/upload-session";
import { cn } from "@/lib/utils";

interface FileStatus {
  id: string;
  name: string;
  size: number;
  state: "pending" | "uploading" | "saving" | "done" | "error";
  progress: number;
  error?: string;
  retrySave?: boolean;
}
interface UploadDropzoneProps { projectId: string; onUploadComplete?: () => void; }

export function UploadDropzone({ projectId, onUploadComplete }: UploadDropzoneProps) {
  const router = useRouter();
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessions = useRef(new Map<string, UploadSession>());
  // State updates are asynchronous; a ref also prevents two drops/clicks in the same render.
  const batchActive = useRef(false);

  const runBatch = useCallback(async (ids: string[]) => {
    if (batchActive.current || !ids.length) return;
    batchActive.current = true;
    setIsUploading(true);
    setFiles((prev) => prev.map((file) => ids.includes(file.id) ? { ...file, state: "pending", error: undefined } : file));
    let completed = 0;
    try {
      await runUploadQueue(ids, UPLOAD_CONCURRENCY, async (id) => {
        const session = sessions.current.get(id);
        if (!session) return;
        const set = (patch: Partial<FileStatus>) => setFiles((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
        try {
          await runUploadSession(session, {
            prepare: (metadata) => prepareProjectMediaUpload(projectId, metadata),
            transfer: uploadInChunks,
            complete: completeProjectMediaUpload,
          }, set);
          completed += 1;
          sessions.current.delete(id);
        } catch (error) {
          set({
            state: "error",
            retrySave: Boolean(session.receipt),
            error: error instanceof Error ? error.message : "Upload failed. Please retry.",
          });
        }
      });
    } finally {
      batchActive.current = false;
      setIsUploading(false);
      if (completed) {
        router.refresh();
        onUploadComplete?.();
      }
    }
  }, [onUploadComplete, projectId, router]);

  const uploadAll = useCallback((incoming: File[]) => {
    if (batchActive.current || !incoming.length) return;
    const jobs = incoming.map((file) => {
      const id = crypto.randomUUID();
      sessions.current.set(id, { file });
      return { id, name: file.name, size: file.size, state: "pending" as const, progress: 0 };
    });
    setFiles((prev) => [...prev, ...jobs]);
    startTransition(() => runBatch(jobs.map((job) => job.id)));
  }, [runBatch]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    uploadAll(Array.from(event.dataTransfer.files));
  }, [uploadAll]);
  const handleInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    uploadAll(Array.from(event.target.files ?? []));
    event.target.value = "";
  }, [uploadAll]);
  const removeFile = (id: string) => {
    if (batchActive.current) return;
    sessions.current.delete(id);
    setFiles((prev) => prev.filter((item) => item.id !== id));
  };
  const retry = (ids: string[]) => startTransition(() => runBatch(ids));
  const stats = { total: files.length, done: files.filter((file) => file.state === "done").length, error: files.filter((file) => file.state === "error").length };

  return <div className="space-y-4">
    <input ref={inputRef} type="file" accept={UPLOAD_ACCEPT} multiple className="sr-only" onChange={handleInput} disabled={isUploading} tabIndex={-1} aria-label="Choose photos and videos" />
    <button type="button" onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); if (!batchActive.current) setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop} disabled={isUploading} aria-label="Upload media files" className={cn("w-full rounded-lg border-2 border-dashed p-6 text-center transition-colors sm:p-10", isDragging ? "border-[#09090b] bg-[#f4f4f5]" : "border-border bg-white hover:border-[#a1a1aa]", isUploading && "opacity-60")}>
      <UploadCloud aria-hidden="true" className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
      <p className="text-sm font-medium">Drop your photos & videos here</p>
      <p className="mt-1 text-sm text-muted-foreground">or <span className="underline">browse files</span></p>
      <p className="mt-3 text-xs text-muted-foreground">JPG · PNG · WEBP · MP4 · MOV · photos up to 100 MB · videos up to 2 GB</p>
    </button>
    {files.length > 0 && <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span role="status" className="text-muted-foreground">{isUploading ? `Processing files: ${stats.done} / ${stats.total} saved…` : `${stats.done} uploaded${stats.error ? `, ${stats.error} failed` : ""}`}</span>
        <div className="flex flex-wrap gap-3">
          {stats.error > 1 && <button type="button" disabled={isUploading} onClick={() => retry(files.filter((file) => file.state === "error").map((file) => file.id))} className="min-h-11 text-xs underline disabled:opacity-50">Retry failed files</button>}
          <button type="button" disabled={isUploading} onClick={() => { if (!batchActive.current) { sessions.current.clear(); setFiles([]); } }} className="min-h-11 text-xs underline disabled:opacity-50">Clear all</button>
        </div>
      </div>
      <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border bg-white">
        {files.map((file) => <li key={file.id} className="flex items-start gap-3 px-4 py-3 text-sm">
          <span aria-hidden="true" className="mt-1 shrink-0">{file.state === "done" ? <CheckCircle2 className="h-4 w-4 text-[#09090b]" /> : file.state === "error" ? <AlertCircle className="h-4 w-4 text-[#ff5a00]" /> : file.state === "uploading" || file.state === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="block h-4 w-4 rounded-full border-2" />}</span>
          <div className="min-w-0 flex-1">
            <p className="[overflow-wrap:anywhere]">{file.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatUploadBytes(file.size)} · {file.state === "pending" ? "Waiting…" : file.state === "uploading" ? `Uploading ${file.progress}%` : file.state === "saving" ? "Uploaded · saving to gallery…" : file.state === "done" ? "Saved to gallery" : file.retrySave ? "Uploaded · saving failed" : "Upload failed"}
            </p>
            {file.state === "error" && <>
              <p role="alert" className="mt-2 whitespace-pre-wrap text-xs text-[#ff5a00] [overflow-wrap:anywhere]">{file.error}</p>
              {file.retrySave && <p className="mt-1 text-xs text-muted-foreground">Keep this page open. Retry saving without uploading the file again.</p>}
              <button type="button" disabled={isUploading} onClick={() => retry([file.id])} aria-label={`${file.retrySave ? "Retry saving" : "Retry upload for"} ${file.name}`} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-[#f4f4f5] disabled:opacity-50">
                <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />{file.retrySave ? "Retry saving" : "Retry upload"}
              </button>
            </>}
          </div>
          <button type="button" disabled={isUploading} aria-label={`Remove ${file.name}`} onClick={() => removeFile(file.id)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-[#f4f4f5] disabled:opacity-40"><X aria-hidden="true" className="h-4 w-4" /></button>
        </li>)}
      </ul>
    </div>}
  </div>;
}
