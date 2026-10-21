"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Calendar as CalendarIcon,
  Clock,
  Video,
  User,
  Phone,
  Mail,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  Sparkles,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAvailableSlots, bookStudioEventAction } from "@/app/actions/booking";
import type {
  BookingConfirmationDetails,
  BookingOption,
  BookingSlot,
  PublicBookingType,
} from "@/types/calendar";

const BOOKING_OPTIONS: BookingOption[] = [
  {
    type: "DISCOVERY_CALL",
    title: "15-min Discovery Call",
    durationMinutes: 15,
    description:
      "Sesi konsultasi cepat untuk mendiskusikan kebutuhan visual event, paket layanan, estimasi anggaran, dan timeline secara santai namun terarah.",
    badge: "Eksplorasi Awal",
    mode: "Online via Google Meet",
  },
  {
    type: "PRE_PRODUCTION",
    title: "45-min Technical & Creative Briefing",
    durationMinutes: 45,
    description:
      "Sesi mendalam bersama tim kreatif ELTs. untuk membedah breakdown konsep, moodboard, rundown teknis live streaming, atau rancangan digital lab.",
    badge: "Perencanaan Matang",
    mode: "Online via Google Meet",
  },
];

const SERVICE_PILLARS = [
  {
    id: "Pictures Event/Graduation",
    label: "Pictures (Event & Wisuda)",
    desc: "Dokumentasi visual, photo session, graduation, dan commercial event.",
  },
  {
    id: "Broadcast Live Stream",
    label: "Broadcast & Live Streaming",
    desc: "Multi-camera streaming broadcast, hybrid event, switcher & audio routing.",
  },
  {
    id: "Digital Lab",
    label: "Digital Lab & Solutions",
    desc: "Web platform kustom, interactive displays, dan integrasi digital studio.",
  },
] as const;

