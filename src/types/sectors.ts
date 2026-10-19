import { z } from "zod";

// Canonical Studio Sector Pillars
export type ServicePillarType =
 | "BROADCAST_LIVE_STREAMING"
 | "COMMERCIAL_VIDEO"
 | "EVENT_GRADUATION_PHOTO";

export const SERVICE_PILLARS = [
  {
 id: "BROADCAST_LIVE_STREAMING" as ServicePillarType,
 title: "Multi-Cam Broadcast & FOH",
 subtitle: "Live Streaming, Switcher & Signal Routing",
 badge: "01 / BROADCAST",
 color: "purple",
 accentClass: "border-purple-500/30 bg-purple-500/10 text-purple-400",
 badgeClass: "bg-purple-100 text-purple-800 border-purple-300 ",
 icon: "Radio",
 description: "Produksi siaran langsung wisuda, seminar nasional, konser musik & ibadah formal.",
  },
  {
 id: "COMMERCIAL_VIDEO" as ServicePillarType,
 title: "Commercial Video & Aftermovie",
 subtitle: "Pre-Pro, Storyboard & Pipeline Pasca-Produksi",
 badge: "02 / VIDEO",
 color: "blue",
 accentClass: "border-blue-500/30 bg-blue-500/10 text-blue-400",
 badgeClass: "bg-blue-100 text-blue-800 border-blue-300 ",
 icon: "Video",
 description: "Profil korporat, dokumentasi sinematik konser, iklan produk & social media reels.",
  },
  {
 id: "EVENT_GRADUATION_PHOTO" as ServicePillarType,
 title: "Event & Graduation Photography",
 subtitle: "Kurasi Foto, Kuota 15-20, & PIN Galeri Klien",
 badge: "03 / PHOTO",
 color: "amber",
 accentClass: "border-amber-500/30 bg-amber-500/10 text-amber-400",
 badgeClass: "bg-amber-100 text-amber-800 border-amber-300 ",
 icon: "Camera",
 description: "Sesi foto wisuda studio & on-location, dokumentasi formal instansi, dan proofing online.",
  },
] as const;

// 1. BROADCAST & FOH SPECIFICATIONS
export const BroadcastRunOfShowItemSchema = z.object({
  time: z.string(),
  cue: z.string(),
  source: z.string(),
  audioCue: z.string().optional(),
  notes: z.string().optional(),
});

export type BroadcastRunOfShowItem = z.infer<typeof BroadcastRunOfShowItemSchema>;

export const BroadcastSpecsSchema = z.object({
  signalFlow: z.object({
 switcher: z.string().default("vMix 4K Broadcast Console"),
 audio: z.string().default("Behringer X32 Producer Digital Mixer"),
 transmission: z.string().default("YouTube Live Stream 1080p60"),
 intercom: z.string().default("Hollyland Solidcom C1 Pro"),
    relayVideotron: z.string().optional(),
  }),
  runOfShow: z.array(BroadcastRunOfShowItemSchema).default([]),
  rehearsalDate: z.string().nullable().optional(),
  rehearsalCallTime: z.string().nullable().optional(),
 primaryPlatform: z.string().default("YouTube"),
  streamBackupEnabled: z.boolean().default(true),
  techNotes: z.string().optional(),
});

export type BroadcastSpecs = z.infer<typeof BroadcastSpecsSchema>;

// 2. COMMERCIAL VIDEO SPECIFICATIONS
export const VideoSpecsSchema = z.object({
  targetDeliverables: z.array(z.string()).default([
 "Master Commercial Cut 16:9 (ProRes 422 / 4K UHD)",
 "Social Cutdown 9:16 (Instagram Reels / TikTok)",
 "Clean Feed Master (Tanpa Grafis)",
  ]),
  maxRevisionRounds: z.number().default(2),
  currentRevisionRound: z.number().default(0),
  storyboardUrl: z.string().nullable().optional(),
  roughCutDeadline: z.string().nullable().optional(),
  finalDeliveryDeadline: z.string().nullable().optional(),
  creativeBriefNotes: z.string().optional(),
 aspectRatios: z.array(z.string()).default(["16:9", "9:16"]),
});

