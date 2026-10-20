"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut, ShieldAlert } from "lucide-react";
import {
  changePasswordAction,
  revokeSessionAction,
  type SessionRow,
} from "@/app/actions/profile";

export function SecurityForm({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [revoking, startRevoke] = useTransition();
  const [revokeErr, setRevokeErr] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setErr(null);

    if (newPassword !== confirmPassword) {
      setErr("Konfirmasi kata sandi tidak cocok.");
      return;
    }

    startSave(async () => {
      const res = await changePasswordAction({ currentPassword, newPassword });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg("Kata sandi diperbarui. Sesi lain telah diakhiri.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      router.refresh();
    });
  };

  const revoke = (sessionId: string) => {
    setRevokeErr(null);
    startRevoke(async () => {
      const res = await revokeSessionAction(sessionId);
      if (!res.ok) {
        setRevokeErr(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <>
      {/* ── Password change ───────────────────────────────────────────────── */}
      <form
        onSubmit={submit}
        className="space-y-4 rounded-xl border border-[#ececee] bg-white p-5"
      >
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-[#71717a]" />
          <h2 className="text-sm font-semibold text-[#18181b]">Ubah Kata Sandi</h2>
        </div>

        <div>
          <label
            htmlFor="currentPassword"
            className="mb-1 block text-xs font-medium text-[#3f3f46]"
          >
            Kata Sandi Saat Ini
          </label>
          <input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
          />
        </div>

        <div>
          <label htmlFor="newPassword" className="mb-1 block text-xs font-medium text-[#3f3f46]">
            Kata Sandi Baru
          </label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={10}
            className="w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
          />
          <p className="mt-1 text-[11px] text-[#a1a1aa]">Minimal 10 karakter.</p>
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="mb-1 block text-xs font-medium text-[#3f3f46]"
          >
            Konfirmasi Kata Sandi Baru
          </label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
          />
        </div>

        {err && <p className="text-xs text-red-600">{err}</p>}
        {msg && <p className="text-xs text-emerald-600">{msg}</p>}

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-[#18181b] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          {saving ? "Memperbarui…" : "Perbarui Kata Sandi"}
        </button>
      </form>

      {/* ── Sessions ──────────────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-xl border border-[#ececee] bg-white p-5">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-[#71717a]" />
          <h2 className="text-sm font-semibold text-[#18181b]">Sesi Aktif</h2>
        </div>
        <p className="text-xs text-[#71717a]">
          Sesi yang tidak dikenal dapat diakhiri. Sesi yang diakhiri juga menghapus konteks peran
          yang sedang aktif di perangkat tersebut.
        </p>

        {revokeErr && <p className="text-xs text-red-600">{revokeErr}</p>}

        <ul className="divide-y divide-[#f4f4f5]">
          {sessions.length === 0 && (
            <li className="py-3 text-xs text-[#a1a1aa]">Tidak ada sesi lain.</li>
          )}
          {sessions.map((s) => (
            <li key={s.sessionId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[#18181b]">
                  {s.isCurrent ? "Perangkat ini" : s.sessionId.slice(0, 8)}
                  {s.activeRole && (
                    <span className="ml-2 rounded bg-[#f4f4f5] px-1.5 py-0.5 text-[10px] text-[#71717a]">
                      {s.activeRole}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-[#a1a1aa]">
                  Mulai {new Date(s.createdAt).toLocaleString("id-ID")}
                </p>
              </div>

              {s.isCurrent ? (
                <span className="text-[10px] font-medium text-emerald-600">Aktif</span>
              ) : (
                <button
                  type="button"
                  onClick={() => revoke(s.sessionId)}
                  disabled={revoking}
                  className="flex items-center gap-1 rounded-lg border border-[#ececee] px-2 py-1 text-[11px] font-medium text-[#71717a] hover:bg-[#fafafa] disabled:opacity-50"
                >
                  <LogOut size={11} /> Akhiri
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
