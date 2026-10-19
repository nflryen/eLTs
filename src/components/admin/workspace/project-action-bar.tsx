"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import type { ReminderKind } from "@/lib/reminders/compose";

/**
 * Project context bar.
 *
 * The operator's job on this screen is to contact the client and to hand over
 * documents. Both actions live here, pinned to the project header, so they do
 * not require hunting through a module tab.
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

export function ProjectActionBar({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [ctx, setCtx] = useState<ProjectActionContext | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getProjectActionContext(projectId)
      .then((data) => {
        if (!cancelled) setCtx(data);
      })
      .catch(() => {
        if (!cancelled) setError("Gagal memuat tindakan proyek.");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Close the dropdown on outside click and on Escape, matching native menu behaviour.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const openReminder = useCallback(
    (kind: ReminderKind) => {
      setMenuOpen(false);
      setError(null);
      startTransition(async () => {
        const result = await previewReminder(projectId, kind);
        if (result.ok) setPreview(result.preview);
        else setError(result.error);
      });
    },
    [projectId]
  );

  const dispatch = useCallback(() => {
    if (!preview?.waUrl) return;
    // Open synchronously inside the click handler so the popup blocker allows it.
    window.open(preview.waUrl, "_blank", "noopener,noreferrer");
    const sent = preview.message;
    const kind = preview.kind;
    setPreview(null);
    startTransition(async () => {
      const logged = await logReminderDispatch(projectId, kind, sent);
      if (!logged.ok) setError(logged.error ?? "Gagal mencatat pengiriman.");
      else router.refresh();
    });
  }, [preview, projectId, router]);

  const suggested = ctx?.suggested ?? [];
  const latestPdf = ctx?.invoices.find((inv) => inv.pdfUrl) ?? null;

  const reminderItems = (ctx?.available ?? []).filter((item) => suggested.includes(item.kind));
  const otherItems = (ctx?.available ?? []).filter((item) => !suggested.includes(item.kind));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" aria-label="Tindakan proyek">
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

        <a
          href="#module-invoice"
          className="inline-flex min-h-11 items-center rounded-[10000px] bg-[#09090b] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#27272a]"
        >
          Kirim Tagihan
        </a>

        {pending ? <span className="text-xs text-[#71717a]">Menyiapkan…</span> : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-[#b91c1c]">
          {error}
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
