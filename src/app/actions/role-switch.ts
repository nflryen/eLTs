"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getRoleSession } from "@/lib/auth/roles";
import { ROLE_LABEL, ROLE_RANK, type RoleKey } from "@/lib/auth/role-meta";

/*
 * ROLE SWITCHING — SECURITY MODEL
 * -------------------------------
 * The browser can ASK to switch. It cannot DECIDE the outcome.
 *
 *   1. The target role is validated against `role_assignments` for
 *      `auth.uid()` inside `public.set_active_role()`, so switching to a role
 *      you do not hold is rejected in the database, not in this file.
 *   2. An escalation requires a challenge token. The token can only be minted
 *      by `public.mint_role_challenge_token()`, which is granted to
 *      service_role ONLY — a browser cannot execute it.
 *   3. This action mints that token ONLY after `signInWithPassword()` has
 *      succeeded for the caller's own account. That is the password challenge.
 *   4. `set_active_role()` consumes the token atomically, so it cannot be
 *      replayed, and enforces a 30-minute elevation TTL.
 *
 * The client never sees a rank, never computes one, and never supplies one.
 */

export type SwitchRoleResult =
  | {
      ok: true;
      role: string;
      rank: number;
      elevatedUntil: string | null;
    }
  | { ok: false; error: string; requiresChallenge?: boolean };

const switchSchema = z.object({
  targetRole: z.string().min(1).max(32),
  /** Present only when the user submitted the password challenge modal. */
  password: z.string().min(1).max(200).optional(),
});

/**
 * Returns the caller's active role context for the UI shell.
 *
 * Resolved from the database on every call — never from a cookie or a prop.
 */
export async function getRoleContextAction(): Promise<{
  role: RoleKey | null;
  rank: number;
  elevatedUntil: string | null;
  ownedRoles: RoleKey[];
} | null> {
  const session = await getRoleSession().catch(() => null);
  if (!session) return null;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("get_my_role_context");

  if (error) {
    // Fall back to the session's own resolution rather than guessing.
    return {
      role: session.role,
      rank: session.rank,
      elevatedUntil: null,
      ownedRoles: session.role ? [session.role] : [],
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        role_key: string | null;
        role_rank: number | null;
        elevated_until: string | null;
        owned_roles: string[] | null;
      }
    | undefined;

  return {
    role: (row?.role_key ?? session.role) as RoleKey | null,
    rank: Number(row?.role_rank ?? session.rank),
    elevatedUntil: row?.elevated_until ?? null,
    ownedRoles: (row?.owned_roles ?? []) as RoleKey[],
  };
}

/**
 * Switches the active role for the current session.
 *
 * Downgrade / lateral move: applied immediately, no password.
 * Escalation: `password` is REQUIRED and verified before a token is minted.
 */
export async function switchActiveRole(input: {
  targetRole: string;
  password?: string;
}): Promise<SwitchRoleResult> {
  const parsed = switchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Permintaan tidak valid." };
  }

  const { targetRole, password } = parsed.data;

  const session = await getRoleSession().catch(() => null);
  if (!session) {
    return { ok: false, error: "Sesi tidak ditemukan. Silakan masuk kembali." };
  }

  const targetRank = ROLE_RANK[targetRole as RoleKey];
  if (targetRank === undefined) {
    return { ok: false, error: "Peran tidak dikenal." };
  }

  const supabase = await createServerSupabase();
  const service = createServiceSupabase();

  /*
   * Read the caller's CURRENT context to decide whether this is an escalation.
   * The decision is made here only to choose whether to demand a password; the
   * database re-derives it independently and refuses an unchallenged
   * escalation regardless of what this code concludes.
   */
  const { data: ctxData } = await supabase.rpc("get_my_role_context");
  const ctx = (Array.isArray(ctxData) ? ctxData[0] : ctxData) as
    | { role_key: string | null; role_rank: number | null; owned_roles: string[] | null }
    | undefined;

  const currentRank = Number(ctx?.role_rank ?? session.rank ?? 0);
  const owned = (ctx?.owned_roles ?? []) as string[];

  if (!owned.includes(targetRole)) {
    return { ok: false, error: "Anda tidak memiliki peran tersebut." };
  }

  const isEscalation = targetRank > currentRank;

  let challengeToken: string | null = null;

  if (isEscalation) {
    if (!password) {
      return {
        ok: false,
        error: "Kata sandi diperlukan untuk menaikkan hak akses.",
        requiresChallenge: true,
      };
    }

    /*
     * Verify the password against the CALLER'S OWN account. This is the step-up
     * authentication. `signInWithPassword` re-issues a session for the same
     * user; the session_id is preserved by GoTrue for the existing session.
     */
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: session.user.email ?? "",
      password,
    });

    if (authError) {
      await service.from("role_switch_audit").insert({
        user_id: session.user.id,
        session_id: await currentSessionId(),
        from_role: ctx?.role_key ?? null,
        to_role: targetRole,
        actor_rank: currentRank,
        event: "CHALLENGE_FAILED",
        detail: { reason: "invalid_password" },
      });
      return { ok: false, error: "Kata sandi salah." };
    }

    /*
     * Mint the single-use token. service_role only — unreachable from a browser.
     * Bound to the caller's session and target role.
     */
    const sessionId = await currentSessionId();
    if (!sessionId) {
      return { ok: false, error: "Sesi tidak valid. Silakan masuk kembali." };
    }

    const { data: token, error: mintError } = await service.rpc(
      "mint_role_challenge_token",
      {
        p_user_id: session.user.id,
        p_session_id: sessionId,
        p_target_role: targetRole,
      },
    );

    if (mintError || !token) {
      console.error("challenge_mint_failed", { code: mintError?.code });
      return { ok: false, error: "Gagal membuat token verifikasi." };
    }

    challengeToken = token as string;
  }

  const { data, error } = await supabase.rpc("set_active_role", {
    p_role_name: targetRole,
    p_challenge_token: challengeToken,
  });

  if (error) {
    const message = /challenge required/i.test(error.message)
      ? "Kata sandi diperlukan untuk menaikkan hak akses."
      : error.message;
    return { ok: false, error: message };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { active_role: string; active_rank: number; elevated_until: string | null }
    | undefined;

  revalidatePath("/admin");
  revalidatePath("/settings");

  return {
    ok: true,
    role: row?.active_role ?? targetRole,
    rank: Number(row?.active_rank ?? targetRank),
    elevatedUntil: row?.elevated_until ?? null,
  };
}

/**
 * Reads the current Supabase session id from the JWT.
 *
 * `session_id` is a standard GoTrue claim, so no custom token minting is
 * required. Reading it through `getSession()` is safe here because the value is
 * only used to bind a challenge token — `getUser()` has already been called by
 * `getRoleSession()` for the authorization decision.
 */
async function currentSessionId(): Promise<string | null> {
  const supabase = await createServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token
    ? (JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString())
        .session_id ?? null)
    : null;
}

/** Human labels for the switcher UI. */
export async function getSwitchableRolesAction(): Promise<
  Array<{ key: RoleKey; label: string; rank: number; isActive: boolean }>
> {
  const ctx = await getRoleContextAction();
  if (!ctx) return [];

  return ctx.ownedRoles
    .filter((r): r is RoleKey => r in ROLE_RANK)
    .map((key) => ({
      key,
      label: ROLE_LABEL[key] ?? key,
      rank: ROLE_RANK[key],
      isActive: key === ctx.role,
    }))
    .sort((a, b) => b.rank - a.rank);
}
