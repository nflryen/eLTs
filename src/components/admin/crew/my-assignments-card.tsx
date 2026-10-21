"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  HardDrive,
  Loader2,
  MapPin,
  Shirt,
  Wallet,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  acceptAssignment,
  declineAssignment,
  markShootCompleted,
  type CrewResult,
  type MyAssignment,
} from "@/app/actions/crew-dashboard";
import { jakartaLongDate, jakartaTime } from "@/lib/datetime";
import { idr } from "@/lib/format";

/**
 * One assignment card on the crew member's own board.
 *
 * The card owns its own pending/error state rather than lifting both to the
 * board: three cards can be acted on independently, and a failure on one must
 * not blank the buttons on the others.
 *
 * Actions are never disabled by the *server* — a crew member whose session
 * lapsed still sees the buttons, presses them, and gets an honest message. The
 * guard is in the action, not in the markup.
 */

const PAYMENT_LABEL: Record<MyAssignment["payment_status"], string> = {
  UNPAID: "Belum dibayar",
  PARTIAL: "Dibayar sebagian",
  PAID: "Sudah dibayar",
};

const STATE_LABEL: Record<MyAssignment["state"], string> = {
  PENDING_OFFER: "Menunggu jawaban",
  ACCEPTED: "Diterima",
  DECLINED: "Ditolak",
  EXPIRED: "Kedaluwarsa",
};

