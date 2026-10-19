export interface LiveStreamingPackage {
  id: "budget" | "basic" | "standard" | "pro" | "hybrid";
  name: string;
  tagline: string;
  price: number;
  camCount: number;
  camSpecs: string;
  connection: string;
  output: string;
  crewCount: number;
  crewDetails: string;
  software: string;
  audio?: string;
  suitableFor: string;
  maxDurationHours: number;
  bestValue?: boolean;
}

export interface StreamingAddon {
  id: string;
  name: string;
  price: number;
  unit: string;
  description: string;
  popular?: boolean;
}

export interface EventPackage {
  id: string;
  name: string;
  category: "event" | "graduation";
  price: number;
  crew: string;
  deliverables: string[];
  description: string;
  duration: string;
  bestValue?: boolean;
}

export const LIVE_STREAMING_PACKAGES: LiveStreamingPackage[] = [
  {
    id: "budget",
    name: "Paket Budget (Single Cam)",
    tagline: "Ekonomis & Ringkas",
    price: 1000000,
    camCount: 1,
    camSpecs: "1 Kamera Full HD (Statis / Steady)",
    connection: "Wired (HDMI High-Speed)",
    output: "1 Output (Live Streaming YouTube / Platform Pilihan)",
    crewCount: 2,
    crewDetails: "1 Operator Switcher/Streaming, 1 Cameraman Standby",
    software: "OBS Studio (Upgrade vMix: +Rp 100.000)",
    suitableFor: "Acara durasi ringkas, kuliah umum, webinar sederhana, atau event anggaran terbatas.",
    maxDurationHours: 4,
    bestValue: false,
  },
  {
    id: "basic",
    name: "Paket Basic (Dual-Cam Statis)",
    tagline: "Dua Sudut Lebih Dinamis",
    price: 1400000,
    camCount: 2,
    camSpecs: "2 Kamera Full HD (2 Statis / Steady - Wide & Medium Angle)",
    connection: "Full Wired (HDMI)",
    output: "Dual Output (Live Streaming + Relay Screen Videotron)",
    crewCount: 2,
    crewDetails: "1 Operator Switcher/Streaming, 1 Cameraman",
    software: "OBS Studio (Upgrade vMix: +Rp 100.000)",
    suitableFor: "Kajian, seminar formal, ibadah, atau seremoni standar dengan panggung terpusat.",
    maxDurationHours: 4,
    bestValue: false,
  },
  {
    id: "standard",
    name: "Paket Standard (Dynamic Dual-Cam)",
    tagline: "Interaktif dengan Wireless Roving",
    price: 1700000,
    camCount: 2,
    camSpecs: "2 Kamera Full HD (1 Statis Master Wide + 1 Mobile Wireless)",
    connection: "Hybrid (Wired HDMI + Wireless Transmitter Hollyland)",
    output: "Dual Output (Live Streaming + Relay Screen Videotron)",
    crewCount: 2,
    crewDetails: "1 Operator Switcher/Streaming, 1 Cameraman Mobile Roving",
    software: "OBS Studio (Upgrade vMix: +Rp 100.000)",
    suitableFor: "Talkshow interaktif, workshop, atau seminar yang butuh sorotan tanya-jawab audiens.",
    maxDurationHours: 4,
    bestValue: false,
  },
  {
    id: "pro",
    name: "Paket Pro (Triple-Cam Multi-Angle)",
    tagline: "Standar Broadcast TV & Konser",
    price: 2499000,
    camCount: 3,
    camSpecs: "3 Kamera Full HD (1 Master Wide Statis, 1 Tight Angle, 1 Mobile Wireless)",
    connection: "Hybrid (HDMI Wired + Wireless Hollyland)",
    output: "Dual Output (Live Streaming Full HD + Relay Screen Videotron)",
    crewCount: 3,
    crewDetails: "1 Show Director / Switcher OP, 2 Cameramen",
    software: "vMix Pro (Sudah Include)",
    audio: "Direct audio feed via Professional Audio Interface",
    suitableFor: "Seminar nasional, wisuda kampus, festival panggung akbar, konser, atau gathering akbar.",
    maxDurationHours: 4,
    bestValue: true,
  },
  {
    id: "hybrid",
    name: "Paket Hybrid (Interactive Zoom + Live)",
    tagline: "Sinkronisasi Dua Arah Panggung ⇄ Zoom",
    price: 3400000,
    camCount: 3,
    camSpecs: "3 Kamera Full HD (2 Statis + 1 Mobile Wireless Hollyland)",
    connection: "Hybrid Broadcast Infrastructure",
    output: "Multi-Output (Zoom Webinar/Meeting + Live Streaming YouTube + Relay Videotron)",
    crewCount: 4,
    crewDetails: "1 Video Switcher, 1 Zoom & Audio Mix-Minus Engineer, 2 Cameramen",
    software: "vMix Pro (Sudah Include)",
    audio: "Sinkronisasi 2 arah bebas gaung/echo (Stage Sound ⇄ Zoom Audio)",
    suitableFor: "Konferensi internasional hybrid, seminar dengan pembicara daring, atau pelantikan.",
    maxDurationHours: 4,
    bestValue: false,
  },
];