export function BookingWizard() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: Event Type Selection
  const [selectedType, setSelectedType] =
    useState<PublicBookingType>("DISCOVERY_CALL");

  // Step 2: Date & Slot Selection
  const getTomorrowString = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  };

  const [selectedDate, setSelectedDate] = useState<string>(getTomorrowString());
  const [availableSlots, setAvailableSlots] = useState<BookingSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [isLoadingSlots, setIsLoadingSlots] = useState<boolean>(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  // Step 3: Form Information
  const [fullName, setFullName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [servicePillar, setServicePillar] = useState<
    "Pictures Event/Graduation" | "Broadcast Live Stream" | "Digital Lab"
  >("Pictures Event/Graduation");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Step 4: Submission & Confirmation
  const [isSubmitting, startSubmitTransition] = useTransition();
  const [confirmation, setConfirmation] =
    useState<BookingConfirmationDetails | null>(null);
  const [isCopiedMeet, setIsCopiedMeet] = useState(false);

  // Fetch available slots when selected date or event type changes
  useEffect(() => {
    let isMounted = true;
    async function loadSlots() {
      setIsLoadingSlots(true);
      setSlotsError(null);
      setSelectedSlot(null);

      const duration = selectedType === "DISCOVERY_CALL" ? 15 : 45;
      const res = await getAvailableSlots(selectedDate, duration);

      if (!isMounted) return;
      setIsLoadingSlots(false);

      if (res.success) {
        setAvailableSlots(res.slots);
      } else {
        setSlotsError(res.error || "Gagal memuat slot jadwal.");
        setAvailableSlots([]);
      }
    }

    loadSlots();
    return () => {
      isMounted = false;
    };
  }, [selectedDate, selectedType]);

  const activeOption = BOOKING_OPTIONS.find((opt) => opt.type === selectedType)!;

  // Format readable Indonesian Date
  const formatReadableDate = (dateStr: string) => {
    try {
      const [year, month, day] = dateStr.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      return new Intl.DateTimeFormat("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(date);
    } catch {
      return dateStr;
    }
  };

  // Quick dates (Today, Tomorrow, +2 days, etc.)
  const generateQuickDates = () => {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      const isToday = i === 0;
      const isTomorrow = i === 1;

      const label = isToday
        ? "Hari Ini"
        : isTomorrow
          ? "Besok"
          : new Intl.DateTimeFormat("id-ID", { weekday: "short" }).format(d);

      const dayNum = d.getDate();
      const monthShort = new Intl.DateTimeFormat("id-ID", {
        month: "short",
      }).format(d);

      dates.push({ dateStr, label, dayNum, monthShort });
    }
    return dates;
  };

  const quickDates = generateQuickDates();

  function handleProceedToDetails() {
    if (!selectedSlot) {
      setSlotsError("Silakan pilih jam pertemuan yang tersedia.");
      return;
    }
    setSlotsError(null);
    setStep(3);
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (fullName.trim().length < 2) {
      setFormError("Nama lengkap minimal 2 karakter.");
      return;
    }

    const cleanWa = whatsapp.replace(/\D/g, "");
    if (cleanWa.length < 8) {
      setFormError("Nomor WhatsApp minimal 8 digit angka.");
      return;
    }

    if (email && !email.includes("@")) {
      setFormError("Format email tidak valid.");
      return;
    }

    startSubmitTransition(async () => {
      const res = await bookStudioEventAction({
        eventType: selectedType,
        date: selectedDate,
        timeSlot: selectedSlot!,
        fullName: fullName.trim(),
        whatsapp: cleanWa,
        email: email.trim(),
        servicePillar,
        notes: notes.trim(),
      });

      if (res.success && res.confirmation) {
        setConfirmation(res.confirmation);
        setStep(4);
      } else {
        setFormError(res.error || "Gagal memesan sesi meeting. Silakan coba lagi.");
      }
    });
  }

  const handleCopyMeet = () => {
    if (confirmation?.meetLink) {
      navigator.clipboard.writeText(confirmation.meetLink);
      setIsCopiedMeet(true);
      setTimeout(() => setIsCopiedMeet(false), 2000);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* Step Progress Header */}
      {step < 4 && (
        <div className="mb-10">
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            <span className={step >= 1 ? "text-foreground font-semibold" : ""}>
              1. Sesi & Topik
            </span>
            <span className="mx-2 text-border">/</span>
            <span className={step >= 2 ? "text-foreground font-semibold" : ""}>
              2. Tanggal & Jam
            </span>
            <span className="mx-2 text-border">/</span>
            <span className={step >= 3 ? "text-foreground font-semibold" : ""}>
              3. Data Pemesan
            </span>
          </div>
          <div className="h-1 w-full bg-secondary overflow-hidden rounded-full">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${(step / 3) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* STEP 1: Select Event Type */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="border-b border-border pb-5">
            <p className="eyebrow text-xs">Langkah 1 dari 3</p>
            <h2 className="text-2xl sm:text-3xl mt-1 text-foreground">
              Pilih Jenis Pertemuan Studio
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Tentukan format konsultasi yang paling cocok dengan tahap proyek
              kreatif Anda.
            </p>
          </div>

          {/*
            Rendered as a radio group rather than divs with onClick.

            The previous markup was keyboard-inaccessible: a <div> with onClick
            is not focusable and exposes no role, so a keyboard or screen-reader
            user could not choose a session type and the flow dead-ended at
            step 1. `role="radiogroup"` + `<button role="radio">` gives arrow-key
            browsing, a focus ring and an announced selected state for free.
          */}
          <div role="radiogroup" aria-label="Jenis pertemuan studio" className="grid gap-4 md:grid-cols-2">
            {BOOKING_OPTIONS.map((option) => {
              const isSelected = selectedType === option.type;
              return (
                <button
                  key={option.type}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setSelectedType(option.type)}
                  className={`group relative cursor-pointer rounded-[var(--radius-buttons)] border p-6 text-left transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#09090b] focus-visible:ring-offset-2 ${
                    isSelected
                      ? "border-[#09090b] bg-[#fafafa]"
                      : "border-border bg-white hover:border-muted-foreground/40 hover:bg-secondary/15"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-foreground">
                      <Sparkles size={12} className="text-muted-foreground" />
                      {option.badge}
                    </span>
                    <div
                      className={`flex size-5 items-center justify-center rounded-full border transition-colors ${
                        isSelected
                          ? "border-primary bg-primary text-white"
                          : "border-border group-hover:border-muted-foreground"
                      }`}
                    >
                      {isSelected && <Check size={12} strokeWidth={3} />}
                    </div>
                  </div>

                  <h3 className="mt-4 text-xl text-foreground">
                    {option.title}
                  </h3>

                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {option.description}
                  </p>

                  <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-border/60 pt-4 text-xs text-foreground/80">
                    <span className="flex items-center gap-1.5">
                      <Clock size={14} className="text-muted-foreground" />
                      {option.durationMinutes} Menit
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Video size={14} className="text-muted-foreground" />
                      {option.mode}
                    </span>
                  </div>

                  {/*
                    Explicit affordance. The card previously gave no indication
                    it was interactive until hovered, so first-time visitors read
                    the panel as static content.
                  */}
                  <span
                    className={`mt-4 inline-flex items-center gap-1.5 text-xs font-medium transition-opacity ${
                      isSelected
                        ? "text-primary opacity-100"
                        : "text-muted-foreground opacity-70 group-hover:opacity-100"
                    }`}
                  >
                    {isSelected ? "Terpilih" : "Pilih sesi ini"}
                    <ArrowRight size={13} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-8 flex justify-end">
            <Button
              onClick={() => setStep(2)}
              className="flex items-center gap-2"
            >
              Lanjut Pilih Jadwal
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2: Date & Slot Picker */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="border-b border-border pb-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow text-xs">Langkah 2 dari 3</p>
                <h2 className="text-2xl sm:text-3xl mt-1 text-foreground">
                  Pilih Tanggal & Jam Pertemuan
                </h2>
              </div>
              <div className="hidden sm:block text-right">
                <span className="inline-block rounded-xs bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
                  {activeOption.title} ({activeOption.durationMinutes}m)
                </span>
              </div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Jadwal disinkronkan secara langsung dengan kalender studio ELTs.
              Zona waktu: WIB (Waktu Indonesia Barat).
            </p>
          </div>

          {/* Quick Date Tabs */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Pilihan Hari Terdekat
            </label>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {quickDates.map((item) => {
                const isSelected = selectedDate === item.dateStr;
                return (
                  <button
                    key={item.dateStr}
                    type="button"
                    onClick={() => setSelectedDate(item.dateStr)}
                    className={`flex flex-col items-center justify-center p-3 border text-center transition-all ${
                      isSelected
                        ? "border-[#09090b] bg-[#09090b] text-white"
                        : "border-border bg-white text-foreground hover:bg-secondary/40"
                    }`}
                  >
                    <span className="text-[11px] font-medium opacity-80">
                      {item.label}
                    </span>
                    <span className="text-lg font-bold mt-0.5">
                      {item.dayNum}
                    </span>
                    <span className="text-[10px] opacity-75">
                      {item.monthShort}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Date Input Fallback */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Atau pilih tanggal lain:</span>
            <input
              type="date"
              value={selectedDate}
              min={new Date().toISOString().split("T")[0]}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="rounded-[var(--radius-inputs)] border border-[var(--color-cloud)] bg-[var(--color-snow)] px-3 py-1.5 text-xs text-[var(--color-graphite)] focus:border-[#09090b] focus:outline-none"
            />
          </div>

          {/* Available Slots Section */}
          <div className="mt-6 rounded-[var(--radius-cards)] border border-[var(--color-cloud)] bg-[var(--color-snow)] p-[var(--card-padding)]">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-border/50">
              <div className="flex items-center gap-2">
                <CalendarIcon size={16} className="text-muted-foreground" />
                <h3 className="text-sm font-medium text-foreground">
                  Slot Tersedia untuk{" "}
                  <span className="font-semibold underline">
                    {formatReadableDate(selectedDate)}
                  </span>
                </h3>
              </div>
              <span className="text-xs text-muted-foreground">WIB (UTC+7)</span>
            </div>

            {isLoadingSlots ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
                <p className="mt-3 text-xs text-muted-foreground">
                  Memeriksa ketersediaan kalender studio...
                </p>
              </div>
            ) : slotsError ? (
              <div className="rounded-xs border border-red-200 bg-red-50 p-4 text-center text-xs text-red-700">
                {slotsError}
              </div>
            ) : availableSlots.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                Tidak ada slot jadwal yang aktif untuk tanggal ini. Silakan pilih
                tanggal lain.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {availableSlots.map((slot) => {
                  const isSelected = selectedSlot === slot.time;
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      disabled={!slot.available}
                      onClick={() => setSelectedSlot(slot.time)}
                      className={`relative flex flex-col items-center justify-center py-3 px-2 border transition-all ${
                        !slot.available
                          ? "border-border/40 bg-secondary/30 text-muted-foreground/50 cursor-not-allowed line-through"
                          : isSelected
                            ? "border-[#09090b] bg-[#09090b] text-white"
                            : "border-border bg-white text-foreground hover:border-primary/60 hover:bg-secondary/20"
                      }`}
                    >
                      <span className="text-sm font-medium">{slot.time}</span>
                      <span className="text-[10px] mt-0.5 opacity-80">
                        {slot.available ? "Tersedia" : slot.conflictReason || "Penuh"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-8 flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => setStep(1)}
              className="flex items-center gap-2"
            >
              <ArrowLeft size={16} />
              Kembali
            </Button>
            <Button
              onClick={handleProceedToDetails}
              disabled={!selectedSlot || isLoadingSlots}
              className="flex items-center gap-2"
            >
              Lanjut Isi Data
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Client Details Form */}
      {step === 3 && (
        <form onSubmit={handleFormSubmit} className="space-y-6">
          <div className="border-b border-border pb-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow text-xs">Langkah 3 dari 3</p>
                <h2 className="text-2xl sm:text-3xl mt-1 text-foreground">
                  Informasi Kontak & Kebutuhan
                </h2>
              </div>
              <div className="hidden sm:block text-right">
                <p className="text-xs font-medium text-foreground">
                  {formatReadableDate(selectedDate)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedSlot} WIB ({activeOption.durationMinutes} menit)
                </p>
              </div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Detail ini digunakan untuk membuat tautan Google Meet dan mengirimkan
              konfirmasi langsung ke WhatsApp Anda.
            </p>
          </div>

          {formError && (
            <div className="rounded-xs border border-red-200 bg-red-50 p-4 text-xs text-red-700">
              {formError}
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            {/* Full Name */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Nama Lengkap / PIC <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <User
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="cth. Rayhan Pratama"
                  className="w-full rounded-[var(--radius-inputs)] border border-[var(--color-cloud)] bg-[var(--color-snow)] pl-9 pr-3 py-2.5 text-sm text-[var(--color-graphite)] focus:border-[#09090b] focus:outline-none"
                />
              </div>
            </div>

            {/* WhatsApp */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Nomor WhatsApp <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Phone
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="tel"
                  required
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="cth. 081234567890"
                  className="w-full rounded-[var(--radius-inputs)] border border-[var(--color-cloud)] bg-[var(--color-snow)] pl-9 pr-3 py-2.5 text-sm text-[var(--color-graphite)] focus:border-[#09090b] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Alamat Email (Opsional)
            </label>
            <div className="relative">
              <Mail
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@perusahaan.com (untuk menerima kalender Google)"
                className="w-full rounded-[var(--radius-inputs)] border border-[var(--color-cloud)] bg-[var(--color-snow)] pl-9 pr-3 py-2.5 text-sm text-[var(--color-graphite)] focus:border-[#09090b] focus:outline-none"
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Jika diisi, Google Calendar akan otomatis mengirimkan invite resmi ke inbox Anda.
            </p>
          </div>

          {/* Service Pillar Selection */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Bidang Layanan yang Diminati <span className="text-red-500">*</span>
            </label>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {SERVICE_PILLARS.map((pillar) => {
                const isSelected = servicePillar === pillar.id;
                return (
                  <div
                    key={pillar.id}
                    onClick={() => setServicePillar(pillar.id)}
                    className={`cursor-pointer border p-3.5 transition-all ${
                      isSelected
                        ? "border-primary bg-secondary/50 shadow-2xs"
                        : "border-border bg-white hover:bg-secondary/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        {pillar.label}
                      </span>
                      <div
                        className={`size-3.5 rounded-full border flex items-center justify-center ${
                          isSelected
                            ? "border-primary bg-primary text-white"
                            : "border-border"
                        }`}
                      >
                        {isSelected && <Check size={10} strokeWidth={3} />}
                      </div>
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground leading-normal">
                      {pillar.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Brief Notes */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Catatan Singkat / Gambaran Kebutuhan
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ceritakan gambaran singkat acara, tanggal perkiraan, atau pertanyaan utama yang ingin dibahas..."
              className="w-full resize-none rounded-[var(--radius-inputs)] border border-[var(--color-cloud)] bg-[var(--color-snow)] p-3 text-sm text-[var(--color-graphite)] focus:border-[#09090b] focus:outline-none"
            />
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setStep(2)}
              className="flex items-center gap-2"
            >
              <ArrowLeft size={16} />
              Kembali
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-8"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Menjadwalkan & Sinkron Kalender...
                </>
              ) : (
                <>
                  Konfirmasi Jadwal
                  <CheckCircle2 size={16} />
                </>
              )}
            </Button>
          </div>
        </form>
      )}

      {/* STEP 4: Confirmation Screen */}
      {step === 4 && confirmation && (
        <div className="rounded-[var(--radius-cards)] border border-[var(--color-cloud)] bg-[var(--color-snow)] p-[var(--card-padding)] sm:p-10">
          <div className="flex flex-col items-center text-center pb-8 border-b border-border">
            <div className="flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-4 ring-8 ring-emerald-50/50">
              <CheckCircle2 size={32} />
            </div>
            <p className="eyebrow text-xs text-emerald-700">
              Reservasi Berhasil
            </p>
            <h2 className="text-3xl sm:text-4xl mt-1 text-foreground">
              Jadwal Pertemuan Terkonfirmasi
            </h2>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">
              Terima kasih, <strong>{confirmation.clientName}</strong>. Sesi
              meeting Anda telah terdaftar dan disinkronkan ke kalender studio.
            </p>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {/* Booking Details Summary */}
            <div className="border border-border/80 bg-secondary/20 p-5 space-y-3.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/60 pb-2">
                Ringkasan Pertemuan
              </h3>
              <div className="text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Jenis Sesi:</span>
                  <span className="font-medium text-foreground text-right">
                    {confirmation.title}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tanggal:</span>
                  <span className="font-medium text-foreground">
                    {formatReadableDate(selectedDate)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Waktu:</span>
                  <span className="font-medium text-foreground">
                    {selectedSlot} WIB ({activeOption.durationMinutes} menit)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Layanan:</span>
                  <span className="font-medium text-foreground">
                    {confirmation.serviceInterest}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">No. WhatsApp:</span>
                  <span className="font-medium text-foreground">
                    +{confirmation.clientPhone}
                  </span>
                </div>
              </div>
            </div>

            {/* Google Meet Link Action Box */}
            <div className="border border-border/80 bg-white p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2 text-foreground font-medium text-sm">
                  <Video size={18} className="text-primary" />
                  <span>Google Meet Video Call</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Tautan virtual meeting telah dibuat secara otomatis untuk sesi
                  ini. Silakan bergabung tepat waktu.
                </p>

                {confirmation.meetLink && (
                  <div className="mt-4 flex items-center gap-2 rounded-xs border border-border bg-secondary/30 p-2.5">
                    <input
                      type="text"
                      readOnly
                      value={confirmation.meetLink}
                      className="w-full bg-transparent text-xs text-foreground focus:outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleCopyMeet}
                      title="Salin link Google Meet"
                      className="flex items-center gap-1 rounded-[var(--radius-badges)] border border-[var(--color-cloud)] bg-[var(--color-snow)] px-2 py-1 text-[11px] text-[var(--color-graphite)] transition-colors hover:bg-[var(--color-paper)]"
                    >
                      {isCopiedMeet ? (
                        <>
                          <Check size={12} className="text-emerald-600" />
                          <span>Tersalin</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>Salin</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {confirmation.meetLink && (
                <div className="mt-4">
                  <a
                    href={confirmation.meetLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 border border-primary bg-primary text-primary-foreground py-2.5 px-4 text-xs font-medium hover:bg-[#3c3b37] transition-colors"
                  >
                    Buka Google Meet Sekarang
                    <ExternalLink size={14} />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* WhatsApp Direct Action & Next Steps */}
          <div className="mt-8 border-t border-border pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
                <MessageCircle size={18} />
              </span>
              <p className="text-xs text-muted-foreground">
                Kirim pesan konfirmasi otomatis ke WhatsApp ELTs. Studio untuk
                tanggapan lebih cepat.
              </p>
            </div>

            <div className="flex w-full sm:w-auto items-center gap-3">
              <a
                href={confirmation.waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba5a] text-white py-2.5 px-5 text-xs font-semibold transition-colors"
              >
                Konfirmasi via WhatsApp
                <ExternalLink size={14} />
              </a>

              <Button
                variant="outline"
                onClick={() => {
                  setStep(1);
                  setConfirmation(null);
                  setSelectedSlot(null);
                  setNotes("");
                }}
                className="text-xs h-10 px-4"
              >
                Jadwalkan Lain
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
