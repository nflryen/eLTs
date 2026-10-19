import "server-only";
import { z } from "zod";

const supabaseSchema = z.object({
  url: z.url(),
  anonKey: z.string().min(1),
});

export function getSupabaseConfig() {
  const result = supabaseSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!result.success)
    throw new Error(
      "Supabase is not configured. Check the server environment.",
    );
  return result.data;
}

export function getServiceRoleKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Supabase service credentials are not configured.");
  return key;
}

export function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret)
    throw new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.",
    );
  return { cloudName, apiKey, apiSecret };
}

export function getPinPepper() {
  const pepper = process.env.GALLERY_PIN_PEPPER;
  if (!pepper || pepper.length < 43)
    throw new Error(
      "GALLERY_PIN_PEPPER must contain at least 32 random bytes encoded as base64url.",
    );
  return pepper;
}
