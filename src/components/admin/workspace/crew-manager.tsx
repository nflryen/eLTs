"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Plus, UserMinus, UserPen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  assignCrewToProjectAction,
  getAssignableCrew,
  revokeCrewAssignmentAction,
  updateCrewAssignmentAction,
} from "@/app/actions/project-lifecycle";
import type { CrewOption } from "@/lib/projects/lifecycle";
import { idr } from "@/lib/format";

/**
 * Crew assignment surface.
 *
 * The audit found the Crew tab rendered guidance text with ZERO controls: an
 * operator could not staff a shoot at all. This replaces it with the three
 * operations the job actually needs — assign, edit role/fee, and cancel.
 *
 * Cancelling REVOKES (sets `revoked_at`) rather than deleting. The row is the
 * record of who was booked, at what fee, and what they accepted or declined;
 * deleting it erases the fee history and the reason a slot was reopened.
 */

type Toast = { kind: "success" | "error"; text: string };

type CrewRow = {
  id: string;
  crew_member_id: string;
  crew_name: string;
  role_title: string;
  fee_agreed: number;
  acceptance_status: string;
  payment_status: string;
  call_time: string | null;
};

export function CrewManager({
  projectId,
  crew,
  shootDate,
}: {
  projectId: string;
  crew: CrewRow[];
  shootDate: string | null;
}) {
  const router = useRouter();
  const [toast, setToast] = useState<Toast | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [options, setOptions] = useState<CrewOption[] | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CrewRow | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<CrewRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const notify = (kind: Toast["kind"], text: string) => setToast({ kind, text });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.kind === "error" ? 9000 : 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    setOptionsError(null);
    if (options) return;
    const res = await getAssignableCrew(projectId);
    if (res.ok && res.crew) setOptions(res.crew);
    else setOptionsError(res.error ?? "Gagal memuat daftar kru.");
  }, [projectId, options]);

  const onAssign = useCallback(
    async (crewMemberId: string, roleTitle: string, fee: number, callTime: string) => {
      setBusy(true);
      const res = await assignCrewToProjectAction({
        projectId,
        crewMemberId,
        roleTitle,
        feeAgreed: fee,
        callTime,
      });
      setBusy(false);
      if (!res.ok) {
        notify("error", res.error ?? "Gagal menugaskan kru.");
        return;
      }
      setPickerOpen(false);
      setOptions(null);
      notify("success", "Kru berhasil ditugaskan.");
      startTransition(() => router.refresh());
    },
    [projectId, router]
  );

  const onSaveEdit = useCallback(
    async (assignmentId: string, roleTitle: string, fee: number) => {
      setBusy(true);
      const res = await updateCrewAssignmentAction({ assignmentId, projectId, roleTitle, feeAgreed: fee });
      setBusy(false);
      if (!res.ok) {
        notify("error", res.error ?? "Gagal menyimpan perubahan.");
        return;
      }
      setEditing(null);
      notify("success", "Peran dan honor diperbarui.");
      startTransition(() => router.refresh());
    },
    [projectId, router]
  );

  const onRevoke = useCallback(
    async (assignmentId: string) => {
      setBusy(true);
      const res = await revokeCrewAssignmentAction(assignmentId, projectId);
      setBusy(false);
      if (!res.ok) {
        notify("error", res.error ?? "Gagal membatalkan penugasan.");
        return;
      }
      setConfirmRevoke(null);
      notify("success", "Penugasan dibatalkan (riwayat tetap tersimpan).");
      startTransition(() => router.refresh());
    },
    [projectId, router]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[#71717a]">
          {crew.length} kru ditugaskan · {crew.filter((c) => c.acceptance_status === "ACCEPTED").length} terkonfirmasi
        </p>
        <button
          type="button"
          onClick={openPicker}
          className="inline-flex min-h-11 items-center gap-2 rounded-[14px] bg-[#09090b] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#27272a]"
        >
          <Plus size={15} aria-hidden="true" /> Tugaskan Kru
        </button>
      </div>

      {toast ? (
        <div
          role={toast.kind === "error" ? "alert" : "status"}
          aria-live={toast.kind === "error" ? "assertive" : "polite"}
          className={`rounded-[12px] border px-3 py-2 text-xs ${
            toast.kind === "error"
              ? "border-[#fca5a5] bg-[#fef2f2] text-[#991b1b]"
              : "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]"
          }`}
        >
          {toast.text}
        </div>
      ) : null}

      {crew.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-[#d4d4d8] p-6 text-center">
          <p className="text-sm font-semibold text-[#18181b]">Belum ada kru ditugaskan</p>
          <p className="mt-1 text-xs text-[#71717a]">
            Tugaskan Technical Director dan operator kamera terlebih dahulu.
          </p>
          <button
            type="button"
            onClick={openPicker}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[14px] border border-[#ececee] px-4 text-sm font-semibold text-[#18181b] hover:bg-[#fafafa]"
          >
            <Plus size={15} aria-hidden="true" /> Tugaskan Kru Pertama
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-[#f4f4f5]">
          {crew.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#09090b]">{c.crew_name}</p>
                <p className="truncate text-[11px] text-[#71717a]">{c.role_title}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[0.12em] text-[#a1a1aa]">Honor</p>
                <p className="font-mono text-sm text-[#09090b]">{idr(c.fee_agreed)}</p>
              </div>
              <span className="rounded-full border border-[#ececee] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#52525b]">
                {c.acceptance_status.replace("_", " ").toLowerCase()}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditing(c)}
                  aria-label={`Ubah peran dan honor ${c.crew_name}`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] text-[#52525b] hover:bg-[#fafafa]"
                >
                  <UserPen size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRevoke(c)}
                  aria-label={`Batalkan penugasan ${c.crew_name}`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] text-[#b91c1c] hover:bg-[#fef2f2]"
                >
                  <UserMinus size={15} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── Assign picker ─────────────────────────────────────────────── */}
      <AssignPicker
        open={pickerOpen}
        options={options}
        error={optionsError}
        busy={busy}
        shootDate={shootDate}
        onClose={() => setPickerOpen(false)}
        onAssign={onAssign}
      />

      {/* ── Edit role / fee ───────────────────────────────────────────── */}
      {editing ? (
        <EditAssignmentDialog
          row={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={onSaveEdit}
        />
      ) : null}

      {/* ── Revoke confirmation ───────────────────────────────────────── */}
      <Dialog open={confirmRevoke !== null} onOpenChange={(o) => { if (!o) setConfirmRevoke(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Batalkan penugasan?</DialogTitle>
            <DialogDescription>
              {confirmRevoke?.crew_name} akan dikeluarkan dari penugasan aktif. Riwayat dan honor
              tetap tersimpan untuk audit.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmRevoke(null)} disabled={busy}>
              Kembali
            </Button>
            <Button
              size="sm"
              onClick={() => confirmRevoke && onRevoke(confirmRevoke.id)}
              disabled={busy}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : null} Batalkan Penugasan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AssignPicker({
  open,
  options,
  error,
  busy,
  shootDate,
  onClose,
  onAssign,
}: {
  open: boolean;
  options: CrewOption[] | null;
  error: string | null;
  busy: boolean;
  shootDate: string | null;
  onClose: () => void;
  onAssign: (crewMemberId: string, roleTitle: string, fee: number, callTime: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [fee, setFee] = useState("0");
  const [callTime, setCallTime] = useState(shootDate ? `${shootDate.slice(0, 10)}T07:30` : "");

  const chosen = options?.find((o) => o.id === selected) ?? null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tugaskan Kru</DialogTitle>
          <DialogDescription>Pilih kru, lalu tentukan peran dan honor untuk proyek ini.</DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="rounded-[12px] border border-[#fca5a5] bg-[#fef2f2] px-3 py-2 text-xs text-[#991b1b]">
            {error}
          </p>
        ) : options === null ? (
          <p className="flex items-center gap-2 text-sm text-[#71717a]">
            <Loader2 size={14} className="animate-spin" /> Memuat daftar kru…
          </p>
        ) : (
          <div className="space-y-3">
            <div className="max-h-56 overflow-y-auto rounded-[12px] border border-[#ececee]">
              {options.map((o) => {
                const taken = o.assignedToThisProject;
                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={taken}
                    onClick={() => {
                      setSelected(o.id);
                      setFee(String(o.standard_day_rate || 0));
                      if (!role) setRole(o.member_type === "CORE_TEAM" ? "Crew" : "Freelance Crew");
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                      taken ? "cursor-not-allowed opacity-50" : "hover:bg-[#fafafa]"
                    } ${selected === o.id ? "bg-[#f4f4f5]" : ""}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[#18181b]">{o.full_name}</span>
                      <span className="block font-mono text-[10px] text-[#a1a1aa]">{o.crew_code}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-[10px]">
                      {taken ? (
                        <span className="text-[#71717a]">Sudah ditugaskan</span>
                      ) : o.busySameDay ? (
                        <span className="flex items-center gap-1 text-[#c2410c]">
                          <AlertTriangle size={11} /> Bentrok jadwal
                        </span>
                      ) : null}
                      <span className="font-mono text-[#52525b]">{idr(o.standard_day_rate)}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-[#52525b]">
                Peran
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="mis. Camera Operator"
                  className="mt-1 min-h-11 w-full rounded-[10px] border border-[#ececee] px-3 text-sm text-[#18181b]"
                />
              </label>
              <label className="text-xs font-medium text-[#52525b]">
                Honor (Rp)
                <input
                  type="number"
                  min={0}
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-[10px] border border-[#ececee] px-3 text-sm text-[#18181b]"
                />
              </label>
              <label className="text-xs font-medium text-[#52525b] sm:col-span-2">
                Call time
                <input
                  type="datetime-local"
                  value={callTime}
                  onChange={(e) => setCallTime(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-[10px] border border-[#ececee] px-3 text-sm text-[#18181b]"
                />
              </label>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button
            size="sm"
            disabled={!chosen || busy || !role.trim() || !callTime}
            onClick={() => chosen && onAssign(chosen.id, role.trim(), Math.max(0, Number(fee) || 0), callTime)}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} Tugaskan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAssignmentDialog({
  row,
  busy,
  onClose,
  onSave,
}: {
  row: CrewRow;
  busy: boolean;
  onClose: () => void;
  onSave: (assignmentId: string, roleTitle: string, fee: number) => Promise<void>;
}) {
  const [role, setRole] = useState(row.role_title);
  const [fee, setFee] = useState(String(row.fee_agreed));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ubah Peran / Honor</DialogTitle>
          <DialogDescription>{row.crew_name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-[#52525b]">
            Peran
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-[10px] border border-[#ececee] px-3 text-sm text-[#18181b]"
            />
          </label>
          <label className="block text-xs font-medium text-[#52525b]">
            Honor (Rp)
            <input
              type="number"
              min={0}
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-[10px] border border-[#ececee] px-3 text-sm text-[#18181b]"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button
            size="sm"
            disabled={busy || role.trim().length < 2}
            onClick={() => onSave(row.id, role.trim(), Math.max(0, Number(fee) || 0))}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
