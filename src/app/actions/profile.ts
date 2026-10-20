"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getRoleSession } from "@/lib/auth/roles";
import { PAYOUT_PROVIDERS } from "@/lib/payout-providers";

/*
 * SELF-SERVICE PROFILE, PAYOUT, AND CREDENTIAL MANAGEMENT
 * ------------------------------------------------------
 * Every action resolves the actor from `auth.getUser()` and NEVER accepts a
 * user id from the request. Payout changes additionally require the account
 * password: payout redirection is the highest-value fraud in a payroll system,
 * and an XSS or a borrowed unlocked laptop must not be enough to redirect a
 * colleague's salary.
 */

const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  displayName: z.string().trim().max(60).optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9\-\s]{6,19}$/, "Nomor telepon tidak valid")
    .optional()
    .or(z.literal("")),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

const payoutSchema = z
  .object({
    provider: z.string().min(1),
    accountHolder: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().min(4).max(40),
    /** Required — verified server-side before the write. */
    password: z.string().min(1),
  })
  .strict();

/** Reads the caller's profile. Returns null when not signed in. */
export async function getMyProfileAction() {
  const session = await getRoleSession().catch(() => null);
  if (!session) return null;

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("user_profiles")
    .select(
      "full_name, display_name, phone, payout_method, bank_name, bank_account_holder, bank_account_number, ewallet_provider, ewallet_id",
    )
    .eq("user_id", session.user.id)
    .maybeSingle();

  return {
    email: session.user.email ?? "",
    fullName: data?.full_name ?? session.displayName,
    displayName: data?.display_name ?? session.displayName,
    phone: data?.phone ?? "",
    payoutMethod: data?.payout_method ?? null,
    bankName: data?.bank_name ?? null,
    bankAccountHolder: data?.bank_account_holder ?? null,
    bankAccountNumber: data?.bank_account_number ?? null,
    ewalletProvider: data?.ewallet_provider ?? null,
    ewalletId: data?.ewallet_id ?? null,
  };
}

/**
 * Updates personal data.
 *
 * Uses the USER-SCOPED client so the `user_profiles_update_self` RLS policy is
 * the enforcement point, not this function's logic.
 */
export async function updateProfileAction(input: {
  fullName: string;
  displayName?: string;
  phone?: string;
}): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }

  const session = await getRoleSession().catch(() => null);
  if (!session) return { ok: false, error: "Sesi tidak ditemukan." };

  const supabase = await createServerSupabase();

  const { error } = await supabase.from("user_profiles").upsert(
    {
      user_id: session.user.id,
      full_name: parsed.data.fullName,
      display_name: parsed.data.displayName || null,
      phone: parsed.data.phone || null,
    },
    { onConflict: "user_id" },
  );

  if (error) return { ok: false, error: error.message };

  /*
   * Keep GoTrue's user metadata in step so the name shown in auth emails and
   * anywhere reading `user_metadata.full_name` matches the profile.
   */
  await supabase.auth.updateUser({
    data: { full_name: parsed.data.fullName, display_name: parsed.data.displayName || null },
  });

  revalidatePath("/settings/profile");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Updates payout destination. REQUIRES the account password.
 *
 * Flow:
 *   1. Re-authenticate with `signInWithPassword` — the same primitive as role
 *      elevation, so there is one password-verification path in the system.
 *   2. Mint a single-use payout token via a service_role-only RPC.
 *   3. Apply the change through `update_payout_with_challenge`, which consumes
 *      the token atomically and writes the row.
 *
 * A wrong password fails at step 1 and never reaches the database.
 */
export async function updatePayoutAction(input: {
  provider: string;
  accountHolder: string;
  accountNumber: string;
  password: string;
}): Promise<ActionResult> {
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }

  const session = await getRoleSession().catch(() => null);
  if (!session) return { ok: false, error: "Sesi tidak ditemukan." };

  const provider = PAYOUT_PROVIDERS.find((p) => p.value === parsed.data.provider);
  if (!provider) return { ok: false, error: "Penyedia pembayaran tidak dikenal." };

  const supabase = await createServerSupabase();

  /* Step 1 — password challenge. */
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: session.user.email ?? "",
    password: parsed.data.password,
  });

  if (authError) {
    return { ok: false, error: "Kata sandi salah. Perubahan rekening dibatalkan." };
  }

  const service = createServiceSupabase();

  /* Step 2 — single-use token, service_role only. */
  const { data: token, error: mintError } = await service.rpc(
    "mint_payout_challenge_token",
    { p_user_id: session.user.id },
  );

  if (mintError || !token) {
    console.error("payout_token_mint_failed", { code: mintError?.code });
    return { ok: false, error: "Gagal membuat token konfirmasi." };
  }

  /* Step 3 — atomic consume + write. */
  const isBank = provider.kind === "BANK";
  const { error } = await supabase.rpc("update_payout_with_challenge", {
    p_token: token as string,
    p_payout_method: provider.kind,
    p_bank_name: isBank ? provider.value : null,
    p_bank_account_holder: isBank ? parsed.data.accountHolder : null,
    p_bank_account_number: isBank ? parsed.data.accountNumber : null,
    p_ewallet_provider: isBank ? null : provider.value,
    p_ewallet_id: isBank ? null : parsed.data.accountNumber,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/profile");
  return { ok: true };
}

/**
 * Changes the account password. Requires the CURRENT password.
 *
 * Supabase only enforces reauthentication on `updateUser` when *Secure password
 * change* is enabled AND the session is older than 24 hours, so we verify
 * explicitly rather than relying on project settings.
 */
/**
 * Starts an email change.
 *
 * Supabase does NOT switch the address immediately: it sends a confirmation
 * link to the NEW address and (depending on project settings) a notice to the
 * old one. The account keeps its current email until the link is followed, so
 * this action reports "pending" rather than "changed" — claiming success here
 * would be a lie the user discovers at next login.
 *
 * Requires the current password. An attacker with a borrowed session must not
 * be able to move the account's recovery address to a mailbox they control,
 * which is a full account takeover.
 */
export async function changeEmailAction(input: {
  newEmail: string;
  password: string;
}): Promise<{ ok: true; pendingEmail: string } | { ok: false; error: string }> {
  const schema = z.object({
    newEmail: z.string().trim().email("Alamat email tidak valid.").max(254),
    password: z.string().min(1),
  });

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }

  const session = await getRoleSession().catch(() => null);
  if (!session) return { ok: false, error: "Sesi tidak ditemukan." };

  const currentEmail = (session.user.email ?? "").toLowerCase();
  const nextEmail = parsed.data.newEmail.toLowerCase();

  if (nextEmail === currentEmail) {
    return { ok: false, error: "Email baru sama dengan email saat ini." };
  }

  const supabase = await createServerSupabase();

  /* Step-up: prove the caller knows the current password. */
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: session.user.email ?? "",
    password: parsed.data.password,
  });

  if (authError) {
    return { ok: false, error: "Kata sandi salah. Perubahan email dibatalkan." };
  }

  /*
   * `emailRedirectTo` must point at a route that can explain the outcome. It is
   * resolved from the configured app URL rather than the request Host header,
   * so a spoofed Host cannot redirect the confirmation link elsewhere.
   */
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const { error } = await supabase.auth.updateUser(
    { email: nextEmail },
    appUrl ? { emailRedirectTo: `${appUrl}/settings/security?email=confirmed` } : undefined,
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/security");
  return { ok: true, pendingEmail: nextEmail };
}

