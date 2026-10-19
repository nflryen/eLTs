"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
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
  getProjectActionContext,
  logReminderDispatch,
  previewReminder,
  type ProjectActionContext,
  type ReminderPreview,
} from "@/app/actions/project-dispatch";
import { changeProjectStatus } from "@/app/actions/project-lifecycle";
import { STATUS_LABEL, legalNextStatuses, type ProjectStatus } from "@/lib/projects/lifecycle";
import type { ReminderKind } from "@/lib/reminders/compose";

/**
 * Project context bar.
 *
 * Everything an operator does from the project header: move the project along
 * its lifecycle, contact the client, hand over the invoice, and download the
 * PDF. Each control reports its own outcome — a failure is never silent.
 *
 * The reminder modal shows the EXACT text that will be sent, flags any field the
 * database is missing, and only enables dispatch when nothing is missing. The
 * audit row is written after the operator actually opens WhatsApp, so the log
 * reflects dispatches rather than previews.
 */

const FIELD_LABELS: Record<string, string> = {
  client_phone: "Nomor WhatsApp klien",
  shoot_date: "Tanggal pengambilan",
  call_time: "Waktu call time",
  venue_name: "Nama lokasi",
  venue_address: "Alamat lokasi",
  venue_maps_url: "Tautan peta lokasi",
  gallery_url: "Tautan galeri",
  selection_deadline: "Batas pemilihan foto",
  invoice_number: "Nomor invoice",
  amount_due: "Jumlah tagihan",
  payment_methods: "Rekening pembayaran studio",
};

function missingLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

type Toast = { kind: "success" | "error"; text: string };