export function MyAssignmentCard({ assignment }: { assignment: MyAssignment }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Inline disclosure instead of `window.prompt`: a prompt cannot be styled, is
  // blocked by some mobile browsers, and loses the text on a mis-tap.
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [completing, setCompleting] = useState(false);
  const [dropUrl, setDropUrl] = useState(assignment.raw_drop_url ?? "");

  const run = (action: () => Promise<CrewResult>, onSuccess?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSuccess?.();
      // The row moved to another group, so the server component must re-render:
      // a local state flip would leave the card sitting in the wrong section.
      router.refresh();
    });
  };

  const isOffer = assignment.state === "PENDING_OFFER";
  const isAccepted = assignment.state === "ACCEPTED";
  const isDone = Boolean(assignment.completed_at);

  return (
    <article className="rounded-[var(--radius-cards)] border border-[var(--color-cloud)] bg-[var(--color-snow)] p-5 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-ash)]">
            {assignment.project.name}
          </p>
          <h3 className="mt-1 text-[17px] font-semibold leading-snug text-[var(--color-obsidian)]">
            {assignment.role_title}
          </h3>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span className="rounded-[var(--radius-badges)] border border-[var(--color-cloud)] px-2 py-1 text-[11px] font-medium text-[var(--color-fog)]">
            {PAYMENT_LABEL[assignment.payment_status]}
          </span>
          <span
            className={[
              "rounded-[var(--radius-badges)] px-2 py-1 text-[11px] font-medium",
              isOffer
                ? "bg-[var(--color-ember)]/10 text-[var(--color-ember)]"
                : isAccepted && !isDone
                  ? "bg-[var(--color-graphite)] text-white"
                  : "bg-[var(--color-paper)] text-[var(--color-steel)]",
            ].join(" ")}
          >
            {isDone ? "Selesai" : STATE_LABEL[assignment.state]}
          </span>
        </div>
      </header>

      <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-[var(--color-cloud)] pt-4 text-[13px] sm:grid-cols-2">
        <div className="flex items-start gap-2">
          <CalendarDays
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-[var(--color-ash)]"
          />
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ash)]">Jadwal</dt>
            <dd className="text-[var(--color-graphite)]">
              {jakartaLongDate(assignment.call_time)}
            </dd>
            <dd className="text-[var(--color-fog)]">
              Panggilan {jakartaTime(assignment.call_time)}
              {assignment.roll_time ? ` · Roll ${jakartaTime(assignment.roll_time)}` : ""}
            </dd>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <MapPin
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-[var(--color-ash)]"
          />
          <div className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ash)]">Lokasi</dt>
            <dd className="text-[var(--color-graphite)]">{assignment.venue_name}</dd>
            <dd className="text-[var(--color-fog)]">{assignment.venue_address}</dd>
            {assignment.venue_maps_url ? (
              <dd className="mt-1">
                <a
                  href={assignment.venue_maps_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-iron)] underline decoration-[var(--color-mist)] underline-offset-2 hover:text-[var(--color-obsidian)]"
                >
                  Buka peta
                  <ExternalLink aria-hidden="true" className="size-3" />
                </a>
              </dd>
            ) : null}
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Shirt
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-[var(--color-ash)]"
          />
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ash)]">
              Dress code
            </dt>
            <dd className="text-[var(--color-graphite)]">{assignment.dress_code}</dd>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Wallet
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-[var(--color-ash)]"
          />
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ash)]">
              Fee disepakati
            </dt>
            <dd className="font-semibold tabular-nums text-[var(--color-obsidian)]">
              {idr(assignment.fee_agreed)}
            </dd>
          </div>
        </div>
      </dl>

      {assignment.technical_notes ? (
        <div className="mt-4 rounded-[var(--radius-buttons)] bg-[var(--color-paper)] p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ash)]">
            Instruksi teknis
          </p>
          <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-[var(--color-graphite)]">
            {assignment.technical_notes}
          </p>
        </div>
      ) : null}

      {assignment.allocated_equipment.length > 0 ? (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ash)]">
            <Wrench aria-hidden="true" className="size-3.5" />
            Perlengkapan
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {assignment.allocated_equipment.map((item) => (
              <li
                key={item}
                className="rounded-[var(--radius-badges)] bg-[var(--color-paper)] px-2 py-1 text-[11px] text-[var(--color-steel)]"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isOffer && assignment.offer_expires_at ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[var(--color-fog)]">
          <Clock aria-hidden="true" className="size-3.5" />
          Jawab sebelum {jakartaLongDate(assignment.offer_expires_at)}{" "}
          {jakartaTime(assignment.offer_expires_at)} WIB
        </p>
      ) : null}

      {assignment.declined_reason ? (
        <p className="mt-3 rounded-[var(--radius-buttons)] border border-[var(--color-cloud)] px-3 py-2 text-[12px] text-[var(--color-fog)]">
          Alasan penolakan Anda: {assignment.declined_reason}
        </p>
      ) : null}

      {isDone ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[var(--color-fog)]">
          <CheckCircle2 aria-hidden="true" className="size-3.5" />
          Ditandai selesai {jakartaLongDate(assignment.completed_at)}{" "}
          {jakartaTime(assignment.completed_at)}
        </p>
      ) : null}

      {assignment.raw_drop_url ? (
        <a
          href={assignment.raw_drop_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-iron)] underline decoration-[var(--color-mist)] underline-offset-2 hover:text-[var(--color-obsidian)]"
        >
          <HardDrive aria-hidden="true" className="size-3.5" />
          Buka folder raw files
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-[var(--radius-buttons)] border border-[var(--color-ember)]/40 bg-[var(--color-ember)]/5 px-3 py-2 text-[12px] text-[var(--color-ember)]"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {isOffer ? (
        <div className="mt-4 border-t border-[var(--color-cloud)] pt-4">
          {declining ? (
            <div className="space-y-2">
              <label
                htmlFor={`reason-${assignment.id}`}
                className="block text-[12px] font-medium text-[var(--color-iron)]"
              >
                Kenapa Anda menolak? (wajib)
              </label>
              <textarea
                id={`reason-${assignment.id}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Contoh: jadwal bentrok dengan penugasan lain pada tanggal yang sama."
                className="w-full rounded-[var(--radius-buttons)] border border-[var(--color-cloud)] bg-white px-3 py-2 text-[13px] text-[var(--color-graphite)] outline-none placeholder:text-[var(--color-ash)] focus:border-[var(--color-iron)]"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={pending || reason.trim().length < 3}
                  onClick={() =>
                    run(
                      () => declineAssignment(assignment.id, reason),
                      () => {
                        setDeclining(false);
                        setReason("");
                      },
                    )
                  }
                >
                  {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                  Kirim penolakan
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setDeclining(false);
                    setError(null);
                  }}
                >
                  Batal
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => run(() => acceptAssignment(assignment.id))}
              >
                {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                Terima
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setDeclining(true)}
              >
                <XCircle aria-hidden="true" className="size-4" />
                Tolak
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {isAccepted && !isDone ? (
        <div className="mt-4 border-t border-[var(--color-cloud)] pt-4">
          {completing ? (
            <div className="space-y-2">
              <label
                htmlFor={`drop-${assignment.id}`}
                className="block text-[12px] font-medium text-[var(--color-iron)]"
              >
                Tautan folder raw files (opsional)
              </label>
              <input
                id={`drop-${assignment.id}`}
                type="url"
                value={dropUrl}
                onChange={(event) => setDropUrl(event.target.value)}
                placeholder="https://drive.google.com/…"
                className="w-full rounded-[var(--radius-buttons)] border border-[var(--color-cloud)] bg-white px-3 py-2 text-[13px] text-[var(--color-graphite)] outline-none placeholder:text-[var(--color-ash)] focus:border-[var(--color-iron)]"
              />
              <p className="text-[11px] text-[var(--color-ash)]">
                Kosongkan jika file diserahkan langsung ke koordinator.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => markShootCompleted(assignment.id, dropUrl),
                      () => setCompleting(false),
                    )
                  }
                >
                  {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                  Simpan & tandai selesai
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setCompleting(false);
                    setError(null);
                  }}
                >
                  Batal
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setCompleting(true)}
            >
              <CheckCircle2 aria-hidden="true" className="size-4" />
              Tandai Selesai
            </Button>
          )}
        </div>
      ) : null}
    </article>
  );
}