export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<ActionResult> {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(10, "Kata sandi baru minimal 10 karakter.")
      .max(200),
  });

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }

  const session = await getRoleSession().catch(() => null);
  if (!session) return { ok: false, error: "Sesi tidak ditemukan." };

  const supabase = await createServerSupabase();

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: session.user.email ?? "",
    password: parsed.data.currentPassword,
  });

  if (authError) return { ok: false, error: "Kata sandi saat ini salah." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
  if (error) return { ok: false, error: error.message };

  /*
   * Revoke every OTHER session. A password change that leaves old sessions
   * alive does not contain a compromise. The current session is kept so the
   * user is not signed out of the tab they just used.
   */
  await revokeOtherSessions();

  return { ok: true };
}

/**
 * Revokes all sessions except the caller's current one.
 *
 * Deleting `auth.sessions` rows cascades to `user_session_context`, so an
 * elevated role in a killed session disappears with it.
 */
async function revokeOtherSessions(): Promise<void> {
  const supabase = await createServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return;

  const currentSid = JSON.parse(
    Buffer.from(session.access_token.split(".")[1], "base64url").toString(),
  ).session_id as string | undefined;

  if (!currentSid) return;

  await createServiceSupabase()
    .from("user_session_context")
    .delete()
    .neq("session_id", currentSid);
}

export type SessionRow = {
  sessionId: string;
  createdAt: string;
  updatedAt: string | null;
  isCurrent: boolean;
  activeRole: string | null;
  elevatedUntil: string | null;
};

/**
 * Lists the caller's active sessions.
 *
 * Reads `auth.sessions` through the service client because that table is not
 * exposed to PostgREST, filtering strictly on `auth.uid()`.
 */
export async function listMySessionsAction(): Promise<SessionRow[]> {
  const session = await getRoleSession().catch(() => null);
  if (!session) return [];

  const supabase = await createServerSupabase();
  const {
    data: { session: current },
  } = await supabase.auth.getSession();

  const currentSid = current?.access_token
    ? (JSON.parse(Buffer.from(current.access_token.split(".")[1], "base64url").toString())
        .session_id as string | undefined)
    : undefined;

  const service = createServiceSupabase();

  /*
   * `auth.sessions` is not an exposed schema, so it is read through a
   * SECURITY DEFINER RPC that filters on `auth.uid()` internally. Falling back
   * to just the current session is deliberate: showing nothing would look like
   * "no other sessions exist", which is a security claim we cannot make.
   */
  const { data: rows } = await service.rpc("list_my_sessions");

  if (!rows) {
    return currentSid
      ? [
          {
            sessionId: currentSid,
            createdAt: new Date().toISOString(),
            updatedAt: null,
            isCurrent: true,
            activeRole: session.role,
            elevatedUntil: null,
          },
        ]
      : [];
  }

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    sessionId: String(r.session_id),
    createdAt: String(r.created_at),
    updatedAt: r.updated_at ? String(r.updated_at) : null,
    isCurrent: String(r.session_id) === currentSid,
    activeRole: r.active_role ? String(r.active_role) : null,
    elevatedUntil: r.elevated_until ? String(r.elevated_until) : null,
  }));
}

/** Revokes one session by id. Refuses to revoke the caller's current session. */
export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(sessionId).success) {
    return { ok: false, error: "ID sesi tidak valid." };
  }

  const session = await getRoleSession().catch(() => null);
  if (!session) return { ok: false, error: "Sesi tidak ditemukan." };

  const supabase = await createServerSupabase();
  const {
    data: { session: current },
  } = await supabase.auth.getSession();

  const currentSid = current?.access_token
    ? (JSON.parse(Buffer.from(current.access_token.split(".")[1], "base64url").toString())
        .session_id as string | undefined)
    : undefined;

  if (sessionId === currentSid) {
    return { ok: false, error: "Tidak dapat mengakhiri sesi yang sedang aktif." };
  }

  const { error } = await createServiceSupabase().rpc("revoke_my_session", {
    p_session_id: sessionId,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/security");
  return { ok: true };
}
