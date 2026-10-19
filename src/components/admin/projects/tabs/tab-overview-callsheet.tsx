"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  Clock,
  MapPin,
  ExternalLink,
  Phone,
  User,
  Upload,
  Edit3,
  X,
  Save,
  Loader2,
  Receipt,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/admin/copy-button";
import { ProjectStatusControl } from "@/components/admin/project-status-control";
import type { ProjectRow, CustomerRow, InvoiceRow, ProjectStatus } from "@/types/database";
import { updateProjectOverviewAction } from "@/app/actions/admin-projects";

interface TabOverviewCallSheetProps {
  project: ProjectRow;
 customer: Pick<CustomerRow, "id" | "name" | "email" | "phone"> | null;
  totalMedia: number;
  invoices: InvoiceRow[];
}

/** Rolling T-minus label for the shoot date, measured against `now`. */
function formatCountdown(
  shootDate: string | null | undefined,
  now: number,
): string {
 if (!shootDate) return "Jadwal belum ditentukan";

 const targetDate = new Date(`${shootDate}T07:30:00+07:00`).getTime();
 if (Number.isNaN(targetDate)) return "Jadwal belum ditentukan";

  const diff = targetDate - now;
 if (diff <= 0) return "Hari-H Sedang Berlangsung / Telah Selesai";

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return days > 0
 ? `T-Minus ${days} Hari ${hours} Jam menuju Roll Time`
 : `T-Minus ${hours} Jam ${minutes} Menit menuju Roll Time`;
}