export const STREAMING_ADDONS: StreamingAddon[] = [
  {
    id: "vmix-upgrade",
    name: "Upgrade Software ke vMix Pro",
    price: 100000,
    unit: "event",
    description: "Animated lower-third, scoreboard, multiple instant replays, dan transisi broadcast halus (khusus Paket Budget, Basic, & Standard).",
    popular: true,
  },
  {
    id: "extra-mobile-cam",
    name: "Penambahan Kamera Mobile + Operator + Wireless Hollyland",
    price: 750000,
    unit: "kamera",
    description: "1 unit kamera Full HD tambahan, wireless video transmitter Hollyland, dan 1 juru kamera standby.",
    popular: true,
  },
  {
    id: "backup-internet",
    name: "Dedicated Backup Internet (Telkomsel Orbit / Multi-SIM Failover)",
    price: 300000,
    unit: "event",
    description: "Router 4G/5G cadangan prioritas tinggi menjaga siaran tetap mengudara tanpa putus jika koneksi kabel venue bermasalah.",
    popular: true,
  },
  {
    id: "intercom",
    name: "Intercom System Crew (Hollyland Solidcom Wireless)",
    price: 200000,
    unit: "event",
    description: "Sistem komunikasi wireless duplex tanpa delay antara Director di meja operator dan semua cameraman di lapangan.",
  },
  {
    id: "highlight-reels",
    name: "Video Highlight Acara 60 Detik (Reels / TikTok Vertikal)",
    price: 350000,
    unit: "video",
    description: "Editing cepat klip dokumentasi terbaik berdurasi 1 menit dengan color grading dan musik berlisensi untuk diposting H+1.",
    popular: true,
  },
  {
    id: "overtime",
    name: "Overtime Siaran / Standby Kru",
    price: 150000,
    unit: "jam",
    description: "Biaya penambahan per jam apabila durasi acara melebihi batas 4 jam sesi utama.",
  },
];

export const EVENT_PACKAGES: EventPackage[] = [
  {
    id: "event-photo",
    name: "Dokumentasi Foto Event",
    category: "event",
    price: 1200000,
    crew: "1 Fotografer Profesional",
    duration: "Maksimal 6 Jam",
    deliverables: [
      "Semua file foto original (RAW/JPEG Full Res)",
      "50 Foto pilihan diedit (Color Grading & Tone)",
      "Pengiriman via Google Drive Private H+2",
    ],
    description: "Liputan foto menyeluruh untuk seminar, gathering kantor, festival musik, atau peresmian.",
  },
  {
    id: "event-video",
    name: "Video Dokumentasi Sinematik",
    category: "event",
    price: 1800000,
    crew: "1 Videografer + Gimbal Stabilizer",
    duration: "Maksimal 6 Jam",
    deliverables: [
      "1 Video Highlight Teaser 60 Detik (Format Reels/9:16)",
      "1 Video Dokumentasi Lengkap (3–5 Menit, 4K Master)",
      "Audio recording feed langsung dari panggung",
      "Color grading sinematik & sound design",
    ],
    description: "Kompilasi video berkelas yang merangkum dinamika dan kemeriahan acara Anda.",
  },
  {
    id: "event-combo",
    name: "Paket Combo Event (Foto + Video)",
    category: "event",
    price: 2800000,
    crew: "1 Fotografer + 1 Videografer",
    duration: "Maksimal 8 Jam",
    deliverables: [
      "Liputan lengkap foto & video dari awal hingga selesai",
      "Semua foto original + 80 foto edited",
      "1 Teaser Reels (60 dtk) + 1 Aftermovie Full (3–5 mnt)",
      "Pengiriman express Google Drive Cloud",
    ],
    description: "Solusi dokumentasi lengkap dan hemat untuk acara berskala menengah hingga besar.",
    bestValue: true,
  },
];

