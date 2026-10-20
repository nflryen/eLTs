"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Clock, Lock, ShieldCheck } from "lucide-react";
import { switchActiveRole } from "@/app/actions/role-switch";
import type { RoleKey } from "@/lib/auth/role-meta";

/**
 * Authority-bearing role switcher.
 *
 * This REPLACES the previous `RoleSwitcher`, which was a SUPER_ADMIN-only
 * presentation preview that wrote `?view_as=` to the URL. This component
 * performs a real, server-asserted context switch:
 *
 *   - Only roles the account HOLDS are listed (resolved server-side).
 *   - Switching DOWN applies immediately.
 *   - Switching UP opens the password challenge modal.
 *   - The server re-checks everything; this component's `isEscalation` is a
 *     UX hint for whether to show the modal, never an authorization decision.
 */

export type SwitchableRole = {
  key: RoleKey;
  label: string;
  rank: number;
  isActive: boolean;
};

type Props = {
  roles: SwitchableRole[];
  activeRole: RoleKey | null;
  activeRank: number;
  elevatedUntil: string | null;
};

const ELEVATED_ROLES = new Set<string>(["FOUNDER", "SUPER_ADMIN"]);

export function ActiveRoleSwitcher({ roles, activeRole, activeRank, elevatedUntil }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pendingRole, setPendingRole] = useState<SwitchableRole | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  const active = roles.find((r) => r.isActive) ?? null;

  /* Escape closes the menu; outside click closes it too. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const applySwitch = useCallback(
    (role: SwitchableRole, passwordValue?: string) => {
      setError(null);
      startTransition(async () => {
        const res = await switchActiveRole({
          targetRole: role.key,
          password: passwordValue,
        });

        if (!res.ok) {
          if (res.requiresChallenge) {
            setPendingRole(role);
            return;
          }
          setError(res.error);
          return;
        }

        setPendingRole(null);
        setPassword("");
        setOpen(false);
        router.refresh();
      });
    },
    [router],
  );

  const select = (role: SwitchableRole) => {
    if (role.isActive || isPending) return;

    /*
     * UX hint only. The server independently derives escalation and will
     * refuse an unchallenged upward move even if this check were removed.
     */
    const isEscalation = role.rank > activeRank;
    if (isEscalation) {
      setPendingRole(role);
      setPassword("");
      setError(null);
      return;
    }
    applySwitch(role);
  };

  const submitChallenge = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingRole || !password || isPending) return;
    applySwitch(pendingRole, password);
  };

  if (roles.length <= 1) {
    /* Single-role account: show the role, no switcher affordance. */
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#ececee] px-3 py-2">
        <ShieldCheck size={14} className="text-[#71717a]" />
        <span className="text-xs font-medium text-[#3f3f46]">{active?.label ?? "Tanpa peran"}</span>
      </div>
    );
  }

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-[#ececee] px-3 py-2 text-left hover:bg-[#fafafa]"
        >
          <span className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-[#71717a]" />
            <span className="text-xs font-medium text-[#3f3f46]">
              {active?.label ?? "Tanpa peran"}
            </span>
          </span>
          <ChevronDown size={14} className="text-[#a1a1aa]" />
        </button>

        {open && (
          <div
            role="listbox"
            className="absolute bottom-full left-0 z-50 mb-1 w-full overflow-hidden rounded-lg border border-[#ececee] bg-white shadow-lg"
          >
            {roles.map((role) => {
              const needsPassword = role.rank > activeRank;
              return (
                <button
                  key={role.key}
                  type="button"
                  role="option"
                  aria-selected={role.isActive}
                  onClick={() => select(role)}
                  disabled={isPending}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-[#fafafa] disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    {role.isActive ? (
                      <Check size={12} className="text-emerald-600" />
                    ) : needsPassword ? (
                      <Lock size={12} className="text-amber-600" />
                    ) : (
                      <span className="inline-block w-3" />
                    )}
                    <span className={role.isActive ? "font-semibold" : ""}>{role.label}</span>
                  </span>
                  <span className="text-[10px] text-[#a1a1aa]">{role.rank}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {elevatedUntil && ELEVATED_ROLES.has(activeRole ?? "") && (
        <ElevationCountdown until={elevatedUntil} />
      )}

      {pendingRole && (
        <PasswordChallengeModal
          role={pendingRole}
          password={password}
          setPassword={setPassword}
          error={error}
          isPending={isPending}
          onCancel={() => {
            setPendingRole(null);
            setPassword("");
            setError(null);
          }}
          onSubmit={submitChallenge}
        />
      )}
    </>
  );
}

/** Live countdown badge for an elevated context. */
function ElevationCountdown({ until }: { until: string }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, new Date(until).getTime() - Date.now()),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, new Date(until).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [until]);

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);

  if (remaining <= 0) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">
      <Clock size={11} />
      <span>
        Hak akses naik: {mins}:{String(secs).padStart(2, "0")}
      </span>
    </div>
  );
}

/** Sudo-mode password challenge. */
function PasswordChallengeModal({
  role,
  password,
  setPassword,
  error,
  isPending,
  onCancel,
  onSubmit,
}: {
  role: SwitchableRole;
  password: string;
  setPassword: (v: string) => void;
  error: string | null;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="challenge-title"
      >
        <div className="mb-1 flex items-center gap-2">
          <Lock size={16} className="text-amber-600" />
          <h2 id="challenge-title" className="text-sm font-semibold text-[#18181b]">
            Konfirmasi Kata Sandi
          </h2>
        </div>
        <p className="mb-4 text-xs text-[#71717a]">
          Beralih ke <strong>{role.label}</strong> menaikkan hak akses Anda. Masukkan kata sandi
          akun untuk melanjutkan. Konteks ini berlaku 30 menit.
        </p>

        <label htmlFor="sudo-password" className="mb-1 block text-xs font-medium text-[#3f3f46]">
          Kata Sandi
        </label>
        <input
          id="sudo-password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3 w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
        />

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-lg px-3 py-2 text-xs font-medium text-[#71717a] hover:bg-[#fafafa]"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={isPending || !password}
            className="rounded-lg bg-[#18181b] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {isPending ? "Memverifikasi…" : "Konfirmasi"}
          </button>
        </div>
      </form>
    </div>
  );
}