export function TabOverviewCallSheet({
  project,
  customer,
  totalMedia,
  invoices,
}: TabOverviewCallSheetProps) {
 // Live countdown to shoot / roll time. `now` holds the last observed
  // timestamp; a minute-interval advances it, so the label re-derives without
  // any state write inside the effect body.
  const [now, setNow] = useState(() => Date.now());
  const countdown = formatCountdown(project.shoot_date, now);

  // In-Place Edit Mode State
  const [isEditMode, setIsEditMode] = useState(false);
  const [isPending, startTransition] = useTransition();
 const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Editable Form Fields
  const [editName, setEditName] = useState(project.name);
 const [editShootDate, setEditShootDate] = useState(project.shoot_date || "");
  const [editHasRehearsal, setEditHasRehearsal] = useState(Boolean(project.rehearsal_date));
 const [editRehearsalDate, setEditRehearsalDate] = useState(project.rehearsal_date || "");
  const [editStatus, setEditStatus] = useState<ProjectStatus>(project.status);
 
  // Staging specs fields
  const specs = (project.sector_specs || {}) as Record<string, unknown>;
 const [editVenueName, setEditVenueName] = useState(String(specs.venueName || "Auditorium Graha Widyatama UNSOED"));
 const [editVenueAddress, setEditVenueAddress] = useState(String(specs.venueAddress || "Jl. HR Boenyamin No. 708, Purwokerto Utara"));
 const [editVenueMapsUrl, setEditVenueMapsUrl] = useState(String(specs.venueMapsUrl || "https://maps.google.com/?q=-7.402482,109.248381"));
 const [editRollTime, setEditRollTime] = useState(String(specs.rollTime || "07:30"));

  // Customer Fields
 const [editCustomerName, setEditCustomerName] = useState(customer?.name || "");
 const [editCustomerPhone, setEditCustomerPhone] = useState(customer?.phone || "");
 const [editCustomerEmail, setEditCustomerEmail] = useState(customer?.email || "");

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  const waPhone = customer?.phone
 ? customer.phone.replace(/[^0-9]/g, "").replace(/^0/, "62")
    : null;

  // Handle Save In-Place Changes
  const handleSaveInPlace = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    startTransition(async () => {
      const res = await updateProjectOverviewAction(project.id, {
        name: editName,
        shoot_date: editShootDate || null,
        rehearsal_date: editHasRehearsal ? editRehearsalDate || null : null,
        status: editStatus,
        customer_id: customer?.id,
        customer_name: editCustomerName,
        customer_phone: editCustomerPhone,
        customer_email: editCustomerEmail,
        venue_name: editVenueName,
        venue_address: editVenueAddress,
        venue_maps_url: editVenueMapsUrl,
        roll_time: editRollTime,
      });

      if (res.success) {
        setFeedback({
 type: "success",
 message: "Perubahan detail proyek berhasil disimpan!",
        });
        setIsEditMode(false);
        setTimeout(() => setFeedback(null), 3500);
      } else {
        setFeedback({
 type: "error",
 message: res.error || "Gagal menyimpan perubahan.",
        });
      }
    });
  };

 const isReschedulingDate = editShootDate !== (project.shoot_date || "");

  return (
 <div className="space-y-6">
      {/* Feedback Banner */}
      {feedback && (
        <div
 className={`p-4 rounded-xl border text-xs flex items-center justify-between animate-in fade-in ${
 feedback.type === "success"
            ? "bg-[#fafafa] text-[#3f3f46] border-[#ececee]"
            : "bg-[#ff5a00]/10 text-[#c2410c] border-[#ff5a00]/20"
 }`}
        >
          <span>{feedback.message}</span>
          <button
 type="button"
            onClick={() => setFeedback(null)}
 className="font-bold underline cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* 1. Live Roll Time Countdown Ribbon & Actions */}
 <div className="bg-white/80 backdrop-blur-xl border border-[#ececee]/80 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
 <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#fafafa] text-[#3f3f46] flex items-center justify-center shrink-0 border border-[#ececee]">
            <Clock size={20} />
          </div>
          <div>
 <p className="text-[11px] font-mono uppercase tracking-wider text-[#71717a] ">
              Situational Awareness &amp; Live Countdown
            </p>
 <h3 className="text-base sm:text-lg font-bold font-mono tracking-tight text-[#09090b] ">
              {countdown}
            </h3>
          </div>
        </div>

 <div className="flex items-center gap-2">
          {/* Edit Mode Toggle Button */}
          <Button
 type="button"
 size="sm"
            onClick={() => setIsEditMode(!isEditMode)}
 variant={isEditMode ? "default" : "outline"}
            className={
              isEditMode
                ? "bg-[#ff5a00] hover:bg-[#ff7a33] text-white font-bold border-[#ff5a00] text-xs"
 : "text-[#3f3f46] border-[#ececee] hover:bg-[#fafafa] text-xs"
            }
          >
            {isEditMode ? (
              <>
 <X size={14} className="mr-1.5" /> Batal Edit
              </>
            ) : (
              <>
 <Edit3 size={14} className="mr-1.5" /> ✏️ Mode Edit Cepat
              </>
            )}
          </Button>

 <Button asChild size="sm" variant="outline" className="text-[#3f3f46] border-[#ececee] hover:bg-[#fafafa] text-xs">
 <Link href={`/admin/projects/${project.id}/media`}>
 <Upload size={14} className="mr-1.5" /> Media ({totalMedia})
            </Link>
          </Button>

          {/* Reflects real invoice rows; links to the finance tab when present. */}
          <Button
            asChild
 size="sm"
 variant="outline"
 className="text-[#3f3f46] border-[#ececee] hover:bg-[#fafafa] text-xs"
          >
 <Link href={`/admin/projects/${project.id}?tab=rab`}>
 <Receipt size={14} className="mr-1.5" />
              {invoices.length > 0
 ? `Invoice (${invoices.length})`
 : "Belum Ada Invoice"}
            </Link>
          </Button>

          <Button asChild size="sm" className="bg-[#09090b] hover:bg-[#27272a] text-white text-xs font-semibold">
            <a
 href={`/gallery/${project.access_token}`}
 target="_blank"
 rel="noreferrer"
            >
 <ExternalLink size={14} className="mr-1.5" /> Galeri Klien ↗
            </a>
          </Button>
        </div>
      </div>

      {/* EDIT MODE FORM CONTAINER */}
      {isEditMode ? (
      <form onSubmit={handleSaveInPlace} className="rounded-[36px] border border-[#ff5a00] bg-white p-6 space-y-6">
 <div className="flex items-center justify-between border-b border-[#ececee]/80 pb-3">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#c2410c] font-bold bg-[#ff5a00]/10 px-2 py-0.5 rounded-md">
                IN-PLACE EDIT MODE AKTIF
              </span>
 <h3 className="font-bold tracking-tight text-lg text-[#09090b] mt-1">
                Edit Langsung Informasi Proyek, Jadwal &amp; Lokasi
              </h3>
            </div>
 <div className="flex items-center gap-2">
              <Button
 type="button"
 variant="outline"
 size="sm"
                onClick={() => setIsEditMode(false)}
                disabled={isPending}
 className="text-xs"
              >
                Batal
              </Button>
              <Button
 type="submit"
 size="sm"
                disabled={isPending}
                className="bg-[#09090b] hover:bg-[#27272a] text-white text-xs font-semibold gap-1.5"
              >
 {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                <span>Simpan Perubahan</span>
              </Button>
            </div>
          </div>

          {/* Reschedule Cascade Warning if shoot date changed */}
          {isReschedulingDate && (
            <div className="p-3.5 bg-[#ff5a00]/10 border border-[#ff5a00]/30 rounded-xl text-xs text-[#c2410c] flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-[#ff5a00] shrink-0 mt-0.5" />
              <div>
 <p className="font-bold">Peringatan Reschedule Tanggal Acara:</p>
 <p className="text-[11px] mt-0.5">
                  Mengubah tanggal dari <strong>{project.shoot_date}</strong> ke <strong>{editShootDate}</strong> akan secara otomatis menggeser call time seluruh kru via <code>trg_cascade_project_reschedule</code>, menyetel ulang persetujuan ke <code>PENDING_OFFER</code>, dan membersihkan honor unconfirmed dari RAB hingga dikonfirmasi ulang.
                </p>
              </div>
            </div>
          )}

 <div className="grid md:grid-cols-2 gap-6">
            {/* Left Edit Column: Project Details & Scheduling */}
 <div className="space-y-4">
 <div className="space-y-1.5">
 <label className="text-xs font-bold text-[#3f3f46] ">
                  Nama Proyek
                </label>
                <input
 type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
 className="contact-input text-xs font-semibold"
                />
              </div>

 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <label className="text-xs font-bold text-[#3f3f46] ">
                    Tanggal Acara (Shoot Date)
                  </label>
                  <input
 type="date"
                    value={editShootDate}
                    onChange={(e) => setEditShootDate(e.target.value)}
 className="contact-input text-xs font-mono"
                  />
                </div>

 <div className="space-y-1.5">
 <label className="text-xs font-bold text-[#3f3f46] ">
                    Roll Time (WIB)
                  </label>
                  <input
 type="time"
                    value={editRollTime}
                    onChange={(e) => setEditRollTime(e.target.value)}
 className="contact-input text-xs font-mono"
                  />
                </div>
              </div>

              {/* Rehearsal Staging Toggle */}
              <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] p-3 space-y-2.5">
 <div className="flex items-center justify-between">
 <label htmlFor="rehearsal-toggle" className="text-xs font-semibold text-[#27272a] cursor-pointer">
                    Staging Rehearsal / Gladi Bersih H-1
                  </label>
                  <input
 type="checkbox"
 id="rehearsal-toggle"
                    checked={editHasRehearsal}
                    onChange={(e) => setEditHasRehearsal(e.target.checked)}
 className="w-4 h-4 rounded text-[#09090b] cursor-pointer"
                  />
                </div>

                {editHasRehearsal && (
 <div className="pt-2 border-t border-[#ececee]/80 ">
 <label className="text-[11px] font-medium text-[#71717a] block mb-1">
                      Tanggal Rehearsal:
                    </label>
                    <input
 type="date"
                      value={editRehearsalDate}
                      onChange={(e) => setEditRehearsalDate(e.target.value)}
 className="contact-input text-xs font-mono"
                    />
                  </div>
                )}
              </div>

              {/* Status Switcher */}
 <div className="space-y-1.5">
 <label className="text-xs font-bold text-[#3f3f46] ">
                  Status Siklus Hidup Proyek
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as ProjectStatus)}
 className="contact-input text-xs font-medium"
                >
 <option value="draft">Draft (Persiapan)</option>
 <option value="ready">Ready (Deal Dikonfirmasi)</option>
 <option value="editing">Editing / Dalam Pasca-Produksi</option>
 <option value="completed">Completed (Selesai Lunas)</option>
 <option value="archived">Archived (Diarsipkan)</option>
                </select>
              </div>
            </div>

            {/* Right Edit Column: Venue & Client */}
 <div className="space-y-4">
 <div className="space-y-1.5">
 <label className="text-xs font-bold text-[#3f3f46] ">
                  Nama Venue / Lokasi
                </label>
                <input
 type="text"
                  value={editVenueName}
                  onChange={(e) => setEditVenueName(e.target.value)}
 className="contact-input text-xs font-medium"
                />
              </div>

 <div className="space-y-1.5">
 <label className="text-xs font-bold text-[#3f3f46] ">
                  Alamat Lengkap Venue
                </label>
                <input
 type="text"
                  value={editVenueAddress}
                  onChange={(e) => setEditVenueAddress(e.target.value)}
 className="contact-input text-xs"
                />
              </div>

 <div className="space-y-1.5">
 <label className="text-xs font-bold text-[#3f3f46] ">
                  Link Google Maps Venue
                </label>
                <input
 type="url"
                  value={editVenueMapsUrl}
                  onChange={(e) => setEditVenueMapsUrl(e.target.value)}
 className="contact-input text-xs"
                />
              </div>

 <div className="pt-2 border-t border-[#ececee]/80 space-y-2">
 <span className="text-xs font-bold text-[#3f3f46] block">
                  Informasi Kontak Klien / PIC
                </span>
 <div className="grid grid-cols-2 gap-2">
                  <input
 type="text"
 placeholder="Nama Klien"
                    value={editCustomerName}
                    onChange={(e) => setEditCustomerName(e.target.value)}
 className="contact-input text-xs"
                  />
                  <input
 type="text"
 placeholder="No. WhatsApp"
                    value={editCustomerPhone}
                    onChange={(e) => setEditCustomerPhone(e.target.value)}
 className="contact-input text-xs font-mono"
                  />
                </div>
                <input
 type="email"
 placeholder="Email Klien"
                  value={editCustomerEmail}
                  onChange={(e) => setEditCustomerEmail(e.target.value)}
 className="contact-input text-xs"
                />
              </div>
            </div>
          </div>
        </form>
      ) : (
        /* READ-ONLY VIEW GRID */
 <div className="grid md:grid-cols-2 gap-6">
          {/* Geo-Venue Staging Card */}
        <div className="rounded-[36px] border border-[#ececee] bg-white p-6 space-y-4">
 <div className="flex items-center justify-between border-b border-[#ececee]/80 pb-3">
 <div className="flex items-center gap-2 text-[#27272a] font-bold tracking-tight text-base">
                <MapPin size={18} className="text-[#3f3f46]" />
                <span>Titik Venue &amp; Load-in</span>
              </div>
 <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-[#fafafa] text-[#52525b] font-semibold">
                FIELD LOCATION
              </span>
            </div>

 <div className="space-y-3 text-sm">
              <div>
 <p className="text-xs text-[#71717a] ">Lokasi Utama:</p>
 <p className="font-semibold text-[#09090b] text-base">
                  {editVenueName}
                </p>
              </div>

              <div>
 <p className="text-xs text-[#71717a] ">Alamat Lengkap:</p>
 <p className="text-xs text-[#3f3f46] leading-relaxed">
                  {editVenueAddress}
                </p>
              </div>

 <div className="grid grid-cols-2 gap-3 p-3 bg-[#fafafa] rounded-xl text-xs font-mono">
                <div>
 <span className="text-[#71717a] block text-[10px]">TANGGAL ACARA:</span>
 <span className="font-bold text-[#09090b] ">{project.shoot_date || "-"}</span>
                </div>
                <div>
 <span className="text-[#71717a] block text-[10px]">ROLL TIME ACARA:</span>
 <span className="font-bold text-[#09090b] ">{editRollTime} WIB</span>
                </div>
              </div>

              {project.rehearsal_date && (
                <div className="p-2.5 bg-[#fafafa]/70 rounded-xl border border-[#ececee] text-xs text-[#3f3f46] flex items-center justify-between font-mono">
                  <span>GLADI BERSIH / CABLING D-1:</span>
 <span className="font-bold">{project.rehearsal_date}</span>
                </div>
              )}

 <div className="pt-1">
 <Button asChild variant="outline" size="sm" className="w-full text-xs">
                  <a
                    href={editVenueMapsUrl}
 target="_blank"
 rel="noreferrer"
 className="gap-1.5"
                  >
                    <ExternalLink size={13} /> Buka Navigasi Google Maps
                  </a>
                </Button>
              </div>
            </div>
          </div>

          {/* Client & Communication Card */}
        <div className="rounded-[36px] border border-[#ececee] bg-white p-6 space-y-4">
 <div className="flex items-center justify-between border-b border-[#ececee]/80 pb-3">
 <div className="flex items-center gap-2 text-[#27272a] font-bold tracking-tight text-base">
                <User size={18} className="text-[#3f3f46]" />
                <span>Detail Klien &amp; Kontak PIC</span>
              </div>
 <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-[#fafafa] text-[#52525b] font-semibold">
                STAKEHOLDER
              </span>
            </div>

 <div className="space-y-3 text-sm">
              <div>
 <p className="text-xs text-[#71717a] ">Nama Klien / Instansi:</p>
 <p className="font-semibold text-[#09090b] text-base">
 {customer?.name || "Klien Tanpa Nama"}
                </p>
              </div>

 <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
 <span className="text-[#71717a] block text-[10px]">WHATSAPP:</span>
 <span className="font-medium text-[#09090b] ">{customer?.phone || "-"}</span>
                </div>
                <div>
 <span className="text-[#71717a] block text-[10px]">EMAIL:</span>
 <span className="font-medium text-[#09090b] ">{customer?.email || "-"}</span>
                </div>
              </div>

              {waPhone && (
              <Button asChild size="sm" className="w-full bg-[#09090b] hover:bg-[#27272a] text-white text-xs">
                  <a
 href={`https://wa.me/${waPhone}?text=Halo%20${encodeURIComponent(customer?.name || "")},%20terkait%20jadwal%20produksi%20${encodeURIComponent(project.name)}...`}
 target="_blank"
 rel="noreferrer"
 className="gap-1.5"
                  >
                    <Phone size={13} /> Chat WhatsApp Klien
                  </a>
                </Button>
              )}

              {/* Quick Credentials Copy */}
 <div className="pt-2 border-t border-[#ececee]/80 flex items-center justify-between text-xs font-mono">
                <div>
 <span className="text-[10px] text-[#71717a] block">GALLERY CODE:</span>
 <span className="font-bold text-[#09090b] ">{project.gallery_code}</span>
                </div>
 <CopyButton value={project.gallery_code} label="Salin Kode" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Status Governance Bar */}
      <div className="rounded-[36px] border border-[#ececee] bg-white p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
 <h4 className="font-bold text-sm text-[#09090b] ">Tata Kelola Status Proyek</h4>
 <p className="text-xs text-[#71717a] ">
            Mengubah status akan memicu hak akses galeri klien dan workflow notifikasi
          </p>
        </div>

        <ProjectStatusControl projectId={project.id} currentStatus={project.status} />
      </div>
    </div>
  );
}
