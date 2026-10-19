import "server-only";
import { cookies } from "next/headers";
import { createServiceSupabase } from "@/lib/supabase/service";
import { hashSessionToken } from "@/lib/security/credentials";
export const galleryCookieName = process.env.NODE_ENV === 'production' ? '__Host-elts_gallery' : 'elts_gallery_dev';
export async function getGallerySession() {
  const token = (await cookies()).get(galleryCookieName)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const {data,error} = await createServiceSupabase().rpc('resolve_gallery_session', {p_token_hash:hashSessionToken(token)});
  if(error) throw new Error('Gallery session lookup unavailable');
  return data?.[0] ?? null;
}
export async function requireGallerySession(projectId: string, locator?: string) {
  const session = await getGallerySession();
  if (!session || session.project_id !== projectId || (locator && locator !== session.access_token && locator !== session.slug)) throw new Error('Gallery access denied');
  return session;
}
