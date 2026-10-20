"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, X } from "lucide-react";
import {
  grantRoleAction,
  revokeRoleAction,
  setDefaultRoleAction,
  type ManagedUser,
} from "@/app/actions/role-management";
import type { RoleKey } from "@/lib/auth/role-meta";

type AssignableRole = { key: RoleKey; label: string; rank: number };

type Props = {
  users: ManagedUser[];
  assignableRoles: ReadonlyArray<AssignableRole>;
  audit: Array<{
    id: number;
    action: string;
    roleKey: string;
    actorEmail: string | null;
    targetEmail: string | null;
    createdAt: string;
  }>;
};

const RANK_TONE: Record<number, string> = {
  120: "bg-purple-50 text-purple-700 border-purple-200",
  100: "bg-amber-50 text-amber-700 border-amber-200",
  80: "bg-blue-50 text-blue-700 border-blue-200",
  60: "bg-emerald-50 text-emerald-700 border-emerald-200",
  50: "bg-teal-50 text-teal-700 border-teal-200",
  30: "bg-[#f4f4f5] text-[#52525b] border-[#e4e4e7]",
};

export function RoleTierManager({ users, assignableRoles, audit }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<ManagedUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rankOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of assignableRoles) m.set(r.key, r.rank);
    return m;
  }, [assignableRoles]);

  const mutate = (fn: () => Promise<{ ok: boolean; error?: string; code?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Gagal memperbarui peran.");
        return;
      }
      router.refresh();
    });
  };

  const selectedFresh = selected
    ? (users.find((u) => u.userId === selected.userId) ?? selected)
    : null;

  return (
    <>
      {/* ── Master table ─────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-[#ececee] bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[#ececee] bg-[#fafafa] text-[11px] uppercase tracking-wide text-[#71717a]">
            <tr>
              <th className="px-4 py-3 font-medium">Nama / Email</th>
              <th className="px-4 py-3 font-medium">Peran</th>
              <th className="px-4 py-3 font-medium">Base</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f4f4f5]">
            {users.map((u) => (
              <tr key={u.userId} className="hover:bg-[#fafafa]">
                <td className="px-4 py-3">
                  <p className="font-medium text-[#18181b]">
                    {u.fullName ?? u.displayName ?? "(tanpa nama)"}
                  </p>
                  <p className="text-xs text-[#71717a]">{u.email}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.length === 0 && (
                      <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                        TANPA PERAN
                      </span>
                    )}
                    {u.roles.map((r) => (
                      <span
                        key={r}
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                          RANK_TONE[rankOf.get(r) ?? 0] ?? RANK_TONE[30]
                        }`}
                      >
                        {r} · {rankOf.get(r) ?? "?"}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs font-medium text-[#3f3f46]">
                    {u.baseRole ?? "—"}
                  </span>
                  <span className="ml-1 text-[10px] text-[#a1a1aa]">
                    {rankOf.get(u.baseRole ?? "") ?? ""}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span
                      className={`w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        u.maxRank >= 60
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-[#f4f4f5] text-[#71717a]"
                      }`}
                    >
                      {u.maxRank >= 60 ? "Aktif" : "Non-staf"}
                    </span>
                    <span className="text-[10px] text-[#a1a1aa]">
                      {u.emailConfirmed ? "Email terverifikasi" : "Email belum verifikasi"}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(u);
                      setError(null);
                    }}
                    className="rounded-lg border border-[#ececee] px-2.5 py-1.5 text-[11px] font-medium text-[#3f3f46] hover:bg-[#f4f4f5]"
                  >
                    Kelola Peran / Tier
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Audit trail ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#ececee] bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-[#18181b]">Riwayat Perubahan Peran</h2>
        {audit.length === 0 ? (
          <p className="text-xs text-[#a1a1aa]">Belum ada perubahan.</p>
        ) : (
          <ul className="divide-y divide-[#f4f4f5] text-xs">
            {audit.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-1.5">
                <span className="text-[#3f3f46]">
                  <strong>{a.action}</strong> {a.roleKey} · target {a.targetEmail}
                </span>
                <span className="text-[10px] text-[#a1a1aa]">
                  {new Date(a.createdAt).toLocaleString("id-ID")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Modal ────────────────────────────────────────────────────────── */}
      {selectedFresh && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-modal-title"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
          >
            <div className="mb-1 flex items-start justify-between">
              <div>
                <h2 id="role-modal-title" className="text-sm font-semibold text-[#18181b]">
                  Kelola Peran
                </h2>
                <p className="text-xs text-[#71717a]">{selectedFresh.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Tutup"
                className="rounded p-1 text-[#a1a1aa] hover:bg-[#f4f4f5]"
              >
                <X size={16} />
              </button>
            </div>

            <p className="mb-3 mt-2 text-[11px] text-[#a1a1aa]">
              Centang untuk menambah, hapus centang untuk mencabut. Bintang menandai peran
              dasar (base role).
            </p>

            {error && (
              <p className="mb-3 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                {error}
              </p>
            )}

            <ul className="space-y-1">
              {assignableRoles.map((role) => {
                const held = selectedFresh.roles.includes(role.key);
                const isBase = selectedFresh.baseRole === role.key;
                const isLastRole = held && selectedFresh.roles.length === 1;

                return (
                  <li
                    key={role.key}
                    className="flex items-center justify-between rounded-lg border border-[#f4f4f5] px-3 py-2"
                  >
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={held}
                        disabled={pending || isLastRole}
                        onChange={(e) =>
                          mutate(() =>
                            e.target.checked
                              ? grantRoleAction({
                                  targetUserId: selectedFresh.userId,
                                  roleKey: role.key,
                                })
                              : revokeRoleAction({
                                  targetUserId: selectedFresh.userId,
                                  roleKey: role.key,
                                }),
                          )
                        }
                        className="h-3.5 w-3.5"
                      />
                      <span className="text-xs font-medium text-[#3f3f46]">{role.label}</span>
                      <span className="text-[10px] text-[#a1a1aa]">{role.rank}</span>
                      {isLastRole && (
                        <span className="text-[10px] text-[#a1a1aa]">(peran terakhir)</span>
                      )}
                    </label>

                    {held && (
                      <button
                        type="button"
                        title="Jadikan peran dasar"
                        disabled={pending || isBase}
                        onClick={() =>
                          mutate(() =>
                            setDefaultRoleAction({
                              targetUserId: selectedFresh.userId,
                              roleKey: role.key,
                            }),
                          )
                        }
                        className={`rounded p-1 ${
                          isBase
                            ? "text-amber-500"
                            : "text-[#d4d4d8] hover:text-amber-500 disabled:opacity-40"
                        }`}
                      >
                        <Star size={13} fill={isBase ? "currentColor" : "none"} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg bg-[#18181b] px-3 py-2 text-xs font-medium text-white"
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
