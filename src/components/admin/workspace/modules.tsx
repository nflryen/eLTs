"use client";

import Link from "next/link";
import {
  Users, Receipt, HardDrive, Image as ImageIcon,
  CheckCircle2, Clock, XCircle, AlertTriangle,
} from "lucide-react";
import { Card, CardInner, CardHeader, Badge } from "@/components/ui/glass";
import { EmptyState } from "@/components/ui/empty-state";
import type { WorkspacePayload, CrewAssignment } from "@/lib/workspace";
import { jakartaLongDate, jakartaShortDate, jakartaTime } from "@/lib/datetime";
import { Suspense } from "react";
import { RabPanel } from "./rab-panel";
import { InvoicePanel } from "./invoice-panel";
import { CrewManager } from "./crew-manager";

const idr = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/* ══════════════════════════════════════════════════════════════════════════
   CALL SHEET — the one screen that runs the day
   ══════════════════════════════════════════════════════════════════════════ */
export function ModuleCallSheet({ data }: { data: WorkspacePayload }) {
  const s = data.project.sector_specs as { runOfShow?: Array<{ time: string; cue: string; source: string }> };
  const cues = s.runOfShow ?? [];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Ringkasan Produksi" description="Fakta operasional dalam satu pandangan" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Tanggal Shoot</p>
            <p className="mt-1 text-sm font-bold text-[#09090b]">
              {data.project.shoot_date ? jakartaLongDate(`${data.project.shoot_date}T00:00:00+07:00`) : "—"}
            </p>
          </CardInner>
          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Kru</p>
            <p className="mt-1 text-sm font-bold text-[#09090b]">
              {data.crew.filter((c) => c.acceptance_status === "ACCEPTED").length}/{data.crew.length} konfirmasi
            </p>
          </CardInner>
          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Gear</p>
            <p className="mt-1 text-sm font-bold text-[#09090b]">{data.gear.length} item</p>
          </CardInner>
          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Lokasi</p>
            <p className="mt-1 truncate text-sm font-bold text-[#09090b]">
              {data.venue.name}
            </p>
          </CardInner>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Rundown Singkat"
          description="Urutan kunci hari-H"
          action={
            <span className="text-[11px] font-medium text-[#71717a]">
              Detail lengkap di Sector Engine
            </span>
          }
        />
        {cues.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<Clock size={20} />}
              title="Run of show belum diisi"
              description="Tambahkan cue sheet agar setiap kru melihat urutan yang sama."
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-[#ececee]">
            {cues.slice(0, 5).map((c, i) => (
              <li key={i} className="flex items-start gap-3 py-2.5">
                <span className="w-12 shrink-0 font-mono text-xs font-bold text-[#09090b]">
                  {c.time}
                </span>
                <span className="min-w-0 flex-1 text-xs leading-snug text-[#52525b]">
                  {c.cue}
                </span>
                <span className="hidden shrink-0 font-mono text-[10px] text-[#a1a1aa] sm:block">
                  {c.source}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CREW — dispatch board with consent lifecycle
   ══════════════════════════════════════════════════════════════════════════ */
const CONSENT: Record<
  string,
  { label: string; variant: "outline" | "filled" | "ember"; className?: string; icon: React.ReactNode }
> = {
  ACCEPTED: {
    label: "Konfirmasi",
    variant: "outline",
    className: "text-[#09090b]",
    icon: <CheckCircle2 size={12} />,
  },
  PENDING_OFFER: {
    label: "Menunggu",
    variant: "ember",
    icon: <Clock size={12} />,
  },
  DECLINED: {
    label: "Menolak",
    variant: "filled",
    icon: <XCircle size={12} />,
  },
  EXPIRED: {
    label: "Kedaluwarsa",
    variant: "outline",
    className: "text-[#a1a1aa]",
    icon: <Clock size={12} />,
  },
};

function CrewCard({ c }: { c: CrewAssignment }) {
  const consent = CONSENT[c.acceptance_status] ?? CONSENT.PENDING_OFFER;
  const digits = (c.crew_phone ?? "").replace(/\D/g, "");
  const wa = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  const invited = c.acceptance_status !== "ACCEPTED" && c.acceptance_status !== "DECLINED";

  return (
    <CardInner className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[#09090b]">{c.crew_name}</p>
          <p className="truncate text-[11px] font-medium text-[#71717a]">{c.role_title}</p>
        </div>
        <Badge variant={consent.variant} className={`shrink-0 ${consent.className ?? ""}`}>
          {consent.icon} {consent.label}
        </Badge>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Honor</p>
          <p className="font-mono text-sm font-bold text-[#09090b]">{idr(c.fee_agreed)}</p>
          {c.standard_day_rate ? (
            <p className="font-mono text-[10px] text-[#a1a1aa]">Std {idr(c.standard_day_rate)}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {c.crew_type === "CORE_TEAM" ? (
            <span className="rounded-full border border-[#ececee] bg-[#fafafa] px-2 py-0.5 text-[9px] font-bold uppercase text-[#52525b]">
              Core
            </span>
          ) : (
            <span className="rounded-full border border-[#ececee] px-2 py-0.5 text-[9px] font-bold uppercase text-[#71717a]">
              Freelance
            </span>
          )}
          <span
            className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${
              c.payment_status === "PAID"
                ? "border-[#ececee] text-[#09090b]"
                : "border-[#ececee] text-[#71717a]"
            }`}
          >
            {c.payment_status === "PAID" ? "Dibayar" : "Belum"}
          </span>
        </div>
      </div>

      {c.declined_reason ? (
        <p className="rounded-lg border border-[#ff5a00]/25 bg-[#ff5a00]/8 px-2.5 py-1.5 text-[11px] text-[#ff5a00]">
          {c.declined_reason}
        </p>
      ) : null}

      {digits ? (
        <div className="flex gap-2">
          {invited ? (
            <a
              href={`https://wa.me/${wa}?text=${encodeURIComponent(
                `Halo ${c.crew_name}, kami mengundang Anda untuk bergabung pada produksi *${c.project_name ?? "produksi kami"}*. Mohon konfirmasi ketersediaan Anda. Terima kasih.`,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#ff5a00] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#e65100] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5a00]/40 focus-visible:ring-offset-2"
            >
              Kirim Undangan WA
            </a>
          ) : (
            <span className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#ececee] px-3 text-xs font-medium text-[#71717a]">
              Call {c.call_time ? jakartaTime(c.call_time) : "06:30"} WIB
            </span>
          )}
        </div>
      ) : null}
    </CardInner>
  );
}

export function ModuleCrew({ data }: { data: WorkspacePayload }) {
  // Attach project name so the WA template is complete.
  const crew = data.crew.map((c) => ({ ...c, project_name: data.project.name }));
  const assignedIds = new Set(crew.map((c) => c.crew_member_id));
  const pool = data.availableCrew.filter((c) => !assignedIds.has(c.id));
  const pending = crew.filter((c) => c.acceptance_status === "PENDING_OFFER").length;

  return (
    <div className="space-y-5">
      {pending > 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-[#ff5a00]/25 bg-[#ff5a00]/8 px-3.5 py-2.5 text-xs font-medium text-[#ff5a00]">
          <AlertTriangle size={14} /> {pending} kru belum konfirmasi — kirim ulang undangan sebelum H-1.
        </p>
      ) : null}

      <Card>
        <CardHeader
          title="Stasiun Lapangan"
          description={`${crew.length} kru ditugaskan · ${crew.filter((c) => c.acceptance_status === "ACCEPTED").length} terkonfirmasi`}
        />
        {/*
         * The manager owns assignment. Cards below are read-only summaries of
         * consent and payment state, which the manager does not duplicate.
         */}
        <div className="mt-4">
          <CrewManager
            projectId={data.project.id}
            shootDate={data.project.shoot_date}
            crew={crew.map((c) => ({
              id: c.id,
              crew_member_id: c.crew_member_id,
              crew_name: c.crew_name,
              role_title: c.role_title,
              fee_agreed: c.fee_agreed,
              acceptance_status: c.acceptance_status,
              payment_status: c.payment_status,
              call_time: c.call_time,
            }))}
          />
        </div>

        {crew.length === 0 ? (
          <div className="mt-4 hidden">
            <EmptyState
              icon={<Users size={20} />}
              title="Belum ada kru ditugaskan"
              description="Tugaskan Technical Director dan operator kamera terlebih dahulu."
            />
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {crew.map((c) => (
              <CrewCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Pool Kru Tersedia"
          description={`${pool.length} kru aktif belum ditugaskan ke proyek ini`}
        />
        {pool.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="Semua kru aktif sudah ditugaskan" />
          </div>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pool.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-dashed border-[#d4d4d8] p-3"
              >
                <p className="truncate text-xs font-semibold text-[#18181b]">
                  {c.full_name}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-[#a1a1aa]">{c.crew_code}</p>
                <p className="mt-1.5 font-mono text-[11px] text-[#52525b]">
                  {idr(c.standard_day_rate)}
                </p>
                <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-[#71717a]">
                  {c.primary_skills.slice(0, 3).join(" · ") || "—"}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   GEAR — three-tier ownership, and the two export streams kept separate
   ══════════════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════════════
   INVOICE — client-facing, zero leakage
   ══════════════════════════════════════════════════════════════════════════ */
export function ModuleInvoice({ data }: { data: WorkspacePayload }) {
  return <InvoicePanel data={data} />;
}

/* ══════════════════════════════════════════════════════════════════════════
   RAB — studio-private. The zero-leakage boundary lives here.
   ══════════════════════════════════════════════════════════════════════════ */
export function ModuleRab({ data }: { data: WorkspacePayload }) {
  /*
   * RabPanel calls `use(promise)` to read its money split. A component that
   * suspends needs a Suspense boundary ABOVE it in the tree; the page-level
   * boundary sits above an already-committed client component, so a later
   * suspension there can never recover and the panel hangs on "Memuat
   * workspace…" forever. This local boundary lets the panel stream in while
   * the rest of the console stays interactive.
   */
  return (
    <Suspense fallback={<RabSkeleton />}>
      <RabPanel data={data} />
    </Suspense>
  );
}

function RabSkeleton() {
  return (
    <div className="rounded-[18px] border border-[#ececee] bg-[#09090b] p-5">
      <div className="h-3 w-32 animate-pulse rounded-full bg-white/10" />
      <div className="mt-4 h-8 w-48 animate-pulse rounded-full bg-white/10" />
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="h-16 animate-pulse rounded-[12px] bg-white/5" />
        <div className="h-16 animate-pulse rounded-[12px] bg-white/5" />
        <div className="h-16 animate-pulse rounded-[12px] bg-white/5" />
      </div>
      <p className="mt-6 text-xs text-[#71717a]">Memuat RAB internal…</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MEDIA + PROOFING
   ══════════════════════════════════════════════════════════════════════════ */
export function ModuleMedia({ data }: { data: WorkspacePayload }) {
  return (
    <Card>
      <CardHeader title="Media Proyek" description="Aset yang terhubung ke galeri klien" />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <CardInner>
          <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Total Media</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#09090b]">{data.mediaCount}</p>
        </CardInner>
        <CardInner>
          <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Dipilih Klien</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#09090b]">{data.favoriteCount}</p>
        </CardInner>
        <CardInner>
          <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Status</p>
          <p className="mt-1 text-sm font-bold text-[#09090b]">
            {data.project.selection_locked_at ? "Terkunci" : "Terbuka"}
          </p>
        </CardInner>
      </div>
      {data.mediaCount === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={<HardDrive size={20} />}
            title="Belum ada media diunggah"
            description="Unggah hasil produksi untuk membuka galeri proofing klien."
            action={
              <Link
                href={`/admin/projects/${data.project.id}/media`}
                className="inline-flex min-h-11 items-center rounded-xl bg-[#09090b] px-4 text-xs font-semibold text-white"
              >
                Buka Manajer Media
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-4">
          <Link
            href={`/admin/projects/${data.project.id}/media`}
            className="inline-flex min-h-11 items-center rounded-xl bg-[#09090b] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#18181b]"
          >
            Buka Manajer Media
          </Link>
        </div>
      )}
    </Card>
  );
}

export function ModuleProofing({ data }: { data: WorkspacePayload }) {
  const locked = Boolean(data.project.selection_locked_at);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Status Proofing Klien"
          description="Klien memilih foto melalui galeri ber-PIN"
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Kode Galeri</p>
            <p className="mt-1 font-mono text-sm font-bold text-[#09090b]">
              {data.project.gallery_code}
            </p>
          </CardInner>
          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Pilihan Klien</p>
            <p className="mt-1 font-mono text-sm font-bold text-[#09090b]">
              {data.favoriteCount} / {data.project.selection_quota_max}
            </p>
          </CardInner>
        </div>
        <p className={`mt-3 rounded-lg border px-3 py-2 text-[11px] font-medium ${
          locked
            ? "border-[#ececee] bg-[#fafafa] text-[#09090b]"
            : "border-[#ececee] bg-[#fafafa] text-[#71717a]"
        }`}>
          {locked
            ? "Pilihan terkunci — tugas editor sudah dibuat otomatis."
            : "Menunggu klien menyelesaikan pemilihan foto."}
        </p>
      </Card>

      <Card>
        <CardHeader title="Gate Pengiriman" description="Rantai sebab-akibat menuju unduhan hi-res" />
        <ul className="mt-4 space-y-2.5">
          <li className="flex items-center gap-2.5 text-xs">
            {data.project.selection_locked_at ? (
              <CheckCircle2 size={14} className="text-[#09090b]" />
            ) : (
              <Clock size={14} className="text-[#a1a1aa]" />
            )}
            <span className="text-[#3f3f46]">Klien menyelesaikan pemilihan</span>
          </li>
          <li className="flex items-center gap-2.5 text-xs">
            {data.editorTask && ["IN_PROGRESS", "REVIEW", "COMPLETED"].includes(data.editorTask.status) ? (
              <CheckCircle2 size={14} className="text-[#09090b]" />
            ) : (
              <Clock size={14} className="text-[#a1a1aa]" />
            )}
            <span className="text-[#3f3f46]">Editor mengerjakan retouch</span>
          </li>
          <li className="flex items-center gap-2.5 text-xs">
            {data.project.is_fully_paid ? (
              <CheckCircle2 size={14} className="text-[#09090b]" />
            ) : (
              <AlertTriangle size={14} className="text-[#ff5a00]" />
            )}
            <span className="text-[#3f3f46]">
              Pelunasan {data.project.is_fully_paid ? "diterima" : "belum diterima"}
            </span>
          </li>
          <li className="flex items-center gap-2.5 text-xs">
            <Badge variant={data.project.is_fully_paid ? "outline" : "ember"} className={data.project.is_fully_paid ? "text-[#09090b]" : undefined}>
              {data.project.is_fully_paid ? "Hi-Res Terbuka" : "Hi-Res Terkunci"}
            </Badge>
          </li>
        </ul>
      </Card>

      {data.editorTask ? (
        <Card>
          <CardHeader title="Tugas Post-Produksi" description="Dibuat otomatis saat pilihan klien dikunci" />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <CardInner>
              <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Status</p>
              <p className="mt-1 text-sm font-bold text-[#09090b]">
                {data.editorTask.status.replace(/_/g, " ")}
              </p>
            </CardInner>
            <CardInner>
              <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Jumlah Deliverable</p>
              <p className="mt-1 font-mono text-sm font-bold text-[#09090b]">
                {data.editorTask.deliverable_count}
              </p>
            </CardInner>
            <CardInner>
              <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Dibuat</p>
              <p className="mt-1 text-xs font-semibold text-[#09090b]">
                {jakartaShortDate(data.editorTask.created_at)}
              </p>
            </CardInner>
          </div>
          <div className="mt-4">
            <Link
              href="/admin/editor-queue"
              className="inline-flex min-h-11 items-center rounded-xl border border-[#ececee] bg-white px-4 text-xs font-semibold text-[#3f3f46]"
            >
              Buka Post-Produksi
            </Link>
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<ImageIcon size={20} />}
            title="Belum ada tugas editor"
            description="Tugas dibuat otomatis begitu klien mengunci pilihan foto."
          />
        </Card>
      )}
    </div>
  );
}
