"use client";

import { Radio, ArrowRight, AlertTriangle, CheckCircle2, Circle, Sparkles, Users, Video } from "lucide-react";
import { Card, CardInner, CardHeader, Badge } from "@/components/ui/glass";
import { EmptyState } from "@/components/ui/empty-state";
import type { WorkspacePayload } from "@/lib/workspace";

/**
 * Sector Engine — Broadcast, Video & Photo variants.
 *
 * Automatically reads and displays:
 *  1. Nested specs: `sector_specs.broadcast`, `sector_specs.video`, `sector_specs.photo`
 *  2. Selected pricelist package deliverables from `sector_specs.package`
 *  3. Fallback root properties for backward-compatibility with older project rows.
 */

type Camera = { slot: string; body: string; role: string; output: string; to: string };

function SignalChain({
  cameras,
  switcher,
  routing,
  audio,
  transmission,
  intercom,
}: {
  cameras: Camera[];
  switcher: string;
  routing: string;
  audio: string;
  transmission: Record<string, string> | string;
  intercom: string;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {cameras.map((c) => (
          <CardInner key={c.slot}>
            <p className="text-[#ff5a00] font-mono text-[12px] font-semibold">
              {c.slot}
            </p>
            <p className="mt-1 text-xs font-semibold text-[#09090b]">{c.body}</p>
            <p className="mt-0.5 text-[11px] text-[#71717a]">{c.role}</p>
            <p className="mt-2 font-mono text-[10px] text-[#a1a1aa]">
              {c.output} → {c.to}
            </p>
          </CardInner>
        ))}
      </div>

      <div className="flex items-start gap-3 rounded-[12px] border border-[#ececee] bg-[#fafafa] p-3.5">
        <ArrowRight size={15} className="mt-0.5 shrink-0 text-[#a1a1aa]" />
        <div className="min-w-0 space-y-1.5 text-[11px]">
          <p className="text-[#3f3f46]">
            <span className="font-semibold">Routing:</span> {routing}
          </p>
          <p className="text-[#3f3f46]">
            <span className="font-semibold">Switcher:</span> {switcher}
          </p>
          <p className="text-[#3f3f46]">
            <span className="font-semibold">Audio:</span> {audio}
          </p>
          <p className="text-[#3f3f46]">
            <span className="font-semibold">Interkom:</span> {intercom}
          </p>
          <div className="pt-1">
            <p className="font-semibold text-[#3f3f46]">Transmisi:</p>
            {typeof transmission === "string" ? (
              <p className="text-[#52525b]">{transmission}</p>
            ) : (
              Object.entries(transmission).map(([k, v]) => (
                <p key={k} className="text-[#52525b]">
                  <span className="font-mono text-[10px] uppercase text-[#a1a1aa]">{k}</span> — {v}
                </p>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RunOfShow({ cues }: { cues: Array<{ time: string; cue: string; source: string; audioCue?: string }> }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#ececee]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="bg-[#fafafa]">
            <tr className="text-[10px] font-semibold uppercase tracking-wide text-[#71717a]">
              <th className="px-3 py-2.5">Waktu</th>
              <th className="px-3 py-2.5">Cue</th>
              <th className="px-3 py-2.5">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ececee]">
            {cues.map((c, i) => (
              <tr key={i} className="align-top">
                <td className="whitespace-nowrap px-3 py-2.5 font-mono font-semibold text-[#09090b]">
                  {c.time}
                </td>
                <td className="px-3 py-2.5 leading-snug text-[#3f3f46]">{c.cue}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-[#52525b]">
                  {c.source}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SectorBroadcast({ data }: { data: WorkspacePayload }) {
  const rootSpecs = (data.project.sector_specs ?? {}) as Record<string, unknown>;
  const broadcastSpecs = (rootSpecs.broadcast ?? {}) as Record<string, unknown>;
  const pkg = rootSpecs.package as {
    name?: string;
    categoryName?: string;
    duration?: string;
    includes?: string[];
    crew?: string[];
  } | undefined;

  const flow = (broadcastSpecs.signalFlow ?? rootSpecs.signalFlow ?? {}) as Record<string, unknown>;
  const cues = ((broadcastSpecs.runOfShow ?? rootSpecs.runOfShow ?? []) as Array<{
    time: string;
    cue: string;
    source: string;
    audioCue?: string;
  }>);
  const redundancy = (broadcastSpecs.redundancy ?? rootSpecs.redundancy ?? {}) as {
    checklist?: string[];
    hasBackupUplink?: boolean;
    hasUPS?: boolean;
  };

  let cameras = (flow.cameras as Camera[]) ?? [];
  if (cameras.length === 0) {
    cameras = [
      { slot: "CAM 1", body: "Sony FX3 / FX6 (Master Wide)", role: "Program Wide Angle FOH", output: "1080p60 SDI", to: "vMix In 1" },
      { slot: "CAM 2", body: "Sony A7 IV / FX30 (Roving)", role: "Close-up Panggung / Podium", output: "1080p60 Wireless HDMI", to: "vMix In 2" },
      { slot: "CAM 3", body: "PTZ / Static Cam (Audience)", role: "Suasana & Reaksi Peserta", output: "NDI / HDMI", to: "vMix In 3" },
    ];
  }

  const techNotes = (broadcastSpecs.techNotes as string | undefined) ?? (rootSpecs.techNotes as string | undefined);

  return (
    <div className="space-y-5">
      {pkg ? (
        <div className="flex items-center justify-between rounded-xl border border-purple-200 bg-purple-50 px-3.5 py-2.5 text-xs text-purple-900">
          <div className="flex items-center gap-2">
            <Radio size={15} className="text-purple-600 shrink-0" />
            <span>
              Paket Terkontrak: <strong>{pkg.categoryName ? `${pkg.categoryName} — ` : ""}{pkg.name}</strong>
            </span>
          </div>
          {pkg.duration ? (
            <span className="font-mono text-[11px] text-purple-700">Durasi: {pkg.duration}</span>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Signal Flow & Routing FOH"
          description="Jalur sinyal end-to-end — dari kamera sampai pemancar streaming"
        />
        <div className="mt-4">
          <SignalChain
            cameras={cameras}
            switcher={String(flow.switcher ?? "vMix 4K Broadcast Console")}
            routing={String(flow.routing ?? flow.relayVideotron ?? "HDMI / SDI Direct Matrix")}
            audio={String(flow.audio ?? "Behringer X32 Producer Digital Mixer")}
            intercom={String(flow.intercom ?? "Hollyland Solidcom C1 Pro 4-Station")}
            transmission={(flow.transmission as Record<string, string>) ?? "YouTube Live 1080p60"}
          />
        </div>
        {techNotes ? (
          <div className="mt-3 rounded-lg border border-[#ececee] bg-[#fafafa] p-3 text-xs text-[#52525b]">
            <span className="font-semibold text-[#09090b]">Catatan Teknis:</span> {techNotes}
          </div>
        ) : null}
      </Card>

      {/* Redundancy doctrine: no backup uplink is a genuine business risk. */}
      {redundancy.checklist?.length ? (
        <Card>
          <CardHeader
            title="Redundansi & Kesiapan"
            description="Tanpa redundansi, satu kabel putus mematikan siaran publik"
          />
          <ul className="mt-4 space-y-2">
            {redundancy.checklist.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs">
                {redundancy.hasBackupUplink ? (
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[#09090b]" />
                ) : (
                  <Circle size={14} className="mt-0.5 shrink-0 text-[#a1a1aa]" />
                )}
                <span className="text-[#3f3f46]">{item}</span>
              </li>
            ))}
          </ul>
          {!redundancy.hasBackupUplink ? (
            <p className="mt-3 flex items-center gap-2 rounded-lg border border-[#ff5a00]/25 bg-[#ff5a00]/8 px-3 py-2 text-[11px] font-medium text-[#ff5a00]">
              <AlertTriangle size={13} /> Backup uplink belum dikonfirmasi — risiko siaran terputus.
            </p>
          ) : null}
        </Card>
      ) : null}

      {cues.length > 0 ? (
        <Card>
          <CardHeader
            title="Run of Show"
            description={`${cues.length} cue — sumber tunggal untuk switcher dan TD`}
          />
          <div className="mt-4">
            <RunOfShow cues={cues} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** Video pillar: milestone gates + revision counter. */
export function SectorVideo({ data }: { data: WorkspacePayload }) {
  const rootSpecs = (data.project.sector_specs ?? {}) as Record<string, unknown>;
  const videoSpecs = (rootSpecs.video ?? {}) as Record<string, unknown>;
  const pkg = rootSpecs.package as {
    name?: string;
    categoryName?: string;
    duration?: string;
    includes?: string[];
    crew?: string[];
  } | undefined;

  const rawDeliverables =
    videoSpecs.targetDeliverables ??
    pkg?.includes ??
    rootSpecs.targetDeliverables ??
    [];

  const deliverables: string[] = Array.isArray(rawDeliverables) ? (rawDeliverables as string[]) : [];
  const maxRounds = Number(videoSpecs.maxRevisionRounds ?? rootSpecs.maxRevisionRounds ?? 2);

  if (deliverables.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Video size={22} />}
          title="Deliverable belum ditentukan"
          description="Tetapkan target output dan batas revisi agar lingkup tidak melebar."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {pkg ? (
        <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs text-blue-900">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-blue-600 shrink-0" />
            <span>
              Paket Terkontrak: <strong>{pkg.categoryName ? `${pkg.categoryName} — ` : ""}{pkg.name}</strong>
            </span>
          </div>
          {pkg.duration ? (
            <span className="font-mono text-[11px] text-blue-700">Durasi: {pkg.duration}</span>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader title="Deliverables" description="Target output yang dikontrakkan" />
        <ul className="mt-4 space-y-2">
          {deliverables.map((d, i) => (
            <li key={i} className="flex items-start gap-2.5 text-xs text-[#3f3f46]">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
              <span>{d}</span>
            </li>
          ))}
        </ul>
        {pkg?.crew && pkg.crew.length > 0 ? (
          <div className="mt-4 pt-3 border-t border-[#ececee] flex items-center gap-2 text-xs text-[#52525b]">
            <Users size={13} className="text-[#71717a]" />
            <span>Kru Dianjurkan: <strong>{pkg.crew.join(", ")}</strong></span>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Kendali Revisi" description="Batas revisi adalah kontrol margin" />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Batas Revisi</p>
            <p className="mt-1 font-mono text-xl font-bold text-[#09090b]">{maxRounds}×</p>
          </CardInner>
          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Terpakai</p>
            <p className="mt-1 font-mono text-xl font-bold text-[#09090b]">0×</p>
          </CardInner>
          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Sisa</p>
            <p className="mt-1 font-mono text-xl font-bold text-[#09090b]">{maxRounds}×</p>
          </CardInner>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[#71717a]">
          Revisi ke-{maxRounds + 1} dan seterusnya memerlukan addendum berbayar. Pencatatan ronde
          revisi diaktifkan pada paket berikutnya.
        </p>
      </Card>
    </div>
  );
}

/** Photo pillar: proofing quota HUD + gallery access. */
export function SectorPhoto({ data }: { data: WorkspacePayload }) {
  const locked = Boolean(data.project.selection_locked_at);
  const min = data.project.selection_quota_min;
  const max = data.project.selection_quota_max;
  const selected = data.favoriteCount;
  const pct = max > 0 ? Math.min(100, Math.round((selected / max) * 100)) : 0;

  const rootSpecs = (data.project.sector_specs ?? {}) as Record<string, unknown>;
  const photoSpecs = (rootSpecs.photo ?? {}) as Record<string, unknown>;
  const pkg = rootSpecs.package as {
    name?: string;
    categoryName?: string;
    duration?: string;
    includes?: string[];
    crew?: string[];
  } | undefined;

  const rawShotList =
    photoSpecs.shotList ??
    pkg?.includes ??
    rootSpecs.shotList ??
    [];

  const shotList: string[] = Array.isArray(rawShotList) ? (rawShotList as string[]) : [];

  return (
    <div className="space-y-5">
      {pkg ? (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-amber-600 shrink-0" />
            <span>
              Paket Terkontrak: <strong>{pkg.categoryName ? `${pkg.categoryName} — ` : ""}{pkg.name}</strong>
            </span>
          </div>
          {pkg.duration ? (
            <span className="font-mono text-[11px] text-amber-700">Durasi: {pkg.duration}</span>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Kuota Proofing"
          description={`Klien memilih antara ${min}–${max} foto`}
        />
        <div className="mt-4">
          <div className="flex items-end justify-between">
            <p className="font-mono text-2xl font-bold tabular-nums text-[#09090b]">
              {selected}
              <span className="text-sm font-normal text-[#a1a1aa]"> / {max}</span>
            </p>
            <Badge variant={locked ? "filled" : "outline"} className="uppercase">
              {locked ? "Terkunci" : "Menunggu Pilihan"}
            </Badge>
          </div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[#fafafa]">
            <div
              className="h-full rounded-full bg-[#09090b] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Kode Galeri</p>
            <p className="mt-1 font-mono text-sm font-bold text-[#09090b]">
              {data.project.gallery_code}
            </p>
          </CardInner>
          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Total Media</p>
            <p className="mt-1 font-mono text-sm font-bold text-[#09090b]">
              {data.mediaCount}
            </p>
          </CardInner>
          <CardInner>
            <p className="text-[10px] font-mono uppercase text-[#a1a1aa]">Unduhan Hi-Res</p>
            <p className="mt-1 text-sm font-bold text-[#09090b]">
              {data.project.is_fully_paid ? "Terbuka" : "Terkunci"}
            </p>
          </CardInner>
        </div>
      </Card>

      {shotList.length > 0 ? (
        <Card>
          <CardHeader title="Shot List & Deliverables Wajib" description="Lingkup output yang harus tercakup dalam sesi ini" />
          <ul className="mt-4 space-y-2">
            {shotList.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs text-[#3f3f46]">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
          {pkg?.crew && pkg.crew.length > 0 ? (
            <div className="mt-4 pt-3 border-t border-[#ececee] flex items-center gap-2 text-xs text-[#52525b]">
              <Users size={13} className="text-[#71717a]" />
              <span>Kru Dianjurkan: <strong>{pkg.crew.join(", ")}</strong></span>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

export function SectorEngine({ data }: { data: WorkspacePayload }) {
  if (data.project.service_pillar === "BROADCAST_LIVE_STREAMING") return <SectorBroadcast data={data} />;
  if (data.project.service_pillar === "COMMERCIAL_VIDEO") return <SectorVideo data={data} />;
  return <SectorPhoto data={data} />;
}
