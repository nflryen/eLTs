import type { Metadata } from "next";
import Image from "next/image";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { Calendar, Video, MessageCircle } from "lucide-react";

/**
 * Proof-of-work strip.
 *
 * The booking page previously carried no imagery at all — a photography studio
 * asking for a meeting without showing a single frame of its work. These are
 * the same public, already-downsized previews the portfolio uses; no client
 * media is referenced.
 */
const PROOF_SHOTS = [
  { src: "/images/wedding.webp", alt: "Wedding ceremony coverage" },
  { src: "/images/graduation.webp", alt: "Graduation portrait session" },
  { src: "/images/event.webp", alt: "Event and broadcast coverage" },
  { src: "/images/prewedding.webp", alt: "Prewedding session" },
] as const;

export const metadata: Metadata = {
  title: "Book a Consultation — Elts. Studio Scheduler",
  description:
    "Schedule a Discovery Call or Creative Briefing with the ELTs. Studio team in Purwokerto, online via Google Meet.",
  alternates: { canonical: "/booking" },
};

export default function BookingPage() {
  return (
    <main id="main-content" className="min-h-screen pb-24 pt-16 sm:pt-20">
      <div className="site-container">
        {/* Hero Section */}
        <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
          <p className="eyebrow text-xs">ELTs. Studio Scheduling</p>
          <h1 className="mt-4 text-[clamp(32px,4.6vw,56px)] font-semibold leading-[1.12] tracking-[-0.02em] text-[var(--color-obsidian)]">
            Schedule your creative session.
          </h1>
          <p className="mt-4 text-sm sm:text-base text-muted-foreground leading-relaxed">
            Pick a time to talk directly with the ELTs. creative and technical
            team in Purwokerto. Your booking syncs automatically to Google
            Calendar and Google Meet.
          </p>
        </div>

        {/* Proof-of-work strip */}
        <div className="mb-12 grid grid-cols-2 gap-3 sm:mb-16 sm:grid-cols-4 sm:gap-4">
          {PROOF_SHOTS.map((shot, i) => (
            <div
              key={shot.src}
              className="relative aspect-[4/5] overflow-hidden bg-zinc-100"
            >
              <Image
                src={shot.src}
                alt={shot.alt}
                fill
                sizes="(max-width: 640px) 50vw, 25vw"
                // First image is above the fold on mobile: load it eagerly so
                // the strip is present at first paint.
                priority={i === 0}
                className="object-cover"
              />
            </div>
          ))}
        </div>

        {/* Booking Wizard Interactive Container */}
        <div className="rounded-[var(--radius-cards)] border border-[var(--color-cloud)] bg-[var(--color-snow)] p-[var(--card-padding)] sm:p-10">
          <BookingWizard />
        </div>

        {/* Feature & Trust Highlights */}
        <div className="mt-16 grid gap-6 sm:grid-cols-3 border-t border-border pt-12">
          <div className="flex items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
              <Calendar size={18} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Live Google Calendar Sync
              </h3>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                Your chosen slot is automatically protected to avoid conflicts or double-booking with the studio calendar.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
              <Video size={18} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Instant Google Meet Link
              </h3>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                A video conference room link is created the moment your booking completes, so you can join as soon as it starts.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
              <MessageCircle size={18} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                WhatsApp Confirmation
              </h3>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                Connected directly to the ELTs. Studio operations team on WhatsApp for quick assistance and schedule reminders.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
