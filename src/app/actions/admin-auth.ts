"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Only same-origin admin paths are valid post-login destinations.
 *
 * Without this check, `redirectedFrom` becomes an open-redirect vector: an
 * attacker could send `/admin/login?redirectedFrom=https://evil.example` and
 * land a freshly authenticated admin on a phishing page that looks like the
 * studio OS. Relative admin paths only.
 */
function safeRedirectTarget(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  const isAdminPath = value.startsWith("/admin") || value.startsWith("/api/admin");
  // Reject protocol-relative ("//evil.com") and absolute ("https://…") forms:
  // both would turn `redirectedFrom` into an open redirect after sign-in.
  if (!isAdminPath || value.startsWith("//") || value.includes("://")) return "/admin";
  return value;
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
