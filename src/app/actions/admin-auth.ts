"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { sanitiseReturnPath } from "@/lib/url";

/*
 * The post-login destination is sanitised by `sanitiseReturnPath`, which is
 * stricter than the previous local `startsWith('/admin')` check.
 *
 * That check accepted three shapes it should have refused:
 *   /admin\..\x          browsers read `\` as `/`, so this is a traversal
 *   /admin//finance      doubled slash
 *   /admin/../../etc     resolves outside /admin entirely
 *
 * It also rejected legitimate settings destinations such as
 * /settings/profile?denied=super_admin_required. Both bugs are fixed in one
 * place, and the helper is unit-tested.
 */
const LOGIN_RETURN_PREFIXES = ["/admin", "/settings"] as const;

function safeRedirectTarget(raw: unknown): string {
  return sanitiseReturnPath(typeof raw === "string" ? raw : null, LOGIN_RETURN_PREFIXES) ?? "/admin";
}

export async function adminLogin(state: unknown, formData: FormData) {
  const email = formData.get("email")?.toString();
  const password = formData.get("password")?.toString();
  const next = safeRedirectTarget(formData.get("redirectedFrom"));

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  const supabase = await createServerSupabase();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  /*
   * Honour the destination the proxy recorded. Opening a print URL in a new tab
   * with an expired session now returns you to that document after signing in,
   * instead of dumping you on the dashboard and making you navigate back.
   */
  redirect(next);
}

export async function adminLogout() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
