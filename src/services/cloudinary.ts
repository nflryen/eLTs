import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { getCloudinaryConfig } from "@/lib/env";

import { createCloudinaryUpload, getVerifiedCloudinaryUpload, getDeliveryTransformation } from "./cloudinary-upload";
export { createCloudinaryUpload, getVerifiedCloudinaryUpload, getDeliveryTransformation };

function getConfiguredCloudinary() {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  return cloudinary;
}

export interface CloudinaryUploadResult {
  publicId: string;
  url: string;
  thumbnailUrl: string;
  previewUrl: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
  resourceType: "image" | "video";
  durationSeconds?: number;
}

/**
 * Upload a file Buffer/stream to Cloudinary under a project-scoped folder.
 * Returns optimized delivery URLs for thumbnail, preview, and original.
 */
export async function uploadToCloudinary(
  buffer: Buffer,
  fileName: string,
  projectSlug: string = "portfolio",
  resourceType: "image" | "video" = "image",
): Promise<CloudinaryUploadResult> {
  const cld = getConfiguredCloudinary();
  const { cloudName } = getCloudinaryConfig();

  const cleanSlug = projectSlug.replace(/^\/+|\/+$/g, "") || "portfolio";
  const folder = cleanSlug.startsWith("elts/")
    ? cleanSlug
    : `elts/${cleanSlug}`;
  const result = await new Promise<ReturnType<typeof cloudinary.uploader.upload> extends Promise<infer T> ? T : never>(
    (resolve, reject) => {
      const stream = cld.uploader.upload_stream(
        {
          folder,
          resource_type: resourceType,
          use_filename: true,
          unique_filename: true,
          overwrite: false,
          // For images: auto-generate WebP delivery
          format: resourceType === "image" ? "webp" : undefined,
          transformation: resourceType === "image"
            ? [{ quality: "auto", fetch_format: "auto" }]
            : undefined,
        },
        (error, result) => {
          if (error || !result) reject(error ?? new Error("Upload failed"));
          else resolve(result);
        },
      );
      stream.end(buffer);
    },
  );

  const publicId = result.public_id;

  // Build optimized delivery URLs
  const base = `https://res.cloudinary.com/${cloudName}`;

  const thumbnailUrl =
    resourceType === "image"
      ? `${base}/image/upload/w_800,q_auto,f_webp/${publicId}.webp`
      : `${base}/video/upload/w_800,q_auto,so_0/${publicId}.jpg`; // video thumbnail poster

  const previewUrl =
    resourceType === "image"
      ? `${base}/image/upload/w_1600,q_auto,f_webp/${publicId}.webp`
      : `${base}/video/upload/w_1600,q_auto/${publicId}.mp4`;

  return {
    publicId,
    url: result.secure_url,
    thumbnailUrl,
    previewUrl,
    width: result.width ?? 0,
    height: result.height ?? 0,
    format: result.format ?? "",
    bytes: result.bytes ?? 0,
    resourceType,
    durationSeconds:
      resourceType === "video" && result.duration ? result.duration : undefined,
  };
}

/**
 * Get an optimized Cloudinary URL for a given publicId and transformation preset.
 */
export function getCloudinaryUrl(
  publicId: string,
  preset: "thumbnail" | "preview" | "original",
  resourceType: "image" | "video" = "image",
): string {
  const { cloudName } = getCloudinaryConfig();
  const base = `https://res.cloudinary.com/${cloudName}`;

  if (resourceType === "video") {
    if (preset === "thumbnail")
      return `${base}/video/upload/w_800,q_auto,so_0/${publicId}.jpg`;
    if (preset === "preview")
      return `${base}/video/upload/w_1600,q_auto/${publicId}.mp4`;
    return `${base}/video/upload/${publicId}.mp4`;
  }

  // image
  if (preset === "thumbnail")
    return `${base}/image/upload/w_800,q_auto,f_webp/${publicId}.webp`;
  if (preset === "preview")
    return `${base}/image/upload/w_1600,q_auto,f_webp/${publicId}.webp`;
  // original — no transform
  return `${base}/image/upload/${publicId}`;
}

export function getAuthenticatedCloudinaryUrl(
  publicId: string,
  variant: "thumbnail" | "preview" | "original",
  resourceType: "image" | "video",
  watermark = false,
): string {
  const cld = getConfiguredCloudinary();
  if (variant === "original") {
    return cld.url(publicId, { resource_type: resourceType, type: "authenticated", sign_url: true, secure: true });
  }
  return cld.url(publicId, {
    resource_type: resourceType,
    type: "authenticated",
    sign_url: true,
    secure: true,
    // This is already a Cloudinary transformation string. `transformation`
    // treats a string as a named transformation and emits an invalid `t_...`
    // segment; raw_transformation preserves the intended URL components.
    raw_transformation: getDeliveryTransformation(resourceType, variant, watermark),
  });
}

/**
 * Delete a resource from Cloudinary by its public_id.
 */
export async function deleteFromCloudinary(
  publicId: string,
  resourceType: "image" | "video" = "image",
  deliveryType: "upload" | "authenticated" = "upload",
): Promise<void> {
  const cld = getConfiguredCloudinary();
  await cld.uploader.destroy(publicId, { resource_type: resourceType, type: deliveryType, invalidate: true });
}