export const GRADUATION_PACKAGES: EventPackage[] = [
  {
    id: "grad-solo",
    name: "Wisuda Solo / Personal",
    category: "graduation",
    price: 450000,
    crew: "1 Fotografer",
    duration: "1 Jam Sesi Pemotretan",
    deliverables: [
      "Unlimited shots selama sesi",
      "Semua file foto mentah dikirim H+0",
      "15 Foto pilihan diedit premium tone",
      "Lokasi kampus / spot favorit di Purwokerto",
    ],
    description: "Abadikan momen sakral wisudamu dengan arahan pose luwes dan tone warna elegan.",
  },
  {
    id: "grad-group",
    name: "Wisuda Rombongan (Group 3–8 Orang)",
    category: "graduation",
    price: 850000,
    crew: "1 Fotografer + Lighting Kit Outdoor",
    duration: "2 Jam Sesi Pemotretan",
    deliverables: [
      "Unlimited shots bersama & bergantian per orang",
      "Semua file mentah dibagikan",
      "35 Foto pilihan diedit premium",
      "Sesi foto bersama sahabat/keluarga",
    ],
    description: "Momen wisuda beramai-ramai bersama circle terdekat, ceria, rapi, dan berkesan.",
    bestValue: true,
  },
  {
    id: "grad-cinematic",
    name: "Wisuda Sinematik (Foto + Video Reels)",
    category: "graduation",
    price: 1250000,
    crew: "1 Fotografer + 1 Videografer",
    duration: "2 Jam Sesi Pemotretan",
    deliverables: [
      "Paket foto lengkap (Semua mentah + 25 edit)",
      "1 Video Cinematic Graduation (30–60 detik, 4K vertical)",
      "Sound design narasi & lagu favorit",
    ],
    description: "Paket lengkap untuk kenangan wisuda yang hidup selamanya di galeri dan media sosial.",
  },
];

export const OPERATIONAL_TERMS = {
  durationNotice: "Seluruh paket live streaming berlaku untuk durasi acara maksimal 4 jam (1 sesi). Kelebihan waktu dikenakan biaya overtime Rp 150.000 / jam.",
  internetResponsibility: "Pihak penyelenggara atau venue bertanggung jawab menyediakan koneksi internet utama berupa kabel LAN minimal 20–50 Mbps upload & download simetris. ELTs. menyediakan modem backup failover melalui menu Add-on.",
  electricityAndFOH: "Penyelenggara wajib menyediakan meja kerja yang aman di dekat FOH (Front of House) dan titik colokan listrik stabil dengan daya minimal 1.000 Watt.",
  audioFeed: "Sinyal audio broadcast utama diambil dari master output mixer sound system yang disediakan oleh vendor tata suara acara.",
  bookingAndPayment: "Tanggal pelaksanaan dikunci secara resmi setelah pembayaran Down Payment (DP) minimal 30%–50%. Pelunasan dilakukan H-1 atau maksimal tepat setelah acara selesai.",
  coverageArea: "Melayani area Purwokerto & Kabupaten Banyumas tanpa biaya transport. Area luar kota (Purbalingga, Cilacap, Kebumen, Banjarnegara) dikenakan penyesuaian biaya akomodasi/transportasi ramah kantong.",
};

export const TERMS_AND_CONDITIONS: string[] = [
  OPERATIONAL_TERMS.durationNotice,
  OPERATIONAL_TERMS.internetResponsibility,
  OPERATIONAL_TERMS.electricityAndFOH,
  OPERATIONAL_TERMS.audioFeed,
  OPERATIONAL_TERMS.bookingAndPayment,
  OPERATIONAL_TERMS.coverageArea,
];
