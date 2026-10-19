import type { PhotographyService, PortfolioImage } from "@/types/portfolio";

// Public sample imagery only. Replace with approved Elts. work before public launch.
export const services: PhotographyService[] = [
  {
    id: "wedding",
    title: "Wedding",
    description: "Timeless love stories",
    image: "/images/wedding.webp",
    alt: "Bride and groom sharing a quiet moment on their wedding day",
  },
  {
    id: "prewedding",
    title: "Prewedding",
    description: "Celebrate your journey",
    image: "/images/prewedding.webp",
    alt: "Couple embracing beside the water",
  },
  {
    id: "graduation",
    title: "Graduation",
    description: "A new beginning",
    image: "/images/graduation.webp",
    alt: "Graduate in a cap and gown, photographed in black and white",
  },
  {
    id: "couple",
    title: "Couple",
    description: "Moments together",
    image: "/images/couple.webp",
    alt: "An intimate portrait of a couple together",
  },
  {
    id: "event",
    title: "Event",
    description: "Every moment matters",
    image: "/images/event.webp",
    alt: "Guests gathered for a beautifully lit celebration",
  },
];

export const featuredWorks: PortfolioImage[] = [
  {
    id: "quiet-promises",
    src: "/images/hands.webp",
    title: "The little things",
    alt: "Close-up of a bride and groom holding hands",
    category: "wedding",
  },
  {
    id: "forever-begins",
    src: "/images/hero.webp",
    title: "Where forever begins",
    alt: "Bride and groom surrounded by a sunlit landscape",
    category: "wedding",
  },
  {
    id: "just-us",
    src: "/images/wedding.webp",
    title: "Just the two of us",
    alt: "A warm, intimate wedding portrait",
    category: "wedding",
  },
  {
    id: "a-world-of-our-own",
    src: "/images/hillside.webp",
    title: "A world of our own",
    alt: "Bride and groom walking across a hillside",
    category: "prewedding",
  },
  {
    id: "by-the-water",
    src: "/images/prewedding.webp",
    title: "Somewhere with you",
    alt: "Couple standing together on a wooden dock",
    category: "couple",
  },
];

// Full portfolio gallery — each image maps to a filter category.
export const portfolioGallery: PortfolioImage[] = [
  {
    id: "pg-01",
    src: "/images/hero.webp",
    title: "Where forever begins",
    alt: "Bride and groom in a sunlit landscape",
    category: "wedding",
    aspect: "landscape",
  },
  {
    id: "pg-02",
    src: "/images/wedding.webp",
    title: "Just the two of us",
    alt: "An intimate wedding portrait",
    category: "wedding",
    aspect: "portrait",
  },
  {
    id: "pg-03",
    src: "/images/hands.webp",
    title: "Quiet promises",
    alt: "Bride and groom holding hands",
    category: "wedding",
    aspect: "square",
  },
  {
    id: "pg-04",
    src: "/images/bride.webp",
    title: "Before she walks in",
    alt: "Bride in a quiet, reflective moment",
    category: "wedding",
    aspect: "portrait",
  },
  {
    id: "pg-05",
    src: "/images/hillside.webp",
    title: "A world of our own",
    alt: "Couple walking across an open hillside",
    category: "prewedding",
    aspect: "landscape",
  },
  {
    id: "pg-06",
    src: "/images/prewedding.webp",
    title: "Somewhere with you",
    alt: "Couple together on a wooden dock",
    category: "couple",
    aspect: "portrait",
  },
  {
    id: "pg-07",
    src: "/images/graduation.webp",
    title: "A new chapter",
    alt: "Graduate in a cap and gown",
    category: "graduation",
    aspect: "portrait",
  },
  {
    id: "pg-08",
    src: "/images/couple.webp",
    title: "Side by side",
    alt: "An intimate couple portrait",
    category: "couple",
    aspect: "square",
  },
  {
    id: "pg-09",
    src: "/images/event.webp",
    title: "Every moment matters",
    alt: "Guests at a beautifully lit event",
    category: "event",
    aspect: "landscape",
  },
];

