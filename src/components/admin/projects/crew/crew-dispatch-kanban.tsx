"use client";

import { useState, useTransition, useMemo } from "react";
import {
  Users,
  Briefcase,
  Clock,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Send,
  Trash2,
  Search,
  ArrowRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  CrewMemberRow,
  ProjectCrewAssignmentWithCrew,
} from "@/types/operations";
import { DispatchMicroModal } from "./dispatch-micro-modal";
import { deleteCrewAssignment } from "@/app/actions/crew";
import { opsUrl } from "@/lib/domain";
interface CrewDispatchKanbanProps {
  projectId: string;
  projectName?: string;
  shootDate?: string | null;
  rehearsalDate?: string | null;
  venueName?: string;
  venueAddress?: string;
  venueMapsUrl?: string;
  initialAssignments: ProjectCrewAssignmentWithCrew[];
  availableCrewMembers: CrewMemberRow[];
}

export function CrewDispatchKanban({
  projectId,
 projectName = "Proyek",
  shootDate,
 venueName = "Graha Widyatama UNSOED",
 venueAddress = "Purwokerto Utara",
 venueMapsUrl = "",
  initialAssignments,
  availableCrewMembers,
}: CrewDispatchKanbanProps) {
  const [assignments, setAssignments] =
    useState<ProjectCrewAssignmentWithCrew[]>(initialAssignments);
  const [selectedWorkerForModal, setSelectedWorkerForModal] =
    useState<CrewMemberRow | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Search & Type Filters for Left Pool
 const [poolFilter, setPoolFilter] = useState<"ALL" | "CORE_TEAM" | "FREELANCE">("ALL");
 const [poolSearch, setPoolSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Unassign confirmation modal
  const [unassignTarget, setUnassignTarget] = useState<ProjectCrewAssignmentWithCrew | null>(null);
  // Mobile segment control (< lg screens)
 const [mobileColumn, setMobileColumn] = useState<"pool" | "stations">("stations");

  // Set of assigned crew member IDs in this project
  const assignedCrewMemberIds = useMemo(
    () => new Set(assignments.map((a) => a.crew_member_id)),
    [assignments]
  );

  // Filter pool candidates
  const filteredPool = useMemo(() => {
    return availableCrewMembers.filter((m) => {
 // Don't show in pool if already assigned to this project
      if (assignedCrewMemberIds.has(m.id)) return false;

      // Filter by type
 if (poolFilter === "CORE_TEAM" && m.member_type !== "CORE_TEAM") return false;
 if (poolFilter === "FREELANCE" && m.member_type === "CORE_TEAM") return false;

      // Search query
      if (poolSearch.trim()) {
        const q = poolSearch.toLowerCase();
        const nameMatch = m.full_name.toLowerCase().includes(q);
        const codeMatch = m.crew_code.toLowerCase().includes(q);
        const skillsMatch = (m.primary_skills || []).some((s) => s.toLowerCase().includes(q));
        if (!nameMatch && !codeMatch && !skillsMatch) return false;
      }

      return true;
    });
  }, [availableCrewMembers, assignedCrewMemberIds, poolFilter, poolSearch]);

  // Handle Copy Magic Link
  const handleCopyLink = async (assignment: ProjectCrewAssignmentWithCrew) => {
    const url = opsUrl(`/crew/${assignment.magic_token}`);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(assignment.id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      // Fallback
    }
  };

  // Handle Unassign Confirm
  const handleConfirmUnassign = () => {
    if (!unassignTarget) return;

    startTransition(async () => {
      const res = await deleteCrewAssignment(unassignTarget.id, projectId);
      if (res.success) {
        setAssignments((prev) => prev.filter((a) => a.id !== unassignTarget.id));
        setUnassignTarget(null);
      }
    });
  };

  // Accepted counts
 const confirmedCount = assignments.filter((a) => a.acceptance_status === "ACCEPTED").length;
 const pendingCount = assignments.filter((a) => a.acceptance_status === "PENDING_OFFER").length;
 const declinedCount = assignments.filter((a) => a.acceptance_status === "DECLINED").length;

  return (
 <div className="space-y-6">
      {/* 1. Header Status Bar */}
      <div className="rounded-[36px] border border-[#ececee] bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
 <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-[#ececee] bg-[#fafafa] text-[#09090b] font-bold uppercase">
              KANBAN DISPATCH SYSTEM
            </span>
            <span className="text-xs text-[#52525b] ">
 • Jadwal: {shootDate || "Belum Ditentukan"}
            </span>
          </div>
          <h3 className="text-xl font-bold tracking-tight text-[#09090b] ">
            Penugasan Stasiun &amp; Alokasi Kru Lapangan
          </h3>
        </div>

        {/* Counter Pills */}
 <div className="flex items-center gap-2 text-xs font-mono">
          <span className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1 rounded-full border border-[#ececee] bg-[#fafafa] text-[#09090b] font-semibold">
            <CheckCircle2 size={13} /> {confirmedCount} ACC
          </span>
          {pendingCount > 0 && (
            <span className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1 rounded-full border border-[#ff5a00]/50 bg-[#ff5a00]/10 text-[#ff5a00] font-semibold">
              <Clock size={13} /> {pendingCount} PENDING
            </span>
          )}
          {declinedCount > 0 && (
            <span className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1 rounded-full border border-[#ececee] bg-[#fafafa] text-[#52525b] font-semibold">
              <AlertCircle size={13} /> {declinedCount} DITOLAK
            </span>
          )}
        </div>
      </div>

      {/* Mobile Segmented Switcher (< 1024px) */}
      <div className="flex lg:hidden items-center gap-1.5 p-1.5 bg-[#fafafa] rounded-2xl border border-[#ececee] text-xs font-semibold">
        <button
 type="button"
 onClick={() => setMobileColumn("pool")}
 aria-pressed={mobileColumn === "pool"}
          className={`flex-1 min-h-11 rounded-xl text-center transition-all cursor-pointer ${
            mobileColumn === "pool"
              ? "bg-[#09090b] text-white font-bold"
              : "text-[#52525b] hover:text-[#09090b] "
          }`}
        >
          Pool Kru ({filteredPool.length})
        </button>
        <button
 type="button"
 onClick={() => setMobileColumn("stations")}
 aria-pressed={mobileColumn === "stations"}
          className={`flex-1 min-h-11 rounded-xl text-center transition-all cursor-pointer ${
            mobileColumn === "stations"
              ? "bg-[#09090b] text-white font-bold"
              : "text-[#52525b] hover:text-[#09090b] "
          }`}
        >
          Stasiun Tugas ({assignments.length})
        </button>
      </div>

      {/* 2. Two-Column Visual Dispatch Board */}
 <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* ======================================================== */}
        {/* COLUMN A: POOL KRU TERSEDIA (40% / 5 cols)               */}
        {/* ======================================================== */}
      <div className={`lg:col-span-5 rounded-[36px] border border-[#ececee] bg-white p-5 space-y-4 ${
 mobileColumn === "pool" ? "block" : "hidden lg:block"
 }`}>
        <div className="flex items-center justify-between border-b border-[#ececee] pb-3">
 <div className="flex items-center gap-2">
            <Users size={16} className="text-[#3f3f46] " />
            <h4 className="font-bold tracking-tight text-sm text-[#09090b] ">
                Pool Kru Tersedia
              </h4>
            </div>
          <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full border border-[#ececee] bg-[#fafafa] text-[#52525b] ">
              {filteredPool.length} Tersedia
            </span>
          </div>

          {/* Filter Pills */}
 <div className="flex items-center gap-1.5 text-xs">
            <button
 type="button"
 onClick={() => setPoolFilter("ALL")}
              className={`min-h-11 px-3 py-2 sm:py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                poolFilter === "ALL"
                  ? "bg-[#09090b] text-white font-semibold"
                  : "bg-[#fafafa] text-[#52525b] hover:bg-[#f4f4f5]"
              }`}
            >
              Semua
            </button>
            <button
 type="button"
 onClick={() => setPoolFilter("CORE_TEAM")}
              className={`min-h-11 px-3 py-2 sm:py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                poolFilter === "CORE_TEAM"
                  ? "bg-[#09090b] text-white font-semibold"
                  : "bg-[#fafafa] text-[#52525b] hover:bg-[#f4f4f5]"
              }`}
            >
              👑 Core Team
            </button>
            <button
 type="button"
 onClick={() => setPoolFilter("FREELANCE")}
              className={`min-h-11 px-3 py-2 sm:py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                poolFilter === "FREELANCE"
                  ? "bg-[#09090b] text-white font-semibold"
                  : "bg-[#fafafa] text-[#52525b] hover:bg-[#f4f4f5]"
              }`}
            >
              👥 Freelance
            </button>
          </div>

          {/* Search Box */}
 <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-[#a1a1aa] " />
            <input
 type="text"
 placeholder="Cari nama atau keahlian..."
              value={poolSearch}
              onChange={(e) => setPoolSearch(e.target.value)}
 className="contact-input pl-8 py-2.5 sm:py-1.5 text-xs w-full"
            />
          </div>

          {/* Candidate Pool List */}
 <div className="space-y-2.5 max-h-[580px] overflow-y-auto pr-1">
            {filteredPool.length > 0 ? (
              filteredPool.map((worker) => {
 const isCore = worker.member_type === "CORE_TEAM";

                return (
                  <div
                    key={worker.id}
                    className="p-3.5 rounded-[12px] border border-[#ececee] bg-[#fafafa] hover:bg-[#f4f4f5] transition-all flex items-center justify-between gap-3 group"
                  >
 <div className="space-y-1 min-w-0">
 <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-[#09090b] truncate">
                          {worker.full_name}
                        </span>
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold ${
                            isCore
                              ? "border border-[#ececee] bg-white text-[#09090b] "
                              : "bg-[#f4f4f5] text-[#52525b] "
                          }`}
                        >
                          {worker.crew_code}
                        </span>
                      </div>

 <div className="flex flex-wrap gap-1">
                        {(worker.primary_skills || []).slice(0, 2).map((s) => (
                          <span
                            key={s}
                            className="text-[10px] text-[#52525b] bg-white px-1.5 py-0.2 rounded border border-[#ececee] text-xs"
                          >
                            {s}
                          </span>
                        ))}
                      </div>

                      <p className="text-[11px] font-mono text-[#52525b]">
 Rp {(Number(worker.standard_day_rate) || 0).toLocaleString("id-ID")} / hari
                      </p>
                    </div>

                    <Button
 type="button"
 size="sm"
                      onClick={() => {
                        setSelectedWorkerForModal(worker);
                        setIsModalOpen(true);
                      }}
                      className="shrink-0 min-h-11 px-3 sm:px-2.5 text-xs bg-[#09090b] hover:bg-[#27272a] text-white gap-1 cursor-pointer font-medium"
                    >
                      <span>Tugaskan</span>
                      <ArrowRight size={13} />
                    </Button>
                  </div>
                );
              })
            ) : (
              <div className="p-6 text-center text-xs text-[#52525b] bg-[#fafafa] rounded-[12px] border border-dashed border-[#d4d4d8] ">
                Tidak ada personel tersedia di pool filter ini.
              </div>
            )}
          </div>
        </div>

        {/* ======================================================== */}
        {/* COLUMN B: STASIUN TUGAS LAPANGAN (60% / 7 cols)          */}
        {/* ======================================================== */}
      <div className={`lg:col-span-7 rounded-[36px] border border-[#ececee] bg-white p-5 space-y-4 ${
 mobileColumn === "stations" ? "block" : "hidden lg:block"
 }`}>
        <div className="flex items-center justify-between border-b border-[#ececee] pb-3">
 <div className="flex items-center gap-2">
            <Briefcase size={16} className="text-[#3f3f46]" />
            <h4 className="font-bold tracking-tight text-sm text-[#09090b] ">
                Stasiun Tugas Lapangan Terjadwal
              </h4>
            </div>
          <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full border border-[#ececee] bg-[#fafafa] text-[#52525b] ">
              {assignments.length} Stasiun Ditugaskan
            </span>
          </div>

          {/* Assignments List */}
 <div className="space-y-3">
            {assignments.length > 0 ? (
              assignments.map((assignment) => {
                const member = assignment.crew_member;
 const isAccepted = assignment.acceptance_status === "ACCEPTED";
 const isDeclined = assignment.acceptance_status === "DECLINED";
                const isExpired = assignment.acceptance_status === "EXPIRED";
                const isPendingOffer = !isAccepted && !isDeclined && !isExpired;

                // Format WhatsApp invitation URL
                const magicUrl = opsUrl(`/crew/${assignment.magic_token}`);
 const waPhone = member?.phone?.replace(/[^0-9]/g, "").replace(/^0/, "62") || "";
                const waMessage = encodeURIComponent(
 `Halo *${member?.full_name}*,\nKamu ditugaskan pada proyek *${projectName}*:\n\n• Peran: *${assignment.role_title}*\n• Honor Ditawarkan: *Rp ${Number(assignment.fee_agreed).toLocaleString("id-ID")}*\n• Call Time: *${new Date(assignment.call_time).toLocaleString("id-ID")}*\n• Venue: *${assignment.venue_name}*\n\nBuka & konfirmasi tugasmu melalui tautan resmi ini:\n${magicUrl}\n\nTerima kasih!`
                );
 const waLink = `https://wa.me/${waPhone}?text=${waMessage}`;

                return (
                  <div
                    key={assignment.id}
                  className={`p-4 rounded-[12px] border transition-all ${
                    isAccepted
                      ? "border-[#09090b] bg-white "
                      : isDeclined
                        ? "border-[#09090b] bg-[#09090b] "
                        : "border-[#ececee] bg-[#fafafa] "
                  }`}
                  >
 <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-2.5">
                      <div>
 <div className="flex items-center gap-2 mb-1">
                          <h5 className={`font-bold text-sm ${isDeclined ? "text-white " : "text-[#09090b] "}`}>
                            {assignment.role_title}
                          </h5>
                          {/* Acceptance Status Badges */}
                          {isAccepted && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border border-[#09090b] bg-white text-[#09090b] ">
                              <CheckCircle2 size={11} /> Dikonfirmasi Kru
                            </span>
                          )}
                          {isPendingOffer && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-[#ff5a00] text-white ">
                              <Clock size={11} /> Menunggu Konfirmasi
                            </span>
                          )}
                          {isExpired && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border border-[#ececee] bg-white text-[#a1a1aa] ">
                              <Clock size={11} /> Kedaluwarsa
                            </span>
                          )}
                          {isDeclined && (
                            <span
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-white/15 text-white "
                              title={assignment.declined_reason || undefined}
                            >
                              <AlertCircle size={11} /> Ditolak Kru
                            </span>
                          )}
                        </div>

                        <p className={`text-xs flex items-center gap-2 ${isDeclined ? "text-white/70 " : "text-[#52525b] "}`}>
                          <span className={`font-semibold ${isDeclined ? "text-white " : "text-[#3f3f46] "}`}>
                            {member?.full_name || "Kru"}
                          </span>
                          <span>•</span>
                          <span>{member?.crew_code}</span>
                          <span>•</span>
                          <span>Call: {new Date(assignment.call_time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB</span>
                        </p>
                      </div>

                      {/* Fee Badge */}
 <div className="text-right shrink-0">
                        <span className={`text-xs font-mono font-bold ${isDeclined ? "text-white " : "text-[#09090b] "}`}>
                          Rp {Number(assignment.fee_agreed).toLocaleString("id-ID")}
                        </span>
                        <p className={`text-[10px] ${isDeclined ? "text-white/70 " : "text-[#52525b] "}`}>
                          {isAccepted ? "Tersinkron ke RAB" : "Pending ACC"}
                        </p>
                      </div>
                    </div>

                    {/* Venue & Rejection Reason note if declined */}
                    {isDeclined && assignment.declined_reason && (
                      <div className="mb-3 p-2.5 rounded-[12px] border border-[#ececee] bg-[#fafafa] text-xs text-[#52525b] ">
                        Alasan penolakan: &quot;{assignment.declined_reason}&quot;
                      </div>
                    )}

                    {/* Actions Toolbar */}
                    <div className={`pt-2 border-t flex items-center justify-between text-xs ${isDeclined ? "border-white/15 " : "border-[#ececee] "}`}>
 <div className="flex items-center gap-1.5">
                        {/* Copy Link Button */}
                        <Button
 type="button"
 variant="outline"
 size="sm"
                          onClick={() => handleCopyLink(assignment)}
                          className="min-h-11 px-3 sm:px-2 text-[11px] gap-1 cursor-pointer"
                        >
                          {copiedId === assignment.id ? (
                            <>
                              <Check size={12} className="text-[#09090b]" />
                              <span>Tersalin!</span>
                            </>
                          ) : (
                            <>
                              <Copy size={12} />
                              <span>Salin Tautan</span>
                            </>
                          )}
                        </Button>

                        {/* WhatsApp Invite Button */}
                        {waPhone && (
                        <Button asChild size="sm" variant="outline" className="min-h-11 px-3 sm:px-2 text-[11px] gap-1 text-[#09090b] border-[#ececee] hover:bg-[#fafafa] ">
 <a href={waLink} target="_blank" rel="noreferrer">
                              <Send size={11} />
                              <span>Kirim WA</span>
                            </a>
                          </Button>
                        )}
                      </div>

                      {/* Unassign Button */}
                      <Button
 type="button"
 variant="ghost"
 size="sm"
                        onClick={() => setUnassignTarget(assignment)}
                        className="min-h-11 px-3 sm:px-2 text-[11px] text-[#52525b] hover:text-[#09090b] hover:bg-[#f4f4f5] gap-1 cursor-pointer"
                      >
                        <Trash2 size={12} />
                        <span>Batal Tugas</span>
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center text-xs text-[#52525b] bg-[#fafafa] rounded-[12px] border border-dashed border-[#d4d4d8] ">
                Belum ada stasiun tugas yang dialokasikan. Pilih kru dari kolom kiri untuk menugaskan.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2-Field Micro-Modal */}
      {selectedWorkerForModal && (
        <DispatchMicroModal
          projectId={projectId}
          projectName={projectName}
          shootDate={shootDate}
          venueName={venueName}
          venueAddress={venueAddress}
          venueMapsUrl={venueMapsUrl}
          worker={selectedWorkerForModal}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedWorkerForModal(null);
          }}
          onSuccess={(newAssignment) => {
            setAssignments((prev) => [...prev, newAssignment]);
          }}
        />
      )}

      {/* Unassign Confirmation Dialog */}
      {unassignTarget && (
 <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
        <div className="rounded-[36px] border border-[#ececee] bg-white p-5 max-w-sm w-full space-y-4 animate-in zoom-in-95">
          <div className="flex items-center gap-3 text-[#ff5a00]">
              <AlertTriangle size={20} />
            <h4 className="font-bold text-sm text-[#09090b] ">
                Batalkan Penugasan Kru?
              </h4>
            </div>

          <p className="text-xs text-[#52525b] leading-relaxed">
 Penugasan untuk <strong>{unassignTarget.crew_member?.full_name}</strong> sebagai{" "}
              <strong>{unassignTarget.role_title}</strong> akan dibatalkan. Jika honor sudah masuk ke RAB, baris pengeluaran akan otomatis dihapus.
            </p>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#ececee] ">
              <Button
 type="button"
 variant="outline"
 size="sm"
                onClick={() => setUnassignTarget(null)}
                disabled={isPending}
                className="text-xs"
              >
                Kembali
              </Button>
              <Button
 type="button"
 size="sm"
                onClick={handleConfirmUnassign}
                disabled={isPending}
                className="bg-[#09090b] hover:bg-[#27272a] text-white text-xs gap-1.5"
              >
 {isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                <span>Konfirmasi Batal</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
