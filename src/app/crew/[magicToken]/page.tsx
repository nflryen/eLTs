import type { Metadata } from "next";
import Link from "next/link";
import {
  FileText,
  UploadCloud,
  ExternalLink,
  ShieldAlert,
  HardDrive,
  Sparkles,
  Phone,
  Lock,
  XCircle,
  CheckCircle2,
} from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import type { CrewHubPayload } from "@/types/operations";
import { CallSheetView } from "@/components/crew/call-sheet-view";
import { EquipmentChecklist } from "@/components/crew/equipment-checklist";
import { FeeSlipCard } from "@/components/crew/fee-slip-card";
import { OfferAcceptanceCard } from "@/components/crew/offer-acceptance-card";

interface Props {
  params: Promise<{ magicToken: string }>;
}

/* Static metadata: the route parameter is not used in the <head>. */
export async function generateMetadata(): Promise<Metadata> {
  return {
 title: "Field Crew Dispatch & Call Sheet | ELTS. Operations",
 description: "Portal penugasan kru lapangan produksi studio ELTS.",
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function CrewHubPage({ params }: Props) {
  const { magicToken } = await params;

  /*
   * FAIL CLOSED — one reader, one DTO.
   *
   * This page previously carried a raw `from("project_crew_assignments")`
   * fallback that rebuilt the payload by hand, plus a second fallback that
   * returned a hardcoded fixture (complete with a bank name and account number)
   * for any token starting with `crw-token-`. Both are gone:
   *
   *   • the raw query bypassed `get_crew_hub_payload()`, which is the audited
   *     zero-leakage contract — a column added to the table would have appeared
   *     here with no review (finding B5);
   *   • the fixture rendered plausible financial data to anonymous visitors in
   *     production, because the `crw-token-` prefix is public in older links.
   *
   * If the RPC fails, the crew member sees the invalid-token screen. That is the
   * correct degradation: a portal that invents a call sheet is worse than one
   * that admits it cannot read it.
   *
   * The token is the only credential here, so the anon-key client is scoped to
   * the SECURITY DEFINER function rather than the service role.
   */
  const supabase = await createServerSupabase();
  let payload: CrewHubPayload | null = null;

  try {
    const { data, error } = await supabase.rpc("get_crew_hub_payload", {
      p_magic_token: magicToken,
    });
    /*
     * The RPC returns jsonb, which the `Database` type can only describe as
     * `Record<string, unknown>`. Narrowing it to `CrewHubPayload` therefore has
     * to go through `unknown`: the two types share no declared members, so a
     * direct cast is rejected — and rightly so, since nothing at the type level
     * proves the JSON matches the DTO.
     *
     * The runtime guard below is what actually validates it: an `error` key
     * means the token was rejected, and the page renders the not-found screen.
     */
    if (!error && data && !(data as { error?: string }).error) {
      payload = data as unknown as CrewHubPayload;
    }
  } catch {
    // Fall through to the invalid-token screen.
  }

  // Error / Invalid Token View
  if (!payload || payload.error) {
    return (
 <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
 <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full border border-[#ff5a00]/20 bg-[#ff5a00]/10 text-[#c2410c]">
 <ShieldAlert className="size-6" />
          </div>
 <h1 className="font-serif text-2xl font-bold text-foreground mb-2">
            Akses Kru Tidak Ditemukan
          </h1>
 <p className="text-xs text-muted-foreground leading-relaxed mb-6">
            Tautan kru tidak ditemukan atau telah kedaluwarsa. Pastikan Anda membuka link dispatch resmi yang dikirimkan oleh Production Manager studio.
          </p>
 <div className="pt-4 border-t border-border/80">
            <Link
 href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-[14px] border border-[#ececee] bg-[#fafafa] px-4 text-xs font-semibold text-[#18181b] transition-colors hover:bg-[#f4f4f5]"
            >
              Kembali ke Beranda
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const pillarFormatted = payload.project.service_pillar
 .replace(/_/g, " ")
    .toLowerCase();

 const isDeclined = payload.acceptance_status === "DECLINED";
 const isPending = payload.acceptance_status === "PENDING_OFFER";
 const isAccepted = payload.acceptance_status === "ACCEPTED" || (!isDeclined && !isPending);

  return (
 <div className="min-h-screen bg-background text-foreground py-6 sm:py-10 px-4 sm:px-6">
 <div className="max-w-2xl mx-auto space-y-6">
        {/* Top Operational Branding Header */}
 <header className="bg-card border border-border rounded-xl p-6 sm:p-7 shadow-sm">
 <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
 <div className="flex items-center gap-2">
 <span className="font-serif tracking-widest text-sm font-bold text-foreground">
                ELTS.
              </span>
 <span className="text-muted-foreground text-xs font-mono">/</span>
 <span className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
                Field Operations Portal
              </span>
            </div>
 <div className="flex items-center gap-2">
              {isAccepted && (
                <span className="inline-flex items-center gap-1 rounded-md border border-[#ececee] bg-[#fafafa] px-2.5 py-1 text-[11px] font-semibold text-[#09090b]">
                  <CheckCircle2 className="size-3" />
                  <span>TUGAS DISETUJUI</span>
                </span>
              )}
              {isPending && (
                <span className="inline-flex items-center gap-1 rounded-md border border-[#ff5a00]/20 bg-[#ff5a00]/10 px-2.5 py-1 text-[11px] font-semibold text-[#c2410c]">
                  <span className="size-1.5 animate-pulse rounded-full bg-[#ff5a00]" />
                  <span>MENUNGGU PERSETUJUAN</span>
                </span>
              )}
 <span className="font-mono text-xs font-semibold bg-secondary px-2.5 py-1 rounded-md text-foreground border border-border">
                {payload.crew_member.crew_code}
              </span>
            </div>
          </div>

 <div className="border-t border-border/60 pt-4">
 <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
              <div>
 <p className="text-xs font-medium text-muted-foreground capitalize">
                  {pillarFormatted}
                </p>
 <h1 className="font-serif text-2xl sm:text-3xl font-bold text-foreground mt-0.5 tracking-tight">
                  {payload.project.name}
                </h1>
              </div>
            </div>

 <div className="mt-4 p-3.5 bg-secondary/30 rounded-lg border border-border/60 flex items-center justify-between">
              <div>
 <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Petugas Ditugaskan
                </p>
 <p className="text-sm font-bold text-foreground">
                  {payload.crew_member.full_name}
                </p>
              </div>
 <div className="text-right">
 <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Posisi / Role
                </p>
 <p className="text-xs font-semibold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full inline-block mt-0.5">
                  {payload.role_title}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* State 1: DECLINED NOTICE */}
        {isDeclined && (
          <div className="space-y-5 rounded-2xl border border-[#ff5a00]/30 bg-card p-6 text-center shadow-sm sm:p-8">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-[#ff5a00]/20 bg-[#ff5a00]/10 text-[#c2410c]">
 <XCircle className="size-7" />
            </div>
            <div>
 <h2 className="font-serif text-2xl font-bold text-foreground mb-2">
                Anda telah menolak penugasan ini.
              </h2>
 <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                Penolakan telah dicatat pada sistem operasi ELTS. Slot penugasan ini telah dikembalikan ke tim manajemen produksi untuk dialokasikan kepada kru pengganti.
              </p>
            </div>

            {payload.declined_reason && (
 <div className="max-w-md mx-auto p-3.5 bg-secondary/50 rounded-xl border border-border/80 text-xs text-left space-y-1">
 <span className="font-semibold text-foreground uppercase tracking-wider text-[10px] block">
                  Alasan Penolakan Tercatat:
                </span>
 <p className="text-foreground/90 italic">
                  &ldquo;{payload.declined_reason}&rdquo;
                </p>
              </div>
            )}

 <div className="pt-4 border-t border-border flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
 href="/"
 className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-secondary text-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors"
              >
                Kembali ke Beranda
              </Link>
              <a
 href="https://wa.me/6281234567890?text=Halo%20Studio%20ELTS,%20saya%20ingin%20mengonfirmasi%20kembali%20jadwal%20penugasan%20kru."
 target="_blank"
 rel="noopener noreferrer"
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-primary px-5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
              >
 <Phone className="size-3.5" />
                <span>Hubungi Koordinator Studio</span>
              </a>
            </div>
          </div>
        )}

        {/* State 2: PENDING OFFER (PROMINENT ACCEPTANCE CARD + LOCKED CALL SHEET PREVIEW) */}
        {isPending && (
 <div className="space-y-6">
            <OfferAcceptanceCard
              magicToken={magicToken}
              roleTitle={payload.role_title}
              projectName={payload.project.name}
              servicePillar={payload.project.service_pillar}
              shootDate={payload.project.shoot_date}
              callTime={payload.call_time}
              rollTime={payload.roll_time}
              venueName={payload.venue_name}
              venueAddress={payload.venue_address}
              venueMapsUrl={payload.venue_maps_url}
              feeAgreed={payload.fee_agreed}
              bankName={payload.crew_member.bank_name}
              bankAccountNumber={payload.crew_member.bank_account_number}
              bankAccountHolder={payload.crew_member.bank_account_holder}
              crewMemberName={payload.crew_member.full_name}
            />

            {/* Locked Call Sheet & Equipment Preview with Blur Overlay */}
 <div className="relative rounded-2xl overflow-hidden border border-dashed border-border/80 bg-muted/20">
 <div className="sticky top-20 z-20 py-8 px-4 flex flex-col items-center justify-center text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-full border border-[#ff5a00]/30 bg-[#ff5a00]/15 text-[#c2410c] shadow-md backdrop-blur-md">
 <Lock className="size-6" />
                </div>
 <h3 className="font-serif text-lg font-bold text-foreground">
                  Rincian Call Sheet & Logistik Terkunci
                </h3>
 <p className="text-xs text-muted-foreground mt-1.5 max-w-md leading-relaxed">
                  Rundown teknis lengkap, koordinat venue, tombol check-in kehadiran lapangan, checklist perlengkapan, dan folder Cloud Vault akan aktif setelah Anda menerima tawaran penugasan di atas.
                </p>
              </div>

 <div className="filter blur-[5px] opacity-35 select-none pointer-events-none space-y-6 p-4 mt-[-130px]">
                <CallSheetView
                  magicToken={magicToken}
                  shootDate={payload.project.shoot_date}
                  callTime={payload.call_time}
                  rollTime={payload.roll_time}
                  venueName={payload.venue_name}
                  venueAddress={payload.venue_address}
                  venueMapsUrl={payload.venue_maps_url}
                  dressCode={payload.dress_code}
                  initialCheckInAt={payload.check_in_at}
                />

                {payload.technical_notes && (
 <div className="bg-card border border-border rounded-xl p-6 sm:p-7 shadow-sm">
 <div className="flex items-center gap-2.5 text-xs font-semibold tracking-wider uppercase text-muted-foreground border-b border-border/80 pb-4 mb-4">
 <FileText className="size-4 text-foreground" />
                      <span>Instruksi Teknis & Rundown Lapangan</span>
                    </div>
 <div className="p-4 bg-secondary/30 rounded-lg border border-border/60 text-xs text-foreground leading-relaxed whitespace-pre-line font-mono">
                      {payload.technical_notes}
                    </div>
                  </div>
                )}

                <EquipmentChecklist
                  allocatedEquipment={payload.allocated_equipment || []}
                />
              </div>
            </div>
          </div>
        )}

        {/* State 3: ACCEPTED (FULL UNLOCKED OPERATIONS DASHBOARD) */}
        {isAccepted && (
          <>
            {/* 1. Call Sheet Card */}
            <CallSheetView
              magicToken={magicToken}
              shootDate={payload.project.shoot_date}
              callTime={payload.call_time}
              rollTime={payload.roll_time}
              venueName={payload.venue_name}
              venueAddress={payload.venue_address}
              venueMapsUrl={payload.venue_maps_url}
              dressCode={payload.dress_code}
              initialCheckInAt={payload.check_in_at}
            />

            {/* 2. Technical Directives & Rundown */}
            {payload.technical_notes && (
 <div className="bg-card border border-border rounded-xl p-6 sm:p-7 shadow-sm">
 <div className="flex items-center gap-2.5 text-xs font-semibold tracking-wider uppercase text-muted-foreground border-b border-border/80 pb-4 mb-4">
 <FileText className="size-4 text-foreground" />
                  <span>Instruksi Teknis & Rundown Lapangan</span>
                </div>
 <div className="p-4 bg-secondary/30 rounded-lg border border-border/60 text-xs text-foreground leading-relaxed whitespace-pre-line font-mono">
                  {payload.technical_notes}
                </div>
              </div>
            )}

            {/* 3. Equipment Station */}
            <EquipmentChecklist
              allocatedEquipment={payload.allocated_equipment || []}
            />

            {/* 4. Raw Drop Vault Card */}
 <div className="bg-card border border-border rounded-xl p-6 sm:p-7 shadow-sm">
 <div className="flex items-center justify-between border-b border-border/80 pb-4 mb-4">
 <div className="flex items-center gap-2.5 text-xs font-semibold tracking-wider uppercase text-muted-foreground">
 <HardDrive className="size-4 text-foreground" />
                  <span>Raw Drop Vault & Media Offload</span>
                </div>
 <span className="text-[10px] font-semibold uppercase tracking-wider bg-secondary text-muted-foreground px-2 py-0.5 rounded">
                  Pasca-Produksi
                </span>
              </div>

 <p className="text-xs text-muted-foreground leading-relaxed mb-4">
                Setelah proses perekaman selesai, seluruh file RAW (foto/video/audio) wajib di-offload ke folder cloud storage studio atau diserahkan langsung ke DIT / Manager Produksi.
              </p>

              {payload.raw_drop_url ? (
                <a
                  href={payload.raw_drop_url}
 target="_blank"
 rel="noopener noreferrer"
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-xs font-semibold text-primary-foreground transition-colors hover:bg-[#3c3b37]"
                >
 <UploadCloud className="size-4" />
                  <span>Buka Folder Cloud Vault (Google Drive / Cloud)</span>
 <ExternalLink className="size-3.5 opacity-70" />
                </a>
              ) : (
 <div className="p-4 rounded-lg bg-secondary/20 border border-dashed border-border text-center">
 <p className="text-xs font-medium text-foreground">
                    Offload Fisik di Lokasi
                  </p>
 <p className="text-[11px] text-muted-foreground mt-0.5">
                    Serahkan memory card (SD / CFexpress) kepada Production Coordinator untuk backup SSD ganda sebelum meninggalkan venue.
                  </p>
                </div>
              )}
            </div>

            {/* 5. Fee Slip Card */}
            <FeeSlipCard
              feeAgreed={payload.fee_agreed}
              paymentStatus={payload.payment_status}
              paidAt={payload.paid_at}
              paymentReceiptUrl={payload.payment_receipt_url}
              bankName={payload.crew_member.bank_name}
              bankAccountNumber={payload.crew_member.bank_account_number}
              bankAccountHolder={payload.crew_member.bank_account_holder}
              crewName={payload.crew_member.full_name}
              crewCode={payload.crew_member.crew_code}
              projectName={payload.project.name}
              roleTitle={payload.role_title}
            />
          </>
        )}

        {/* Footer Support */}
 <footer className="text-center py-4 text-xs text-muted-foreground space-y-2">
          <p>
            Memerlukan bantuan di lapangan? Hubungi Koordinator Lapangan Studio ELTS.
          </p>
 <div className="flex items-center justify-center gap-4 text-[11px]">
 <span className="flex items-center gap-1 font-mono">
              <Sparkles className="size-3 text-[#ff5a00]" />
              ELTS. Production Engine
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