export interface ServiceDetail {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  philosophy: string;
  image: string;
  alt: string;
  whatsappService: string;
  includes: string[];
}

export const servicesDetail: ServiceDetail[] = [
  {
    id: "wedding",
    title: "Wedding Photography",
    subtitle: "Timeless love stories",
    description:
      "Your wedding day is one of the most significant chapters of your life. We document it with intention — the tender glances, the nervous laughs, the tears of joy. Every image tells the truth of how the day actually felt.",
    philosophy:
      "We believe wedding photography should feel effortless. Our approach is quiet and observational — we blend into your day so that what remains are images that feel genuinely yours.",
    image: "/images/hero.webp",
    alt: "Bride and groom sharing an intimate moment in a sunlit landscape",
    whatsappService: "Wedding Photography",
    includes: [
      "Full-day coverage",
      "Ceremony & reception",
      "Candid & portrait sessions",
      "Private client gallery",
      "High-resolution edited images",
      "Print-ready files",
    ],
  },
  {
    id: "prewedding",
    title: "Prewedding Photography",
    subtitle: "Celebrate your journey",
    description:
      "Before the vows, there's the story of how you got here. Prewedding sessions capture the warmth of your relationship in a relaxed, unhurried setting — just the two of you, as you are.",
    philosophy:
      "We choose locations and light that reflect your story. No forced poses, no awkward direction. Just genuine moments between two people who chose each other.",
    image: "/images/hillside.webp",
    alt: "Couple walking together across an open hillside at golden hour",
    whatsappService: "Prewedding Photography",
    includes: [
      "Location scouting guidance",
      "2–4 hour session",
      "Multiple outfit changes",
      "Edited gallery delivery",
      "Private online gallery",
      "Print-ready files",
    ],
  },
  {
    id: "graduation",
    title: "Graduation Photography",
    subtitle: "A new beginning",
    description:
      "Years of hard work, sleepless nights, and perseverance — culminating in one day. Graduation photography honours not just the achievement, but the person who made it happen.",
    philosophy:
      "We capture both the milestone and the person behind it. Whether formal, editorial, or candid, your graduation portraits will reflect exactly who you are at this moment in time.",
    image: "/images/graduation.webp",
    alt: "Graduate photographed in cap and gown against a clean backdrop",
    whatsappService: "Graduation Photography",
    includes: [
      "Indoor & outdoor portraits",
      "Individual & group shots",
      "Campus or custom location",
      "Edited portrait collection",
      "Private gallery access",
      "Digital download files",
    ],
  },
  {
    id: "couple",
    title: "Couple Sessions",
    subtitle: "Moments together",
    description:
      "Love doesn't need an occasion. Couple sessions are for anyone who wants to celebrate their relationship — whether it's a first anniversary, a birthday, or simply a Tuesday.",
    philosophy:
      "We create space for you to just be yourselves. The best couple portraits aren't directed — they happen when two people feel at ease and we're there to catch it.",
    image: "/images/prewedding.webp",
    alt: "A couple sharing a quiet moment together near the water",
    whatsappService: "Couple Session",
    includes: [
      "1–2 hour session",
      "Outdoor or indoor setting",
      "Relaxed, candid direction",
      "Edited portrait collection",
      "Private gallery access",
      "Digital download files",
    ],
  },
  {
    id: "event",
    title: "Event Photography",
    subtitle: "Every moment matters",
    description:
      "From intimate gatherings to large celebrations, events are full of fleeting moments that deserve to be captured. We document the energy, the people, and the details that make each event unique.",
    philosophy:
      "Event photography requires presence and instinct. We move quietly through the space, documenting the atmosphere and the connections — the things you'll want to remember long after the night is over.",
    image: "/images/event.webp",
    alt: "Guests gathered at a beautifully decorated event space",
    whatsappService: "Event Photography",
    includes: [
      "Coverage for full event duration",
      "Candid & documentary style",
      "Key moments & details",
      "Edited photo delivery",
      "Private client gallery",
      "Digital download files",
    ],
  },
];
