"use client";

import { useState, useRef } from "react";
import { ArrowRight, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { site } from "@/config/site";

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

function buildWhatsAppMessage(form: FormState): string {
  const lines = [
    `Hello Elts.! I'd like to inquire about a photography session.`,
    ``,
    `Name: ${form.name}`,
    `WhatsApp: ${form.whatsapp}`,
    form.type ? `Session Type: ${form.type.charAt(0).toUpperCase() + form.type.slice(1)}` : null,
    form.date ? `Preferred Date: ${form.date}` : null,
    form.message ? `\nMessage:\n${form.message}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

export function ContactForm() {
  const [form, setForm] = useState<FormState>({
    name: "",
    whatsapp: "",
    type: "",
    date: "",
    message: "",
  });
  const [sent, setSent] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const message = buildWhatsAppMessage(form);
    const url = `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-secondary">
          <MessageCircle size={28} />
        </div>
        <h2 className="font-serif text-3xl">On its way.</h2>
        <p className="mt-4 max-w-sm text-muted-foreground">
          We&apos;ve opened WhatsApp with your message pre-filled. Send it and
          we&apos;ll be in touch soon.
        </p>
        <button
          onClick={() => {
            setSent(false);
            setForm({ name: "", whatsapp: "", type: "", date: "", message: "" });
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
          Message
        </label>
        <textarea
          id="contact-message"
          name="message"
          rows={4}
          value={form.message}
          onChange={handleChange}
          placeholder="Tell us a little about what you have in mind…"
          className="contact-input resize-none"
        />
      </div>

      <Button
        type="submit"
        disabled={!form.name.trim() || !form.whatsapp.trim()}
        className="w-full sm:w-auto"
      >
        Send Inquiry <ArrowRight />
      </Button>
      <p className="text-xs text-muted-foreground">
        Submitting will open WhatsApp with your message pre-filled.
      </p>
    </form>
  );
}
