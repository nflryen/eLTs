"use server";
import { createHmac } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServiceSupabase } from '@/lib/supabase/service';
import { getPinPepper } from '@/lib/env';
import { createOpaqueSession, hashSessionToken, performDummyPinVerification, verifyAndUpgradeGalleryPin } from '@/lib/security/credentials';
import { galleryCookieName } from '@/lib/auth/gallery';

export type ClientAccessState = { error: string } | null;
const invalid = {error:'Invalid gallery code or PIN.'};
export async function verifyClientAccess(_state: ClientAccessState, formData: FormData): Promise<ClientAccessState> {
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  const pin = String(formData.get('pin') ?? '').trim();
  if (!/^ELTS-[A-Z0-9]{4,16}$/.test(code) || pin.length < 4 || pin.length > 12) return invalid;
  let destination: string;
  try {
    const db=createServiceSupabase();
    const pepper=getPinPepper();
    const requestHeaders=await headers();
    const ip=process.env.VERCEL==='1' ? requestHeaders.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown' : 'local';
    const bucket=(value:string)=>createHmac('sha256',pepper).update(`gallery-limit:${value}`).digest('hex');
    const limits=await Promise.all([
      db.rpc('consume_gallery_attempt',{p_bucket_key:bucket(`ip:${ip}`)}),
      db.rpc('consume_gallery_attempt',{p_bucket_key:bucket(`code:${code}`)}),
    ]);
    if(limits.some(result=>result.error||!result.data?.[0])) return {error:'Gallery access is temporarily unavailable. Please contact Elts.'};
    if(limits.some(result=>!result.data![0].allowed)) return {error:'Too many attempts. Please wait 10 minutes and try again.'};
    const {data:project,error}=await db.from('projects').select('id,gallery_pin_hash,status,expires_at').eq('gallery_code',code).maybeSingle();
    if(error) return {error:'Gallery access is temporarily unavailable. Please contact Elts.'};
    if(!project) { await performDummyPinVerification(pepper); return invalid; }
    const verified=await verifyAndUpgradeGalleryPin(pin,project.gallery_pin_hash,pepper);
    if(!verified.valid) return invalid;
    if(project.status!=='ready'||(project.expires_at!==null&&new Date(project.expires_at).getTime()<=Date.now())) return {error:'This gallery is not currently available. Please contact Elts.'};
    const {token,tokenHash}=createOpaqueSession();
    const {data:sessions,error:sessionError}=await db.rpc('create_gallery_session',{
      p_project_id:project.id,p_verified_pin_hash:project.gallery_pin_hash,p_token_hash:tokenHash,p_upgraded_pin_hash:verified.upgradedHash ?? null,
    });
    if(sessionError) { console.error('Gallery session could not be created',{code:sessionError.code}); return {error:'Gallery access needs a server update. Please contact Elts.'}; }
    const session=sessions?.[0];
    if(!session)return invalid;
    (await cookies()).set(galleryCookieName,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',expires:new Date(session.expires_at)});
    destination=`/gallery/${session.access_token}`;
  } catch { return {error:'Gallery access is temporarily unavailable. Please contact Elts.'}; }
  redirect(destination);
}
export async function logoutGallery() {
  const cookieStore=await cookies();
  const token=cookieStore.get(galleryCookieName)?.value;
  if(token&&/^[A-Za-z0-9_-]{43}$/.test(token)) {
    const {error}=await createServiceSupabase().rpc('revoke_gallery_session',{p_token_hash:hashSessionToken(token)});
    if(error) throw new Error('Could not sign out. Please try again.');
  }
  cookieStore.delete(galleryCookieName);
  redirect('/client');
}