/** Auto-dismissing toast. `role="status"` for success, `alert` for failure. */
function ToastBar({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.kind === "error" ? 9000 : 4000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
      className={`mt-2 flex items-start gap-2 rounded-[12px] border px-3 py-2 text-xs ${
        toast.kind === "error"
          ? "border-[#fca5a5] bg-[#fef2f2] text-[#991b1b]"
          : "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]"
      }`}
    >
      {toast.kind === "success" ? <Check size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : null}
      <span className="flex-1">{toast.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Tutup pemberitahuan"
        className="shrink-0 text-current opacity-60 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

export function ProjectActionBar({
  projectId,
  initialStatus,
}: {
  projectId: string;
  /** Status as rendered by the server, so the dropdown starts from the truth. */
  initialStatus: ProjectStatus;
}) {
  const router = useRouter();
  const [ctx, setCtx] = useState<ProjectActionContext | null>(null);
  const [ctxFailed, setCtxFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [status, setStatus] = useState<ProjectStatus>(initialStatus);
  const [pending, startTransition] = useTransition();
  const [statusPending, setStatusPending] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    let cancelled = false;
    getProjectActionContext(projectId)
      .then((data) => {
        if (cancelled) return;
        if (data) setCtx(data);
        else setCtxFailed(true);
      })
      .catch(() => {
        if (!cancelled) setCtxFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Close either popover on outside click and on Escape.
  useEffect(() => {
    if (!menuOpen && !statusOpen) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target)) setMenuOpen(false);
      if (!statusRef.current?.contains(target)) setStatusOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setStatusOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, statusOpen]);

  const openReminder = useCallback(
    (kind: ReminderKind) => {
      setMenuOpen(false);
      setToast(null);
      startTransition(async () => {
        const result = await previewReminder(projectId, kind);
        if (result.ok) setPreview(result.preview);
        else setToast({ kind: "error", text: result.error });
      });
    },
    [projectId]
  );

  /*
   * "Kirim Tagihan" opens the payment reminder — previously it was an anchor to
   * #module-invoice that did nothing.
   *
   * Routing matters: a fully-paid invoice must never produce "please pay Rp0".
   * With nothing outstanding the button is disabled with an explanatory title,
   * so the operator is not led into composing a meaningless message.
   */
  const outstanding = ctx?.amountDue ?? null;
  const isFullyPaid = outstanding !== null && outstanding <= 0;

  const openInvoiceReminder = useCallback(() => {
    const kind: ReminderKind = ctx?.suggested.includes("GALLERY_READY") ? "PAYMENT_FINAL" : "PAYMENT_DP";
    openReminder(kind);
  }, [ctx, openReminder]);

  const dispatch = useCallback(() => {
    if (!preview?.waUrl) return;
    // Open synchronously inside the click handler so the popup blocker allows it.
    window.open(preview.waUrl, "_blank", "noopener,noreferrer");
    const sent = preview.message;
    const kind = preview.kind;
    setPreview(null);
    startTransition(async () => {
      const logged = await logReminderDispatch(projectId, kind, sent);
      if (!logged.ok) setToast({ kind: "error", text: logged.error ?? "Gagal mencatat pengiriman." });
      else {
        setToast({ kind: "success", text: "Pengingat dicatat dan WhatsApp dibuka." });
        router.refresh();
      }
    });
  }, [preview, projectId, router]);

  const applyStatus = useCallback(
    async (next: ProjectStatus) => {
      if (next === status) return;
      const previous = status;
      setStatusOpen(false);
      setStatusPending(true);
      // Optimistic: show the new state immediately, reconcile on failure.
      setStatus(next);
      const result = await changeProjectStatus(projectId, previous, next);
      setStatusPending(false);
      if (result.ok) {
        setToast({ kind: "success", text: `Status diubah ke ${STATUS_LABEL[result.to]}.` });
        router.refresh();
      } else {
        setStatus(previous);
        setToast({ kind: "error", text: result.error });
      }
    },
    [projectId, status, router]
  );

  const suggested = ctx?.suggested ?? [];
  const latestPdf = ctx?.invoices.find((inv) => inv.pdfUrl) ?? null;
  const reminderItems = (ctx?.available ?? []).filter((item) => suggested.includes(item.kind));
  const otherItems = (ctx?.available ?? []).filter((item) => !suggested.includes(item.kind));
  const nextStatuses = legalNextStatuses(status);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" aria-label="Tindakan proyek">
        {/* ── Status ─────────────────────────────────────────────────────── */}
        <div className="relative" ref={statusRef}>
          <button
            type="button"
            onClick={() => setStatusOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={statusOpen}
            disabled={statusPending || nextStatuses.length === 0}
            title={
              nextStatuses.length === 0
                ? `Status ${STATUS_LABEL[status]} tidak memiliki transisi lanjutan`
                : undefined
            }
            className="inline-flex min-h-11 items-center gap-2 rounded-[10000px] border border-[#ececee] bg-white px-4 text-sm font-semibold text-[#18181b] transition-colors hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {statusPending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
            <span className="text-[#71717a]">Status:</span>
            {STATUS_LABEL[status]}
            <span aria-hidden="true" className="text-[#a1a1aa]">▾</span>
          </button>

          {statusOpen ? (
            <div
              role="menu"
              aria-label="Ubah status proyek"
              className="absolute left-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-[18px] border border-[#ececee] bg-white py-2 shadow-[0_16px_40px_-24px_rgba(9,9,11,0.35)]"
            >
              <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a1a1aa]">
                Ubah ke
              </p>
              {nextStatuses.map((next) => (
                <button
                  key={next}
                  type="button"
                  role="menuitem"
                  onClick={() => applyStatus(next)}
                  className="block min-h-11 w-full px-4 text-left text-sm text-[#18181b] hover:bg-[#f4f4f5]"
                >
                  {STATUS_LABEL[next]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* ── Client contact ─────────────────────────────────────────────── */}
        {ctx?.clientPhoneDisplay ? (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="inline-flex min-h-11 items-center gap-2 rounded-[10000px] border border-[#ececee] bg-white px-4 text-sm font-semibold text-[#18181b] transition-colors hover:bg-[#fafafa]"
            >
              Hubungi Klien
              <span aria-hidden="true" className="text-[#a1a1aa]">▾</span>
            </button>

            {menuOpen ? (
              <div
                role="menu"
                className="absolute left-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-[18px] border border-[#ececee] bg-white py-2 shadow-[0_16px_40px_-24px_rgba(9,9,11,0.35)]"
              >
                <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a1a1aa]">
                  Disarankan sekarang
                </p>
                {reminderItems.length > 0 ? (
                  reminderItems.map((item) => (
                    <button
                      key={item.kind}
                      type="button"
                      role="menuitem"
                      onClick={() => openReminder(item.kind)}
                      className="block min-h-11 w-full px-4 text-left text-sm text-[#18181b] hover:bg-[#f4f4f5]"
                    >
                      {item.label}
                    </button>
                  ))
                ) : (
                  <p className="px-4 py-2 text-sm text-[#71717a]">Belum ada pengingat yang jatuh tempo.</p>
                )}

                <div className="my-2 border-t border-[#ececee]" />
                <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a1a1aa]">
                  Pengingat lain
                </p>
                {otherItems.map((item) => (
                  <button
                    key={item.kind}
                    type="button"
                    role="menuitem"
                    onClick={() => openReminder(item.kind)}
                    className="block min-h-11 w-full px-4 text-left text-sm text-[#3f3f46] hover:bg-[#f4f4f5]"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {latestPdf ? (
          <a
            href={latestPdf.pdfUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-[10000px] border border-[#ececee] bg-white px-4 text-sm font-semibold text-[#18181b] transition-colors hover:bg-[#fafafa]"
          >
            Unduh PDF
            <span className="ml-2 text-[10px] font-normal text-[#a1a1aa]">{latestPdf.invoiceNumber}</span>
          </a>
        ) : null}

        <button
          type="button"
          onClick={openInvoiceReminder}
          disabled={pending || isFullyPaid}
          title={isFullyPaid ? "Invoice terakhir sudah lunas — tidak ada tagihan untuk dikirim" : undefined}
          className="inline-flex min-h-11 items-center rounded-[10000px] bg-[#09090b] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#27272a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Menyiapkan…" : isFullyPaid ? "Tagihan Lunas" : "Kirim Tagihan"}
        </button>
      </div>

      {toast ? <ToastBar toast={toast} onDismiss={() => setToast(null)} /> : null}

      {ctxFailed ? (
        <p role="alert" className="mt-2 text-xs text-[#b91c1c]">
          Tindakan klien tidak dapat dimuat. Muat ulang halaman untuk mencoba lagi.
        </p>
      ) : null}

      <Dialog open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pratinjau Pengingat</DialogTitle>
            <DialogDescription>
              Pesan ini disusun dari data proyek. Periksa sebelum mengirim.
            </DialogDescription>
          </DialogHeader>

          {preview ? (
            <div className="space-y-4">
              {preview.missing.length > 0 ? (
                <div
                  role="alert"
                  className="rounded-[14px] border border-[#fcd34d] bg-[#fffbeb] p-4 text-sm text-[#92400e]"
                >
                  <p className="font-semibold">Pengingat ini belum bisa dikirim.</p>
                  <p className="mt-1">Lengkapi data berikut lebih dahulu:</p>
                  <ul className="mt-2 list-disc pl-5">
                    {preview.missing.map((field) => (
                      <li key={field}>{missingLabel(field)}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  <div className="rounded-[14px] border border-[#ececee] bg-[#fafafa] p-4">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a1a1aa]">
                      Tujuan
                    </p>
                    <p className="font-mono text-sm text-[#18181b]">{preview.targetPhone}</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-[14px] border border-[#ececee] bg-white p-4">
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-[#18181b]">
                      {preview.message}
                    </pre>
                  </div>
                </>
              )}

              {latestPdf?.pdfUrl ? (
                <a
                  href={latestPdf.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-xs font-semibold text-[#18181b] underline underline-offset-4"
                >
                  Lampirkan PDF {latestPdf.invoiceNumber}
                </a>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
              Batal
            </Button>
            <Button
              size="sm"
              onClick={dispatch}
              disabled={!preview?.waUrl || preview.missing.length > 0}
            >
              Buka WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
