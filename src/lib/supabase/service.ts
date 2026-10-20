import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleKey, getSupabaseConfig } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * An untyped service-role client. Untyped on purpose: the hosted schema may be
 * ahead of the checked-in generated types, and a stale Database generic would
 * reject valid queries. Named here so consumers depend on the contract, not on
 * `ReturnType<typeof createServiceSupabase>`.
 */
export type ServiceSupabaseClient = SupabaseClient<Database>;

/** Bypasses RLS. Only call AFTER project/session or admin authorization. */
export function createServiceSupabase(): ServiceSupabaseClient {
  // Service queries are deliberately kept server-only; this client is untyped because
  // the hosted schema may be ahead of the checked-in generated types.
  return createClient<Database>(getSupabaseConfig().url, getServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
