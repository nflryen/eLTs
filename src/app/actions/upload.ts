"use server";

import { requireOps } from "@/lib/auth/roles";
import { uploadToCloudinary, type CloudinaryUploadResult } from "@/services/cloudinary";

export type UploadImageActionResult =
  | { ok: true; data: CloudinaryUploadResult }
  | { ok: false; error: string };

const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * Server action to upload an image to Cloudinary from admin forms or actions.
 * Enforces operator rank >= 80 authorization.
 */
export async function uploadImageAction(
  formData: FormData,
): Promise<UploadImageActionResult> {
  try {
    await requireOps();

    const file = formData.get("file") ?? formData.get("image");
    if (!file || !(file instanceof Blob)) {
      return { ok: false, error: "File gambar tidak ditemukan dalam permintaan." };
    }

    if (file.size > MAX_FILE_SIZE) {
      return { ok: false, error: "Ukuran file melebihi batas maksimal 20MB." };
    }

    if (file.type && !file.type.startsWith("image/")) {
      return { ok: false, error: "File harus berupa gambar (JPEG, PNG, WebP, dll)." };
    }

    const rawFolder = formData.get("folder");
    const folder = typeof rawFolder === "string" && rawFolder.trim()
      ? rawFolder.trim().replace(/[^a-zA-Z0-9_\-\/]/g, "")
      : "portfolio";

    const fileName = file instanceof File ? file.name : "upload.webp";
    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await uploadToCloudinary(buffer, fileName, folder, "image");

    return {
      ok: true,
      data: result,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Gagal mengunggah gambar ke Cloudinary.";
    console.error("upload_image_action_failed", { message });
    return { ok: false, error: message };
  }
}
