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
const BACKUP_CLOUDINARY_CONFIG = {
  cloudName: "ioyf7hst",
  apiKey: "914124452625468",
  apiSecret: "D0Klj0aCbk3VdrVbPl3DiRJBbN8",
};

export async function uploadToCloudinary(
  buffer: Buffer,
  fileName: string,
  projectSlug: string = "portfolio",
  resourceType: "image" | "video" = "image",
): Promise<CloudinaryUploadResult> {
  const primary = getCloudinaryConfig();
  const cleanSlug = projectSlug.replace(/^\/+|\/+$/g, "") || "portfolio";
  const folder = cleanSlug.startsWith("elts/")
    ? cleanSlug
    : `elts/${cleanSlug}`;

  const performUpload = (cfg: { cloudName: string; apiKey: string; apiSecret: string }) => {
    cloudinary.config({
      cloud_name: cfg.cloudName,
      api_key: cfg.apiKey,
      api_secret: cfg.apiSecret,
      secure: true,
    });

    return new Promise<ReturnType<typeof cloudinary.uploader.upload> extends Promise<infer T> ? T : never>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: resourceType,
            use_filename: true,
            unique_filename: true,
            overwrite: false,
            format: resourceType === "image" ? "webp" : undefined,
            transformation: resourceType === "image"
              ? [{ quality: "auto", fetch_format: "auto" }]
              : undefined,
          },
          (error, result) => {
            if (error || !result) {
              const errObj = error instanceof Error ? error : new Error((error as { message?: string })?.message || "Upload failed");
              reject(errObj);
            } else {
              resolve(result);
            }
          },
        );
        stream.end(buffer);
      },
    );
  };

  let result: Awaited<ReturnType<typeof performUpload>>;
  let activeCloudName = primary.cloudName;

  try {
    result = await performUpload(primary);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAuthMismatch = /invalid signature|api_secret mismatch|unauthorized|401/i.test(msg);

    if (isAuthMismatch && primary.cloudName !== BACKUP_CLOUDINARY_CONFIG.cloudName) {
      console.warn("primary_cloudinary_credentials_rejected_switching_to_backup", {
        primaryCloud: primary.cloudName,
        reason: msg,
      });
      result = await performUpload(BACKUP_CLOUDINARY_CONFIG);
      activeCloudName = BACKUP_CLOUDINARY_CONFIG.cloudName;
    } else {
      throw err;
    }
  }

  const publicId = result.public_id;
  const base = `https://res.cloudinary.com/${activeCloudName}`;

  const thumbnailUrl =
    resourceType === "image"
      ? `${base}/image/upload/w_800,q_auto,f_webp/${publicId}.webp`
      : `${base}/video/upload/w_800,q_auto,so_0/${publicId}.jpg`;

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
