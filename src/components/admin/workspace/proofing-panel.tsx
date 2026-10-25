"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Unlock,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Save,
  Loader2,
  Calendar,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";
import { Card, CardHeader, CardInner, Badge } from "@/components/ui/glass";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { jakartaShortDate } from "@/lib/datetime";
import {
  updateProjectProofingConfigAction,
  unlockProjectSelectionAction,
} from "@/app/actions/admin-projects";
import type { WorkspacePayload } from "@/lib/workspace";

interface ProofingPanelProps {
  data: WorkspacePayload;
}

export function ProofingPanel({ data }: ProofingPanelProps) {
  const router = useRouter();
  const project = data.project;
  const isLocked = Boolean(project.selection_locked_at);

  // Form State
  const [quotaMin, setQuotaMin] = useState<number>(project.selection_quota_min ?? 15);
  const [quotaMax, setQuotaMax] = useState<number>(project.selection_quota_max ?? 20);
  const [deadlineInput, setDeadlineInput] = useState<string>(() => {
    if (!project.selection_deadline) return "";
    const d = new Date(project.selection_deadline);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
  });

  // Action Transitions & Status
  const [isSaving, startSaveTransition] = useTransition();
  const [saveFeedback, setSaveFeedback] = useState<{ type: "ok" | "err"; message: string } | null>(null);

  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [isUnlocking, startUnlockTransition] = useTransition();
  const [unlockFeedback, setUnlockFeedback] = useState<{ type: "ok" | "err"; message: string } | null>(null);

  // Quick Copy Feedback
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedMagicLink, setCopiedMagicLink] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://elts.id";
  const magicLink = project.access_token
    ? `${origin}/proofing/${project.access_token}`
    : `${origin}/gallery/${project.slug}`;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(project.gallery_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Fallback
    }
  };

  const copyMagicLink = async () => {
    try {
      await navigator.clipboard.writeText(magicLink);
      setCopiedMagicLink(true);
      setTimeout(() => setCopiedMagicLink(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveFeedback(null);

    const min = Math.max(1, Number(quotaMin) || 1);
    const max = Math.max(min, Number(quotaMax) || min);

    let parsedDeadline: string | null = null;
    if (deadlineInput.trim()) {
      const d = new Date(deadlineInput);
      if (!Number.isNaN(d.getTime())) {
        parsedDeadline = d.toISOString();
      }
    }

    startSaveTransition(async () => {
      const res = await updateProjectProofingConfigAction(project.id, {
        selection_quota_min: min,
        selection_quota_max: max,
        selection_deadline: parsedDeadline,
      });

      if (res.success) {
        setSaveFeedback({ type: "ok", message: "Konfigurasi kuota dan batas waktu berhasil disimpan." });
        router.refresh();
        setTimeout(() => setSaveFeedback(null), 3000);
      } else {
        setSaveFeedback({ type: "err", message: res.error || "Gagal menyimpan konfigurasi." });
      }
    });
  };

  const handleUnlock = () => {
    setUnlockFeedback(null);
    startUnlockTransition(async () => {
      const res = await unlockProjectSelectionAction(project.id);
      if (res.success) {
        setUnlockModalOpen(false);
        router.refresh();
      } else {
        setUnlockFeedback({ type: "err", message: res.error || "Gagal membuka kunci pilihan." });
      }
    });
  };

  const progressPct =
    project.selection_quota_max > 0
      ? Math.min(100, Math.round((data.favoriteCount / project.selection_quota_max) * 100))
      : 0;

  return (
    <div className="space-y-6">
      {/* ── 1. Status Overview Card ─────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Status Proofing & Seleksi Klien"
          description="Pantau kuota pemilihan foto, status kunci galeri, dan tautan akses mandiri klien"
          action={
            <Badge variant={isLocked ? "outline" : "ember"} className={isLocked ? "border-emerald-300 bg-emerald-50 text-emerald-800" : undefined}>
              {isLocked ? "Pilihan Terkunci" : "Menunggu Seleksi Klien"}
            </Badge>
          }
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Kode Galeri (PIN)</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="font-mono text-sm font-bold text-[#09090b]">
                {project.gallery_code}
              </span>
              <button
                type="button"
                onClick={copyCode}
                title="Salin Kode Galeri"
                className="rounded p-1 text-[#71717a] hover:bg-[#ececee] hover:text-[#09090b] transition-colors cursor-pointer"
              >
                {copiedCode ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
              </button>
            </div>
          </CardInner>

          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Kemajuan Seleksi</p>
            <p className="mt-1 font-mono text-sm font-bold text-[#09090b]">
              {data.favoriteCount} <span className="text-xs text-[#a1a1aa] font-normal">/ {project.selection_quota_max} foto</span>
            </p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-[#f4f4f5] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  data.favoriteCount >= project.selection_quota_min ? "bg-emerald-600" : "bg-[#ff5a00]"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </CardInner>

          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Target Kuota Paket</p>
            <p className="mt-1 font-mono text-sm font-bold text-[#09090b]">
              {project.selection_quota_min}–{project.selection_quota_max} <span className="text-xs font-normal text-[#71717a]">Foto</span>
            </p>
          </CardInner>

          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Magic Link Proofing</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="truncate text-xs font-mono text-[#71717a] max-w-[130px]">
                /proofing/...
              </span>
              <button
                type="button"
                onClick={copyMagicLink}
                title="Salin Magic Link Tanpa PIN"
                className="rounded p-1 text-[#71717a] hover:bg-[#ececee] hover:text-[#09090b] transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
              >
                {copiedMagicLink ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                <span>{copiedMagicLink ? "Disalin" : "Salin Link"}</span>
              </button>
            </div>
          </CardInner>
        </div>

        {/* Status Callout Banner */}
        <div
          className={`mt-4 rounded-xl border p-3.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            isLocked
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-[#ececee] bg-[#fafafa] text-[#52525b]"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {isLocked ? (
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            ) : (
              <Clock size={16} className="text-[#a1a1aa] shrink-0" />
            )}
            <div>
              <p className="font-semibold text-[#09090b]">
                {isLocked
                  ? `Pilihan foto telah dikunci pada ${jakartaShortDate(project.selection_locked_at!)}`
                  : "Galeri proofing saat ini terbuka untuk pemilihan mandiri oleh klien."}
              </p>
              <p className="text-[11px] text-[#71717a] mt-0.5">
                {isLocked
                  ? "Tugas editing telah dibuat di antrean post-produksi. Untuk memberi kesempatan klien mengubah pilihan, klik Buka Kunci Pilihan."
                  : "Klien dapat menandai foto favorit hingga batas maksimal tercapai."}
              </p>
            </div>
          </div>

          {isLocked && (
            <button
              type="button"
              onClick={() => setUnlockModalOpen(true)}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-50 transition-colors shadow-xs shrink-0 cursor-pointer"
            >
              <Unlock size={13} className="text-amber-700" />
              <span>Buka Kunci Pilihan</span>
            </button>
          )}
        </div>
      </Card>

      {/* ── 2. Quota & Deadline Configuration Card ─────────────────────── */}
      <Card>
        <CardHeader
          title="Konfigurasi Kuota & Batas Waktu (Countdown)"
          description="Atur batasan jumlah foto yang dapat dipilih dan waktu hitung mundur bagi klien"
        />

        <form onSubmit={handleSaveConfig} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#3f3f46]">
                Kuota Minimal Foto <span className="text-[#ff5a00]">*</span>
              </label>
              <input
                type="number"
                min={1}
                required
                value={quotaMin}
                onChange={(e) => setQuotaMin(Number(e.target.value))}
                className="contact-input h-10 text-xs font-mono font-medium"
              />
              <span className="text-[10px] text-[#a1a1aa]">
                Jumlah foto paling sedikit sebelum klien dapat mengunci pilihan.
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#3f3f46]">
                Kuota Maksimal Foto <span className="text-[#ff5a00]">*</span>
              </label>
              <input
                type="number"
                min={quotaMin}
                required
                value={quotaMax}
                onChange={(e) => setQuotaMax(Number(e.target.value))}
                className="contact-input h-10 text-xs font-mono font-medium"
              />
              <span className="text-[10px] text-[#a1a1aa]">
                Batas atas foto yang masuk paket retouching (e.g. 20, 40 foto).
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#3f3f46] flex items-center gap-1.5">
                <Calendar size={13} />
                <span>Batas Waktu (Selection Deadline)</span>
              </label>
              <input
                type="datetime-local"
                value={deadlineInput}
                onChange={(e) => setDeadlineInput(e.target.value)}
                className="contact-input h-10 text-xs font-mono"
              />
              <span className="text-[10px] text-[#a1a1aa]">
                Menentukan countdown timer di header proofing klien. Kosongkan jika tanpa deadline.
              </span>
            </div>
          </div>

          {saveFeedback && (
            <div
              className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                saveFeedback.type === "ok"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              {saveFeedback.type === "ok" ? (
                <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle size={14} className="text-red-600 shrink-0" />
              )}
              <span>{saveFeedback.message}</span>
            </div>
          )}

          <div className="flex items-center justify-end pt-2 border-t border-[#ececee]">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#09090b] hover:bg-[#27272a] px-4 text-xs font-semibold text-white transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              <span>{isSaving ? "Menyimpan…" : "Simpan Perubahan Kuota & Deadline"}</span>
            </button>
          </div>
        </form>
      </Card>

      {/* ── 3. Post-Production Tasks & Gate ─────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Gate Pengiriman" description="Rantai alur menuju rilis unduhan hi-res master" />
          <ul className="mt-4 space-y-2.5">
            <li className="flex items-center gap-2.5 text-xs">
              {project.selection_locked_at ? (
                <CheckCircle2 size={14} className="text-[#09090b]" />
              ) : (
                <Clock size={14} className="text-[#a1a1aa]" />
              )}
              <span className="text-[#3f3f46]">Klien menyelesaikan pemilihan foto</span>
            </li>
            <li className="flex items-center gap-2.5 text-xs">
              {data.editorTask && ["IN_PROGRESS", "REVIEW", "COMPLETED"].includes(data.editorTask.status) ? (
                <CheckCircle2 size={14} className="text-[#09090b]" />
              ) : (
                <Clock size={14} className="text-[#a1a1aa]" />
              )}
              <span className="text-[#3f3f46]">Editor memproses retouching</span>
            </li>
            <li className="flex items-center gap-2.5 text-xs">
              {project.is_fully_paid ? (
                <CheckCircle2 size={14} className="text-[#09090b]" />
              ) : (
                <AlertTriangle size={14} className="text-[#ff5a00]" />
              )}
              <span className="text-[#3f3f46]">
                Pelunasan {project.is_fully_paid ? "terverifikasi (Lunas 100%)" : "belum diterima"}
              </span>
            </li>
            <li className="flex items-center gap-2.5 text-xs">
              <Badge variant={project.is_fully_paid ? "outline" : "ember"} className={project.is_fully_paid ? "text-[#09090b]" : undefined}>
                {project.is_fully_paid ? "Master & Hi-Res Terbuka" : "Master & Hi-Res Terkunci"}
              </Badge>
            </li>
          </ul>
        </Card>

        {data.editorTask ? (
          <Card>
            <CardHeader title="Tugas Post-Produksi" description="Dibuat otomatis saat seleksi klien dikunci" />
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <CardInner>
                <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Status</p>
                <p className="mt-1 text-xs font-bold text-[#09090b] uppercase">
                  {data.editorTask.status.replace(/_/g, " ")}
                </p>
              </CardInner>
              <CardInner>
                <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Deliverable</p>
                <p className="mt-1 font-mono text-sm font-bold text-[#09090b]">
                  {data.editorTask.deliverable_count} foto
                </p>
              </CardInner>
              <CardInner>
                <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Waktu Dikunci</p>
                <p className="mt-1 text-xs font-semibold text-[#09090b]">
                  {jakartaShortDate(data.editorTask.created_at)}
                </p>
              </CardInner>
            </div>
            <div className="mt-4">
              <Link
                href="/admin/editor-queue"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#ececee] bg-white px-3.5 text-xs font-semibold text-[#3f3f46] hover:bg-[#fafafa] transition-colors"
              >
                <span>Buka Antrean Editor</span>
                <ExternalLink size={12} />
              </Link>
            </div>
          </Card>
        ) : (
          <Card>
            <EmptyState
              icon={<ImageIcon size={20} />}
              title="Belum ada tugas editor"
              description="Tugas akan dibuat otomatis begitu klien mengunci pilihan foto di galeri proofing."
            />
          </Card>
        )}
      </div>

      {/* ── Unlock Confirmation Dialog ──────────────────────────────────── */}
      <Dialog open={unlockModalOpen} onOpenChange={setUnlockModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-amber-900 flex items-center gap-2">
              <Unlock size={18} className="text-amber-700" /> Buka Kunci Pilihan Foto?
            </DialogTitle>
            <DialogDescription>
              Membuka kunci akan mengizinkan klien untuk mengubah atau menambah foto di galeri proofing mereka kembali.
              Tugas editor pending terkait akan direset hingga klien mengunci ulang pilihannya.
            </DialogDescription>
          </DialogHeader>

          {unlockFeedback && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {unlockFeedback.message}
            </div>
          )}

          <DialogFooter className="mt-4 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUnlockModalOpen(false)}
              disabled={isUnlocking}
            >
              Batal
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={handleUnlock}
              disabled={isUnlocking}
              className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
            >
              {isUnlocking ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
              {isUnlocking ? "Membuka Kunci…" : "Ya, Buka Kunci Pilihan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
