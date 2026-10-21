"use client";

import { useState, useRef, useTransition } from "react";
import { ArrowRight, CheckCircle2, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitInquiryAction } from "@/app/actions/inquiry";

type PhotographyType =
  | ""
  | "wedding"
  | "prewedding"
  | "graduation"
  | "couple"
  | "event"
  | "other";

interface FormState {
  name: string;
  whatsapp: string;
  email: string;
  type: PhotographyType;
  date: string;
  message: string;
}

const TYPE_OPTIONS: { value: PhotographyType; label: string }[] = [
  { value: "", label: "Select a session type" },
  { value: "wedding", label: "Wedding" },
  { value: "prewedding", label: "Prewedding" },
  { value: "graduation", label: "Graduation" },
  { value: "couple", label: "Couple Session" },
  { value: "event", label: "Event" },
  { value: "other", label: "Other / Not sure yet" },
];

const EMPTY: FormState = {
  name: "",
  whatsapp: "",
  email: "",
  type: "",
  date: "",
  message: "",
};

/*
 * The contact form writes the lead to `inquiries` FIRST, then offers WhatsApp
 * as a follow-up.
 *
 * That order matters: opening WhatsApp was previously the only outcome, so a
 * client who closed the tab left no record anywhere. Persisting first means the
 * lead exists in the dashboard even if they never send the WhatsApp message.
 */
export type ContactPrefill = {
  packageId?: string;
  packageName?: string;
  /** Comma-separated `slug` or `slug:qty` pairs from the configurator. */
  addons?: string;
};

/**
 * Parse the configurator's `addons` param.
 *
 * Format is `slug` or `slug:qty`, comma-separated. The slug is the stable id
 * the pricelist uses; we keep it as the add-on `id` so the lead row can be
 * reconciled against `pricelist_addons` later without a fuzzy name match.
 */
function parseAddons(raw: string | undefined): { id: string; name: string; price_idr: number }[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((token) => token.split(":")[0]?.trim())
    .filter((slug): slug is string => Boolean(slug))
    .map((slug) => ({
      id: slug,
      name: slug.replace(/-/g, " "),
      /*
       * Price is not recoverable from the URL by design — the configurator shows
       * a live total but the authoritative price is re-read server-side at
       * quote time. 0 here means "chosen, price to confirm", never "free".
       */
      price_idr: 0,
    }));
}

export function ContactForm({ prefill }: { prefill?: ContactPrefill }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [sent, setSent] = useState<{ reference: string; waLink: string } | null>(null);
  const addons = parseAddons(prefill?.addons);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const firstInput = useRef<HTMLInputElement>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await submitInquiryAction({
        name: form.name,
        phone: form.whatsapp,
        email: form.email,
        /*
         * The public form asks about a *session type*, while `projects` groups
         * work by a three-value `service_pillar` CHECK constraint. Store the
         * real pillar name so conversion can pass it through unchanged instead
         * of guessing from free text later.
         */
        pillar:
          form.type === "event"
            ? "BROADCAST_LIVE_STREAMING"
            : "EVENT_GRADUATION_PHOTO",
        message: form.message,
        sourcePage: "/contact",
        eventType: form.type,
        eventDate: form.date,
        selectedPackageId: prefill?.packageId || undefined,
        selectedAddons: addons,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      setSent({ reference: result.reference, waLink: result.waLink });
    });
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-secondary">
          <CheckCircle2 size={28} />
        </div>
        <h2 className="font-serif text-3xl">Thank you.</h2>
        <p className="mt-4 max-w-sm text-muted-foreground">
          Your inquiry has reached our studio and someone will follow up within
          24 hours.
        </p>

        {sent.reference && (
          <div className="mt-6 rounded-lg border border-border bg-secondary/40 px-5 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Reference
            </p>
            <p className="mt-1 font-mono text-lg font-semibold tracking-wide">
              {sent.reference}
            </p>
          </div>
        )}

        <a
          href={sent.waLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <MessageCircle size={16} />
          Continue on WhatsApp
        </a>
        <p className="mt-3 max-w-xs text-xs text-muted-foreground">
          Faster replies — your message is pre-filled, just hit send.
        </p>

        <button
          onClick={() => {
            setSent(null);
            setForm(EMPTY);
            setTimeout(() => firstInput.current?.focus(), 50);
          }}
          className="mt-6 text-sm underline underline-offset-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/*
        Show what the client picked on /pricelist. Without this they arrive at a
        blank form with no confirmation that their package choice carried over,
        and re-type it into the message box — which is exactly the duplication
        the pipeline exists to remove.
      */}
      {prefill?.packageName && (
        <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Paket dipilih
          </p>
          <p className="mt-1 text-sm font-medium">{prefill.packageName}</p>
          {addons.length > 0 && (
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Add-on: {addons.map((a) => a.name).join(", ")}
            </p>
          )}
        </div>
      )}
      {/* Name */}
      <div className="space-y-2">
        <label htmlFor="contact-name" className="text-sm font-medium">
          Your name <span aria-hidden="true">*</span>
        </label>
        <input
          ref={firstInput}
          id="contact-name"
          name="name"
          type="text"
          required
          autoComplete="name"
          value={form.name}
          onChange={handleChange}
          placeholder="Full name"
          className="contact-input"
        />
      </div>

      {/* WhatsApp */}
      <div className="space-y-2">
        <label htmlFor="contact-whatsapp" className="text-sm font-medium">
          WhatsApp number <span aria-hidden="true">*</span>
        </label>
        <input
          id="contact-whatsapp"
          name="whatsapp"
          type="tel"
          required
          autoComplete="tel"
          value={form.whatsapp}
          onChange={handleChange}
          placeholder="+62 812 3456 7890"
          className="contact-input"
        />
      </div>

      {/* Email — optional, but the studio needs it for a formal quote. */}
      <div className="space-y-2">
        <label htmlFor="contact-email" className="text-sm font-medium">
          Email <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="contact-email"
          name="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={handleChange}
          placeholder="you@example.com"
          className="contact-input"
        />
      </div>

      {/* Type + Date */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="contact-type" className="text-sm font-medium">
            Photography type
          </label>
          <select
            id="contact-type"
            name="type"
            value={form.type}
            onChange={handleChange}
            className="contact-input"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="contact-date" className="text-sm font-medium">
            Preferred date
          </label>
          <input
            id="contact-date"
            name="date"
            type="date"
            value={form.date}
            onChange={handleChange}
            className="contact-input"
          />
        </div>
      </div>

      {/* Message */}
      <div className="space-y-2">
        <label htmlFor="contact-message" className="text-sm font-medium">
          Message <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="contact-message"
          name="message"
          rows={4}
          required
          value={form.message}
          onChange={handleChange}
          placeholder="Tell us a little about what you have in mind…"
          className="contact-input resize-none"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={
          pending || !form.name.trim() || !form.whatsapp.trim() || form.message.trim().length < 10
        }
        className="w-full sm:w-auto"
      >
        {pending ? (
          <>
            <Loader2 className="animate-spin" /> Sending…
          </>
        ) : (
          <>
            Send Inquiry <ArrowRight />
          </>
        )}
      </Button>
      <p className="text-xs text-muted-foreground">
        We&apos;ll save your inquiry and give you a reference number. You can
        also continue the conversation on WhatsApp straight away.
      </p>
    </form>
  );
}
