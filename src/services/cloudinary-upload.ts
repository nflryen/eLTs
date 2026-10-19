import "server-only";
import { timingSafeEqual } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";
import { getCloudinaryConfig } from "@/lib/env";
import type { UploadIntent } from "@/lib/security/upload-intent";
import type { SignedMediaUpload, UploadReceipt } from "@/lib/uploads/policy";

function getConfiguredCloudinary() {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return cloudinary;
}

/** Keep eager generation and protected delivery transformations identical. */
export function getDeliveryTransformation(
  resourceType: "image" | "video",
  variant: "thumbnail" | "preview",
  watermark: boolean,
): string {
  const width = variant === "thumbnail" ? 800 : 1600;
  const poster = resourceType === "video" && variant === "thumbnail";
  const format = resourceType === "image" ? "webp" : poster ? "jpg" : "mp4";
  const base = `c_limit,w_${width},q_auto${poster ? ",so_0" : ""}`;
  const mark = watermark ? "/l_text:Arial_48:Elts.,co_white,o_45/fl_layer_apply,g_south_east,x_24,y_24" : "";
  return `${base}${mark}/f_${format}`;
}

export function createCloudinaryUpload(intent: UploadIntent, signedIntent: string): SignedMediaUpload {
  const cld = getConfiguredCloudinary();
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const eager = (["thumbnail", "preview"] as const).flatMap((variant) =>
    [false, true].map((watermark) => getDeliveryTransformation(intent.resourceType, variant, watermark)),
  ).join("|");
  // Only these exact parameters are signed. Originals retain the uploaded bytes.
  const parameters: Record<string, string> = {
    timestamp: String(Math.floor(Date.now() / 1000)),
    public_id: intent.publicId,
    type: "authenticated",
    overwrite: "false",
    allowed_formats: intent.resourceType === "image" ? "jpg,jpeg,png,webp" : "mp4,mov",
    eager,
  };
  return {
    intent: signedIntent,
    endpoint: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${intent.resourceType}/upload`,
    fields: { ...parameters, api_key: apiKey, signature: cld.utils.api_sign_request(parameters, apiSecret) },
    publicId: intent.publicId,
  };
}

const resourceSchema = z.object({
  public_id: z.string(), version: z.number().int().positive(),
  resource_type: z.enum(["image", "video"]), type: z.literal("authenticated"),
  format: z.enum(["jpg", "jpeg", "png", "webp", "mp4", "mov"]),
  bytes: z.number().int().positive(), width: z.number().int().positive(), height: z.number().int().positive(),
  duration: z.number().positive().optional(),
});

/** Never trust dimensions, bytes, type or asset URLs supplied by a browser. */
export async function getVerifiedCloudinaryUpload(intent: UploadIntent, receipt: UploadReceipt) {
  const cld = getConfiguredCloudinary();
  const expected = cld.utils.api_sign_request({ public_id: intent.publicId, version: receipt.version }, getCloudinaryConfig().apiSecret);
  const provided = Buffer.from(receipt.signature, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  if (receipt.publicId !== intent.publicId || provided.length !== expectedBytes.length || !timingSafeEqual(provided, expectedBytes)) {
    throw new Error("Invalid upload confirmation.");
  }
  const result: unknown = await cld.api.resource(intent.publicId, { resource_type: intent.resourceType, type: "authenticated" });
  const resource = resourceSchema.parse(result);
  const mimeByFormat = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    mp4: "video/mp4", mov: "video/quicktime",
  } as const;
  if (resource.public_id !== intent.publicId || resource.version !== receipt.version ||
      resource.resource_type !== intent.resourceType || resource.bytes !== intent.metadata.fileSize ||
      mimeByFormat[resource.format] !== intent.metadata.mimeType) {
    throw new Error("Uploaded file does not match the authorized upload.");
  }
  return { ...resource, mimeType: mimeByFormat[resource.format] };
}