export type VideoSpecs = z.infer<typeof VideoSpecsSchema>;

// 3. EVENT & GRADUATION PHOTO SPECIFICATIONS
export const PhotoSpecsSchema = z.object({
  proofingQuotaMin: z.number().default(15),
  proofingQuotaMax: z.number().default(20),
  shotList: z.array(z.string()).default([
 "Prosesi Utama & Pemindahan Kuncir Toga",
 "Foto Bersama Rektorat & Dekanat",
 "Sesi Foto Keluarga di Backdrop",
 "Candid Reaksi Wisudawan & Orang Tua",
  ]),
  galleryCode: z.string().optional(),
  highResUnlocked: z.boolean().default(false),
  coverPhotoUrl: z.string().optional(),
});

export type PhotoSpecs = z.infer<typeof PhotoSpecsSchema>;

// Unified Project Sector Payload
export type ProjectSectorSpecs = {
  broadcast?: BroadcastSpecs;
  video?: VideoSpecs;
  photo?: PhotoSpecs;
  [key: string]: unknown;
};

export function getDefaultSectorSpecs(pillar: ServicePillarType): ProjectSectorSpecs {
  switch (pillar) {
 case "BROADCAST_LIVE_STREAMING":
      return {
        broadcast: {
          signalFlow: {
 switcher: "vMix 4K Broadcast Console",
 audio: "Behringer X32 Producer Digital Mixer",
 transmission: "YouTube Live Stream 1080p60 + Videotron Relay",
 intercom: "Hollyland Solidcom C1 Pro 4-Station",
 relayVideotron: "HDMI Fiber Optic 20m ke LED Processor",
          },
          runOfShow: [
 { time: "06:30", cue: "Staging, Cabling & Pairing Hollyland C1", source: "All Cameras", audioCue: "Line Check" },
 { time: "07:15", cue: "Standby Master Wide & Opening Bumper Graphic", source: "Cam 1 Master", audioCue: "BGM In" },
 { time: "07:30", cue: "Prosesi Masuk Senat & Lagu Indonesia Raya", source: "Cam 2 Roving + Cam 1", audioCue: "Master Mic" },
 { time: "09:00", cue: "Pemberian Ijazah per Fakultas (Close-up Panggung)", source: "Cam 3 Podium", audioCue: "MC Podium" },
 { time: "12:00", cue: "Closing Bumper & Highlight Montage Roll", source: "Media Player", audioCue: "BGM Fade Out" },
          ],
 primaryPlatform: "YouTube Live",
          streamBackupEnabled: true,
 techNotes: "Wajib sinkronisasi timecode audio dan video pada 59.94 fps.",
        },
      };
 case "COMMERCIAL_VIDEO":
      return {
        video: {
          targetDeliverables: [
 "Master Commercial Cut 16:9 (4K UHD / 24fps)",
 "Social Cutdown 9:16 (1080x1920 Instagram Reels/TikTok)",
 "Clean Feed Master (Tanpa Lower-Third & Text Grafis)",
          ],
          maxRevisionRounds: 2,
          currentRevisionRound: 0,
          storyboardUrl: null,
 creativeBriefNotes: "Tone warna: Cinematic Warm Charcoal dengan saturation terkontrol.",
 aspectRatios: ["16:9", "9:16"],
        },
      };
 case "EVENT_GRADUATION_PHOTO":
      return {
        photo: {
          proofingQuotaMin: 15,
          proofingQuotaMax: 20,
          shotList: [
 "Prosesi Utama & Pemindahan Kuncir Toga",
 "Foto Bersama Rektorat & Dekanat di Panggung",
 "Sesi Foto Formal Keluarga di Backdrop Studio",
 "Candid Wisudawan Terbaik & Reaksi Orang Tua",
 "Detail Atribut Toga, Samir & Plakat Penghargaan",
          ],
          highResUnlocked: false,
        },
      };
    default:
      return {};
  }
}
