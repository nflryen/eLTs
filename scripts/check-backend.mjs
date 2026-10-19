// Read-only diagnostics. Never print keys, PINs, hashes, URLs or customer details.
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await db.from('projects').select('status,gallery_pin_hash');
if(error) { console.log(JSON.stringify({check:'projects',errorCode:error.code})); process.exitCode=1; }
else {
 const summary={total:data.length,ready:0,envelopeV1:0,envelopeV2:0,legacySha256:0,unknown:0};
 for(const row of data){ if(row.status==='ready')summary.ready++; const h=row.gallery_pin_hash; if(h.startsWith('scrypt-v1$'))summary.envelopeV1++;else if(h.startsWith('scrypt-v2$'))summary.envelopeV2++;else if(/^[a-f0-9]{64}$/.test(h))summary.legacySha256++;else summary.unknown++; }
 console.log(JSON.stringify({check:'projects',...summary}));
}
const {error: mediaError}=await db.from('media').select('id,cloudinary_delivery_type').limit(0);
console.log(JSON.stringify({check:'delivery_column',available:!mediaError,errorCode:mediaError?.code}));
const {error: sessionError}=await db.rpc('resolve_gallery_session',{p_token_hash:'0'.repeat(64)});
console.log(JSON.stringify({check:'session_rpc',available:!sessionError,errorCode:sessionError?.code}));
