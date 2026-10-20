import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "@/lib/env";
import { normaliseBaseUrl } from "@/lib/url";
import type { Database } from "@/types/database";

export async function createServerSupabase() {
  const config = getSupabaseConfig();
  const cookieStore = await cookies();
  /*
   * Defensive re-normalisation. `getSupabaseConfig()` already guarantees a bare
   * origin, but this client is also reachable from paths that read the env var
   * directly, and a single trailing slash here is enough to break every auth
   * call with a double-slash path.
   */
  const url = normaliseBaseUrl(config.url) ?? config.url;
  return createServerClient<Database>(url, config.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          /* Server Components cannot write cookies. The admin proxy must refresh them. */
        }
      },
    },
  });
}
