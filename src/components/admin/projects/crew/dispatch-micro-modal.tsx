"use client";

import { useState, useTransition } from "react";
import {
  X,
  DollarSign,
  Briefcase,
  Loader2,
  Send,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CrewMemberRow, ProjectCrewAssignmentWithCrew } from "@/types/operations";
import { assignCrewToProject } from "@/app/actions/crew";

interface DispatchMicroModalProps {
  projectId: string;
  projectName?: string;
  shootDate?: string | null;
  venueName?: string;
  venueAddress?: string;
  venueMapsUrl?: string;
  worker: CrewMemberRow | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newAssignment: ProjectCrewAssignmentWithCrew) => void;
}

const QUICK_ROLES = [
 "FOH Switcher / Technical Director",
 "Cam 1 Master Steady (Wide)",
 "Cam 2 Roving Wireless (Mobile)",
 "Audio Engineer & Relay",
 "Gaffer & Lighting Tech",
 "Lead Video Editor",
 "Photo Lead / Portrait Specialist",
];

export function DispatchMicroModal({
  projectId,
  shootDate,
 venueName = "Graha Widyatama UNSOED",
 venueAddress = "Purwokerto Utara",
 venueMapsUrl = "",
  worker,
  isOpen,
  onClose,
  onSuccess,
}: DispatchMicroModalProps) {
 const [roleTitle, setRoleTitle] = useState("");
  const [feeAgreed, setFeeAgreed] = useState<number>(0);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync worker defaults when opened
  useState(() => {
    if (worker) {
      const defaultRole =
        worker.jobdesk_specialties?.[0] ||
        worker.primary_skills?.[0] ||
 "Production Crew";
      setRoleTitle(defaultRole);
      setFeeAgreed(Number(worker.standard_day_rate) || 450000);
    }
  });

  if (!isOpen || !worker) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!roleTitle.trim()) {
 setErrorMsg("Pilih atau isi peran/jobdesk.");
      return;
    }

    startTransition(async () => {
      const defaultCallTime = shootDate
 ? `${shootDate}T06:30:00+07:00`
        : new Date(Date.now() + 86400000).toISOString();

      const res = await assignCrewToProject({
        projectId,
        crewMemberId: worker.id,
        roleTitle: roleTitle.trim(),
        callTime: defaultCallTime,
 venueName: venueName || "Lokasi Acara",
 venueAddress: venueAddress || "-",
        venueMapsUrl: venueMapsUrl || null,
        feeAgreed: Number(feeAgreed) || 0,
        allocatedEquipment: [],
 dressCode: "Seragam Hitam / Studio Polo",
      });

      if (!res.success || !res.assignmentId) {
 setErrorMsg(res.error || "Gagal menugaskan kru.");
        return;
      }

      onSuccess({
        id: res.assignmentId,
        project_id: projectId,
        crew_member_id: worker.id,
 magic_token: res.magicToken || "",
        role_title: roleTitle.trim(),
        call_time: defaultCallTime,
        roll_time: null,
        venue_name: venueName,
        venue_address: venueAddress,
        venue_maps_url: venueMapsUrl,
 dress_code: "Seragam Hitam / Studio Polo",
        technical_notes: null,
        allocated_equipment: [],
        raw_drop_url: null,
        fee_agreed: Number(feeAgreed) || 0,
 payment_status: "UNPAID",
        paid_at: null,
        payment_receipt_url: null,
        check_in_at: null,
 acceptance_status: "PENDING_OFFER",
        accepted_at: null,
        declined_at: null,
        declined_reason: null,
        revoked_at: null,
        offer_expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        crew_member: {
          id: worker.id,
          crew_code: worker.crew_code,
          full_name: worker.full_name,
          primary_skills: worker.primary_skills || [],
          /*
           * Contact and payout are NOT part of the optimistic row: migration
           * 0024 moved them out of crew_members, and this client only received
           * assignment-safe fields. The authoritative values arrive when the
           * server refreshes the workspace, so omitting them here is correct
           * rather than a missing-data bug.
           */
        },
      });

      onClose();
    });
  };

  return (
 <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="rounded-[36px] border border-[#ececee] bg-white max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-[#ececee] ">
 <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[12px] bg-[#09090b] text-white flex items-center justify-center font-bold text-xs">
 {worker.crew_code.replace("CRW-", "")}
            </div>
            <div>
            <h3 className="font-bold text-sm text-[#09090b] ">
                Tugaskan: {worker.full_name}
              </h3>
            <p className="text-[11px] text-[#52525b] ">
                Tawaran akan dikirimkan dengan status PENDING_OFFER
              </p>
            </div>
          </div>
          <button
 type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 inline-flex items-center justify-center text-[#52525b] hover:text-[#09090b] rounded-[12px] hover:bg-[#fafafa] transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* 2-Field Minimal Form */}
 <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-[12px] border border-[#ff5a00]/50 bg-[#ff5a00]/10 text-[#ff5a00] text-xs flex items-center gap-2">
 <AlertCircle size={14} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 1. Jobdesk / Role Selection */}
 <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#3f3f46] flex items-center gap-1.5">
            <Briefcase size={13} className="text-[#3f3f46]" />
              <span>1. Peran / Jobdesk Stasiun Lapangan</span>
            <span className="text-[#ff5a00]">*</span>
            </label>
            <input
 type="text"
              required
 placeholder="e.g. FOH Switcher / Technical Director"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
 className="contact-input text-xs font-medium"
            />
            {/* Quick chips */}
 <div className="flex flex-wrap gap-1 pt-1">
              {QUICK_ROLES.slice(0, 4).map((role) => (
                <button
                  key={role}
 type="button"
                  onClick={() => setRoleTitle(role)}
                  className={`min-h-11 text-[10px] px-2 py-0.5 rounded-[12px] border transition cursor-pointer ${
                    roleTitle === role
                      ? "bg-[#09090b] text-white border-[#09090b] font-bold"
                      : "bg-[#fafafa] border-[#ececee] text-[#52525b] hover:bg-[#f4f4f5]"
 }`}
                >
 {role.split(" (")[0]}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Offered Fee / Salary */}
 <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#3f3f46] flex items-center gap-1.5">
            <DollarSign size={13} className="text-[#3f3f46]" />
              <span>2. Nominal Honor yang Ditawarkan (IDR)</span>
            <span className="text-[#ff5a00]">*</span>
          </label>
          <div className="relative">
              <span className="absolute left-3 top-2.5 text-xs text-[#52525b] font-mono">
                Rp
              </span>
              <input
 type="number"
                min={0}
                step={25000}
                required
                value={feeAgreed}
                onChange={(e) => setFeeAgreed(Number(e.target.value))}
 className="contact-input pl-9 text-xs font-mono font-semibold"
              />
            </div>
            <p className="text-[10px] text-[#52525b] flex items-center justify-between">
              <span>Standard Day Rate profil: Rp {(Number(worker.standard_day_rate) || 0).toLocaleString("id-ID")}</span>
              <span className="text-[#ff5a00] font-medium">Masuk RAB setelah ACC</span>
            </p>
          </div>

          {/* Action buttons */}
          <div className="pt-3 border-t border-[#ececee] flex items-center justify-end gap-2">
            <Button
 type="button"
 variant="outline"
 size="sm"
              onClick={onClose}
              disabled={isPending}
 className="text-xs"
            >
              Batal
            </Button>
            <Button
 type="submit"
 size="sm"
              disabled={isPending}
              className="bg-[#09090b] hover:bg-[#27272a] text-white text-xs gap-1.5 font-semibold"
            >
              {isPending ? (
                <>
 <Loader2 size={13} className="animate-spin" /> Menugaskan...
                </>
              ) : (
                <>
                  <Send size={13} /> Kirim Tawaran Tugas
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
