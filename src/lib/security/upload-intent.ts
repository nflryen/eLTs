import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { uploadMetadataSchema } from "@/lib/uploads/policy";

const intentSchema = z.object({
  metadata: uploadMetadataSchema,
  adminId: z.uuid(),
  projectId: z.uuid(),
  mediaId: z.uuid(),
  publicId: z.string().max(200),
  resourceType: z.enum(["image", "video"]),
  expiresAt: z.number().int().positive(),
});
export type UploadIntent = z.infer<typeof intentSchema>;

export function signUploadIntent(intent: UploadIntent, secret: string): string {
  const payload = Buffer.from(JSON.stringify(intentSchema.parse(intent))).toString("base64url");
  const signature = createHmac("sha256", secret).update(`elts-upload-v1.${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyUploadIntent(
  token: string, secret: string, adminId: string, now = Date.now(),
): UploadIntent | null {
  if (typeof token !== "string" || token.length > 4096) return null;
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra) return null;
  const expected = createHmac("sha256", secret).update(`elts-upload-v1.${payload}`).digest();
  const signature = Buffer.from(supplied, "base64url");
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  try {
    const parsed = intentSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    if (!parsed.success) return null;
    const intent = parsed.data;
    if (intent.adminId !== adminId || intent.expiresAt <= now) return null;
    if (intent.publicId !== `elts/${intent.projectId}/${intent.mediaId}`) return null;
    if ((intent.metadata.mimeType.startsWith("video/") ? "video" : "image") !== intent.resourceType) return null;
    return intent;
  } catch {
    return null;
  }
}
