"use client";

import {
  Radio,
  Video,
  Camera,
  Layers,
  CheckCircle2,
  Film,
  Lock,
  Unlock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoodboardReview } from "@/components/admin/moodboard-review";
import type { ProjectRow } from "@/types/database";
import type {
  BroadcastSpecs,
  VideoSpecs,
  PhotoSpecs,
} from "@/types/sectors";

interface TabSectorSpecsProps {
  project: ProjectRow;
}

export function TabSectorSpecs({ project }: TabSectorSpecsProps) {
 const pillar = project.service_pillar || "EVENT_GRADUATION_PHOTO";
  const specs = (project.sector_specs || {}) as {
    broadcast?: BroadcastSpecs;
    video?: VideoSpecs;
    photo?: PhotoSpecs;
  };

  const isBroadcast =
 pillar.includes("BROADCAST") ||
 pillar.includes("STREAM") ||
 pillar === "TECH_SOLUTION";

  const isVideo =
 pillar.includes("VIDEO") ||
 pillar.includes("AFTERMOVIE");

  const isPhoto = !isBroadcast && !isVideo;

  return (
 <div className="space-y-6">
      {/* Sector Badge Indicator */}
      <div className="flex items-center justify-between p-4 rounded-[36px] border border-[#ececee] bg-white">
 <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-[#fafafa] text-[#3f3f46] flex items-center justify-center border border-[#ececee]">
            {isBroadcast ? <Radio size={18} /> : isVideo ? <Video size={18} /> : <Camera size={18} />}
          </div>
          <div>
 <span className="text-[10px] font-mono tracking-wider text-[#71717a] uppercase">
              ACTIVE SECTOR DNA SPECIFICATION
            </span>
 <h3 className="font-bold text-base text-[#09090b] ">
              {isBroadcast
 ? "01 / Multi-Cam Live Streaming & FOH Console"
                : isVideo
 ? "02 / Commercial Video & Post-Production Pipeline"
 : "03 / Event & Graduation Photography Proofing"}
            </h3>
          </div>
        </div>

 <span className="text-xs font-mono font-semibold px-3 py-1 rounded-full bg-[#fafafa] border border-[#ececee] text-[#27272a] ">
 {project.service_pillar || "PHOTOGRAPHY"}
        </span>
      </div>

      {/* CASE A: BROADCAST & FOH SPECIFICATIONS */}
      {isBroadcast && (
 <div className="space-y-6">
          {/* Signal Flow Topology Card */}
        <div className="rounded-[36px] border border-[#ececee] bg-white p-6 space-y-4">
 <h4 className="font-bold tracking-tight text-lg text-[#09090b] border-b border-[#ececee]/80 pb-3 flex items-center gap-2">
              <Layers size={18} className="text-[#3f3f46]" />
              <span>Arsitektur Alur Sinyal (Signal Flow Topology)</span>
            </h4>

 <div className="grid sm:grid-cols-4 gap-3 text-xs">
            <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4 space-y-1">
 <span className="text-[10px] font-mono text-[#71717a] block uppercase">
                  SWITCHER CONSOLE
                </span>
 <p className="font-bold text-[#09090b]">
 {specs.broadcast?.signalFlow?.switcher || "vMix 4K Broadcast Console"}
                </p>
 <p className="text-[11px] text-[#71717a]">DeckLink 4K Quad SDI Ingest</p>
              </div>

            <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4 space-y-1">
 <span className="text-[10px] font-mono text-[#71717a] block uppercase">
                  AUDIO ROUTING
                </span>
 <p className="font-bold text-[#09090b]">
 {specs.broadcast?.signalFlow?.audio || "Behringer X32 Producer"}
                </p>
 <p className="text-[11px] text-[#71717a]">Dante / Analog Line Ingest</p>
              </div>

            <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4 space-y-1">
 <span className="text-[10px] font-mono text-[#71717a] block uppercase">
                  TRANSMISI LIVE
                </span>
 <p className="font-bold text-[#09090b]">
 {specs.broadcast?.signalFlow?.transmission || "YouTube Live Stream 1080p60"}
                </p>
 <p className="text-[11px] text-[#71717a]">Bitrate 6.500 Kbps CBR</p>
              </div>

            <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4 space-y-1">
 <span className="text-[10px] font-mono text-[#71717a] block uppercase">
                  KOMUNIKASI INTERCOM
                </span>
 <p className="font-bold text-[#09090b]">
 {specs.broadcast?.signalFlow?.intercom || "Hollyland Solidcom C1 Pro"}
                </p>
 <p className="text-[11px] text-[#71717a]">4-Station Wireless Headsets</p>
              </div>
            </div>
          </div>

          {/* Run of Show / Cue Sheet Table */}
        <div className="rounded-[36px] border border-[#ececee] bg-white p-6 space-y-4">
 <div className="flex items-center justify-between border-b border-[#ececee]/80 pb-3">
 <h4 className="font-bold tracking-tight text-lg text-[#09090b] ">
                Run of Show &amp; Technical Cue Sheet
              </h4>
 <span className="text-xs text-[#71717a] font-mono">
                Urutan Cue Siaran Langsung
              </span>
            </div>

 <div className="overflow-x-auto">
 <table className="w-full text-xs text-left">
                <thead>
 <tr className="border-b border-[#ececee]/80 bg-[#fafafa]/80 text-[#71717a] font-mono">
 <th className="py-2.5 px-3">Jam (WIB)</th>
 <th className="py-2.5 px-3">Cue / Aksi Panggung</th>
 <th className="py-2.5 px-3">Sumber Video</th>
 <th className="py-2.5 px-3">Sumber Audio</th>
                  </tr>
                </thead>
 <tbody className="divide-y divide-border">
                  {(specs.broadcast?.runOfShow && specs.broadcast.runOfShow.length > 0
                    ? specs.broadcast.runOfShow
                    : [
 { time: "06:30", cue: "Staging, Cabling & Line Check", source: "All Cameras", audioCue: "Master Bus" },
 { time: "07:15", cue: "Opening Graphic Bumper & Countdown", source: "Cam 1 Master Wide", audioCue: "BGM In" },
 { time: "07:30", cue: "Prosesi Masuk Senat & Indonesia Raya", source: "Cam 2 Roving + Cam 1", audioCue: "Choir Mic" },
 { time: "09:00", cue: "Pemberian Ijazah per Fakultas", source: "Cam 3 Podium / Close-up", audioCue: "MC Podium" },
 { time: "12:00", cue: "Closing Bumper & Highlight Roll", source: "Media Player", audioCue: "BGM Fade Out" },
                      ]
                  ).map((cue, idx) => (
 <tr key={idx} className="hover:bg-[#fafafa]/50">
                      <td className="py-2.5 px-3 font-mono font-bold text-[#ff5a00]">
                        {cue.time}
                      </td>
 <td className="py-2.5 px-3 font-medium text-[#09090b]">
                        {cue.cue}
                      </td>
 <td className="py-2.5 px-3 font-mono text-[#52525b]">
                        {cue.source}
                      </td>
 <td className="py-2.5 px-3 font-mono text-[#52525b]">
 {cue.audioCue || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CASE B: COMMERCIAL VIDEO & POST-PRO PIPELINE */}
      {isVideo && (
 <div className="space-y-6">
        <div className="rounded-[36px] border border-[#ececee] bg-white p-6 space-y-4">
 <h4 className="font-bold tracking-tight text-lg text-[#09090b] border-b border-[#ececee]/80 pb-3 flex items-center gap-2">
              <Film size={18} className="text-[#3f3f46]" />
              <span>Target Deliverables &amp; Post-Production Log</span>
            </h4>

 <div className="grid sm:grid-cols-3 gap-4">
            <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4 space-y-2">
 <span className="text-[10px] font-mono text-[#71717a] block uppercase">
                  MASTER DELIVERABLES
                </span>
 <ul className="text-xs space-y-1.5 font-medium text-[#27272a]">
 <li className="flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-[#3f3f46]" /> Master 16:9 (4K UHD)
                  </li>
 <li className="flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-[#3f3f46]" /> Cutdown 9:16 (Reels/TikTok)
                  </li>
 <li className="flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-[#3f3f46]" /> Clean Feed (No Text)
                  </li>
                </ul>
              </div>

            <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4 space-y-2">
 <span className="text-[10px] font-mono text-[#71717a] block uppercase">
                  REVISI KLIEN (MAX 2 ROUNDS)
                </span>
 <div className="text-xs space-y-1">
 <p className="font-bold text-[#09090b]">
                    Round Saat Ini: {specs.video?.currentRevisionRound || 0} / {specs.video?.maxRevisionRounds || 2}
                  </p>
 <p className="text-[11px] text-[#71717a] ">
                    SLA Perputaran Revisi: 48 Jam kerja
                  </p>
                </div>
              </div>

            <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4 space-y-2">
 <span className="text-[10px] font-mono text-[#71717a] block uppercase">
                  STORYBOARD &amp; BRIEF
                </span>
 <p className="text-xs text-[#52525b] line-clamp-2">
 {specs.video?.creativeBriefNotes || "Cinematic color grade dengan pacing dinamis."}
                </p>
                {specs.video?.storyboardUrl && (
 <Button asChild variant="outline" size="sm" className="w-full text-xs">
 <a href={specs.video.storyboardUrl} target="_blank" rel="noreferrer">
                      Buka Storyboard Deck ↗
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CASE C: EVENT & GRADUATION PHOTO PROOFING */}
      {isPhoto && (
 <div className="space-y-6">
        <div className="rounded-[36px] border border-[#ececee] bg-white p-6 space-y-4">
 <h4 className="font-bold tracking-tight text-lg text-[#09090b] border-b border-[#ececee]/80 pb-3 flex items-center gap-2">
              <Camera size={18} className="text-[#3f3f46]" />
              <span>Client Proofing &amp; Quota Management</span>
            </h4>

 <div className="grid sm:grid-cols-3 gap-4">
            <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4 space-y-2">
 <span className="text-[10px] font-mono text-[#71717a] block uppercase">
                  KUOTA PILIHAN FOTO
                </span>
 <p className="font-bold text-xl text-[#09090b] font-mono">
                  {project.selection_quota_min} - {project.selection_quota_max} Foto
                </p>
 <p className="text-[11px] text-[#71717a] ">
 Status Kurasi: {project.selection_locked_at ? "🔒 Pilihan Terkunci" : "⏳ Sedang Dipilih"}
                </p>
              </div>

            <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4 space-y-2">
 <span className="text-[10px] font-mono text-[#71717a] block uppercase">
                  AKSES PIN GALERI
                </span>
 <p className="font-bold text-xl text-[#09090b] font-mono">
                  {project.gallery_code}
                </p>
 <p className="text-[11px] text-[#71717a] ">
                  PIN Rahasia: Aktif di database
                </p>
              </div>

            <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4 space-y-2">
 <span className="text-[10px] font-mono text-[#71717a] block uppercase">
                  DOWNLOAD HIGH-RES RESOLUTION
                </span>
 <div className="flex items-center gap-2">
                  {project.is_fully_paid ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-[#3f3f46] bg-[#fafafa] px-2 py-0.5 rounded-full border border-[#ececee]">
                      <Unlock size={12} /> Diizinkan (Lunas 100%)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-[#c2410c] bg-[#ff5a00]/10 px-2 py-0.5 rounded-full border border-[#ff5a00]/20">
                      <Lock size={12} /> Terkunci (Sisa Tagihan)
                    </span>
                  )}
                </div>
 <p className="text-[11px] text-[#71717a] ">
                  HTTP 402 Gate aktif hingga invoice lunas
                </p>
              </div>
            </div>
          </div>

          {/* Embedded Moodboard Review */}
          <div className="rounded-[36px] border border-[#ececee] bg-white p-6 space-y-4">
 <h4 className="font-bold tracking-tight text-lg text-[#09090b] border-b border-[#ececee]/80 pb-3">
              Review Visual Moodboard &amp; Arahan Gaya
            </h4>
            <MoodboardReview projectId={project.id} />
          </div>
        </div>
      )}
    </div>
  );
}
