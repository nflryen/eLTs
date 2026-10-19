import { z } from "zod";

// Application limits. Cloudinary also enforces the limits of the connected plan.
export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 6 * 1024 * 1024;
export const UPLOAD_CONCURRENCY = 2;
export const UPLOAD_ACCEPT = ".jpg,.jpeg,.png,.webp,.mp4,.mov";

const mimeTypes = [
  "image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime",
] as const;

export const uploadMetadataSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(mimeTypes),
  fileSize: z.number().int().positive().max(MAX_VIDEO_BYTES),
}).superRefine((value, ctx) => {
  if (value.mimeType.startsWith("image/") && value.fileSize > MAX_IMAGE_BYTES) {
    ctx.addIssue({ code: "custom", message: "Photo exceeds the 100 MB application limit." });
  }
});

export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;
export interface SignedMediaUpload {
  intent: string;
  endpoint: string;
  fields: Record<string, string>;
  publicId: string;
}
export interface UploadReceipt {
  publicId: string;
  version: number;
  signature: string;
}

/** A filename fallback handles browsers which leave MP4/MOV MIME empty. */
export function fileUploadMetadata(file: Pick<File, "name" | "type" | "size">): UploadMetadata {
  const extension = file.name.toLowerCase().split(".").pop();
  const mimeByExtension: Record<string, UploadMetadata["mimeType"]> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    mp4: "video/mp4", mov: "video/quicktime",
  };
  const mimeType = file.type === "image/jpg" ? "image/jpeg" : file.type || mimeByExtension[extension ?? ""];
  const result = uploadMetadataSchema.safeParse({ fileName: file.name, mimeType, fileSize: file.size });
  if (!result.success) {
    if (file.size === 0) throw new Error("This file is empty.");
    if (mimeType?.startsWith("image/") && file.size > MAX_IMAGE_BYTES)
      throw new Error("Photo exceeds the 100 MB application limit.");
    if (file.size > MAX_VIDEO_BYTES) throw new Error("Video exceeds the 2 GB application limit.");
    throw new Error("Choose a JPG, PNG, WEBP, MP4 or MOV file with a filename under 256 characters.");
  }
  return result.data;
}

export function formatUploadBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
