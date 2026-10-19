"use client";

import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Calendar, Camera, CheckCircle2,
  Clock, MessageCircle, Package, Phone, Receipt, Users,
} from "lucide-react";
import type { AttentionItem, AttentionQueue, AttentionSeverity } from "@/types/attention";

/**
 * The "Hari Ini" work queue.
 *
 * This is not a dashboard. It is a queue: read top to bottom, act on each row,
 * and when it is empty you are genuinely done. Every row carries the button
 * that resolves it — never a link that merely describes the problem.
 *
 * Previously the owner had to open and mentally cross-reference seven places
 * each morning. The cross-references (a shoot with unconfirmed crew AND a gear
 * clash AND an unpaid DP being one problem, not three) are now computed here.
 */

const SEVERITY_STYLE: Record<AttentionSeverity, { chip: string; rail: string; icon: React.ReactNode }> = {
  critical: {
    chip: "border-[#ff5a00]/30 bg-[#ff5a00]/10 text-[#c2410c]",
    rail: "border-l-[#ff5a00]",
    icon: <AlertTriangle size={15} />,
  },
  high: {
    chip: "border-[#18181b]/20 bg-[#18181b]/8 text-[#18181b]",
    rail: "border-l-[#18181b]",
    icon: <Clock size={15} />,
  },
  medium: {
    chip: "border-[#a1a1aa]/40 bg-[#a1a1aa]/15 text-[#52525b]",
    rail: "border-l-[#a1a1aa]",
    icon: <Calendar size={15} />,
  },
};

const ACTION_ICON: Record<string, React.ReactNode> = {
  whatsapp: <MessageCircle size={14} />,
  primary: <ArrowRight size={14} />,
  secondary: <ArrowRight size={14} />,
};

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  "HARI INI": <Camera size={13} />,
  BESOK: <Camera size={13} />,
  "TERTUNDA DIKIRIM": <Package size={13} />,
  "INVOICE JATUH TEMPO": <Receipt size={13} />,
  "LEAD BELUM DIBALAS": <Phone size={13} />,
  "BENTROK GEAR": <Package size={13} />,
  "BELUM DIJADWALKAN": <Users size={13} />,
  "PACKING BELUM DICEK": <Package size={13} />,
};

function ActionButton({ action }: { action: AttentionItem["actions"][number] }) {
  const isExternal = action.href.startsWith("http");
  const classes =
    action.kind === "whatsapp"
      ? "border border-[#18181b] bg-white text-[#18181b] hover:bg-[#fafafa]"
      : action.kind === "primary"
        ? "bg-[#09090b] text-white hover:bg-[#27272a]"
        : "border border-[#ececee] bg-white text-[#3f3f46] hover:bg-[#fafafa]";

  const content = (
    <>
      {ACTION_ICON[action.kind]}
      <span>{action.label}</span>
    </>
  );

  // min-h-11 = 44px touch target, per the mobile-first requirement.
  const cls = `inline-flex min-h-11 items-center gap-1.5 rounded-[14px] px-3.5 text-xs font-semibold transition-colors cursor-pointer ${classes}`;

  if (isExternal) {
    return (
      <a href={action.href} target="_blank" rel="noopener noreferrer" className={cls}>
        {content}
      </a>
    );
  }
  return (
    <Link href={action.href} className={cls}>
      {content}
    </Link>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const style = SEVERITY_STYLE[item.severity];
  return (
    <article
      className={`rounded-[36px] border border-[#ececee] bg-white border-l-4 p-4 sm:p-5 ${style.rail}`}
      aria-label={`${item.category}: ${item.title}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.chip}`}
        >
          {CATEGORY_ICON[item.category] ?? style.icon}
          {item.category}
        </span>
        <span className="text-[11px] font-medium text-[#71717a]">
          {item.ageLabel}
        </span>
      </div>

      <h3 className="mt-2.5 font-serif text-base font-bold tracking-tight text-[#09090b]">
        {item.title}
      </h3>
      <p className="mt-0.5 text-xs font-medium text-[#71717a]">{item.detail}</p>

      {item.findings.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {item.findings.map((f, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-xs leading-relaxed text-[#52525b]"
            >
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[#a1a1aa]" />
              <span className="min-w-0 break-words">{f}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Actions wrap rather than scroll: never introduce horizontal overflow. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {item.actions.map((a, i) => (
          <ActionButton key={i} action={a} />
        ))}
      </div>
    </article>
  );
}

export function AttentionQueueView({
  queue,
  ownerName,
}: {
  queue: AttentionQueue;
  ownerName: string;
}) {
  const { summary, items } = queue;
  const today = new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <header className="border-b border-[#ececee] pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-[#09090b] sm:text-3xl">
              Hari Ini
            </h1>
            <p className="mt-0.5 text-sm text-[#71717a]">
              {today} · Selamat bekerja, {ownerName}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {summary.critical > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ff5a00]/30 bg-[#ff5a00]/10 px-3 py-1.5 text-xs font-bold text-[#c2410c]">
                <AlertTriangle size={13} /> {summary.critical} kritis
              </span>
            ) : null}
            {summary.high > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#18181b]/20 bg-[#18181b]/8 px-3 py-1.5 text-xs font-bold text-[#18181b]">
                <Clock size={13} /> {summary.high} perlu perhatian
              </span>
            ) : null}
            {summary.total > 0 ? (
              <span className="rounded-full border border-[#ececee] bg-[#fafafa] px-3 py-1.5 text-xs font-semibold text-[#3f3f46]">
                {summary.total} total
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {/* Queue, or the relief state */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[36px] border border-[#ececee] bg-white px-6 py-14 text-center">
          <CheckCircle2 size={34} className="text-[#09090b]" />
          <p className="font-serif text-xl font-bold text-[#09090b]">
            Tidak ada yang perlu ditindaklanjuti
          </p>
          <p className="max-w-md text-sm leading-relaxed text-[#71717a]">
            Semua kru sudah konfirmasi, tidak ada invoice jatuh tempo, tidak ada lead
            menunggu, dan tidak ada alat yang bentrok. Hari ini berjalan lancar.
          </p>
        </div>
      ) : (
        <section aria-label="Daftar tindakan" className="space-y-3">
          {items.map((item) => (
            <AttentionRow key={item.id} item={item} />
          ))}
        </section>
      )}
    </div>
  );
}
