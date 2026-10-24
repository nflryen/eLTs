"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Sparkles,
  Layers,
  RotateCcw,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CustomerRow } from "@/types/database";
import type { Pricelist, PricelistCategory, PricelistPackage } from "@/lib/pricelist";
import {
  SERVICE_PILLARS,
  type ServicePillarType,
  getDefaultSectorSpecs,
} from "@/types/sectors";
import {
  getPillarCategories,
  resolvePhotographyTypeFromCategory,
  extractPhotoQuotaFromIncludes,
  syncPackageToSectorSpecs,
} from "@/lib/projects/wizard-sync";
import {
  createProjectDraftAction,
  updateProjectWizardStepAction,
  completeProjectScaffoldAction,
} from "@/app/actions/admin-projects";

interface ProjectCreationWizardProps {
  customers: CustomerRow[];
  pricelist?: Pricelist;
}

export function ProjectCreationWizard({
  customers,
  pricelist,
}: ProjectCreationWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Draft project ID once Step 1 persists
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);

  // Step 1 State: Sector & Core
  const [servicePillar, setServicePillar] = useState<ServicePillarType>(
    "BROADCAST_LIVE_STREAMING"
  );
  const [customerId, setCustomerId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [slugPreview, setSlugPreview] = useState("");

  // Pricelist Package Selection State
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [activeCategorySlug, setActiveCategorySlug] = useState<string>("all");

  const categories = pricelist?.categories ?? [];
  const relevantCategories = getPillarCategories(servicePillar, categories);

  // Flattened list of packages for the current pillar and category filter
  const availablePackages: Array<{ pkg: PricelistPackage; category: PricelistCategory }> = [];
  for (const cat of relevantCategories) {
    if (activeCategorySlug === "all" || activeCategorySlug === cat.slug) {
      for (const p of cat.packages) {
        availablePackages.push({ pkg: p, category: cat });
      }
    }
  }

  // Currently selected package object
  let selectedPackage: { pkg: PricelistPackage; category: PricelistCategory } | null = null;
  for (const cat of categories) {
    const found = cat.packages.find((p) => p.id === selectedPackageId);
    if (found) {
      selectedPackage = { pkg: found, category: cat };
      break;
    }
  }

  // Step 2 State: Temporal Staging
  const [shootDate, setShootDate] = useState("");
  const [rollTime, setRollTime] = useState("07:30");
  const [hasRehearsal, setHasRehearsal] = useState(false);
  const [rehearsalDate, setRehearsalDate] = useState("");
  const [rehearsalCallTime, setRehearsalCallTime] = useState("14:00");
  const [venueName, setVenueName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [venueMapsUrl, setVenueMapsUrl] = useState("");

  // Step 3 State: Commercial Baseline
  const [contractValue, setContractValue] = useState("1500000");
  const [dpPercentage, setDpPercentage] = useState(50);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  // Handle Project Name changes with live slug preview
  const handleNameChange = (val: string) => {
    setProjectName(val);
    const generated = val
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    setSlugPreview(generated ? `${generated}-2026` : "");
  };

  // Change Service Pillar and validate selected package
  const handlePillarChange = (newPillar: ServicePillarType) => {
    setServicePillar(newPillar);
    setActiveCategorySlug("all");
    const newRelevant = getPillarCategories(newPillar, categories);
    const stillValid = newRelevant.some((cat) =>
      cat.packages.some((p) => p.id === selectedPackageId)
    );
    if (!stillValid) {
      setSelectedPackageId(null);
    }
  };

  // Click on a pricelist package card
  const handlePackageClick = (pkg: PricelistPackage, _category: PricelistCategory) => {
    if (selectedPackageId === pkg.id) {
      // Toggle off to custom
      setSelectedPackageId(null);
      return;
    }
    setSelectedPackageId(pkg.id);
    setContractValue(pkg.priceIdr.toString());

    // Auto-suggest project name if empty
    if (!projectName.trim() && selectedCustomer) {
      handleNameChange(`${selectedCustomer.name} — ${pkg.name}`);
    } else if (!projectName.trim()) {
      handleNameChange(pkg.name);
    }
  };

  // STEP 1 SUBMIT -> Autosave Draft
  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!customerId) {
      setErrorMessage("Pilih klien yang memesan proyek.");
      return;
    }
    if (!projectName.trim()) {
      setErrorMessage("Masukkan nama proyek.");
      return;
    }

    startTransition(async () => {
      let photographyType: string | undefined = undefined;
      if (selectedPackage) {
        photographyType = resolvePhotographyTypeFromCategory(selectedPackage.category.slug);
      }

      const res = await createProjectDraftAction({
        customer_id: customerId,
        name: projectName.trim(),
        slug: slugPreview,
        service_pillar: servicePillar,
        photography_type: photographyType,
      });

      if (!res.success || !res.project) {
        setErrorMessage(res.error || "Gagal menyimpan draft proyek.");
        return;
      }

      setDraftProjectId(res.project.id);
      setStep(2);
    });
  };

  // STEP 2 SUBMIT -> Save Staging & Schedule
  const handleStep2Submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!draftProjectId) {
      setErrorMessage("ID draft proyek tidak ditemukan.");
      return;
    }

    startTransition(async () => {
      let defaultSpecs = getDefaultSectorSpecs(servicePillar);

      // Merge package deliverables into sector specs if package is selected
      if (selectedPackage) {
        defaultSpecs = syncPackageToSectorSpecs(
          servicePillar,
          selectedPackage.pkg,
          selectedPackage.category,
          defaultSpecs
        );
      }

      // Merge rehearsal into specs if broadcast
      if (hasRehearsal && servicePillar === "BROADCAST_LIVE_STREAMING" && defaultSpecs.broadcast) {
        defaultSpecs.broadcast.rehearsalDate = rehearsalDate || null;
        defaultSpecs.broadcast.rehearsalCallTime = rehearsalCallTime || null;
      }

      // Determine photography type and quota from package category if available
      let photographyType: string | undefined = undefined;
      let selectionQuotaMax: number | undefined = undefined;
      let selectionQuotaMin: number | undefined = undefined;

      if (selectedPackage) {
        photographyType = resolvePhotographyTypeFromCategory(selectedPackage.category.slug);
        const quota = extractPhotoQuotaFromIncludes(selectedPackage.pkg.includes);
        if (quota) {
          selectionQuotaMax = quota;
          selectionQuotaMin = Math.min(15, quota);
        }
      }

      const res = await updateProjectWizardStepAction(draftProjectId, {
        shoot_date: shootDate || null,
        rehearsal_date: hasRehearsal ? rehearsalDate || null : null,
        venue_name: venueName || undefined,
        venue_address: venueAddress || undefined,
        venue_maps_url: venueMapsUrl || undefined,
        roll_time: rollTime,
        sector_specs: defaultSpecs as Record<string, unknown>,
        photography_type: photographyType,
        selection_quota_min: selectionQuotaMin,
        selection_quota_max: selectionQuotaMax,
      });

      if (!res.success) {
        setErrorMessage(res.error || "Gagal menyimpan jadwal.");
        return;
      }

      setStep(3);
    });
  };

  // STEP 3 SUBMIT -> Finalize & Redirect
  const handleStep3Submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!draftProjectId) {
      setErrorMessage("ID draft proyek tidak ditemukan.");
      return;
    }

    startTransition(async () => {
      const numericContract = Number(contractValue) || 0;
      const dpAmount = Math.round(numericContract * (dpPercentage / 100));

      const updateRes = await updateProjectWizardStepAction(draftProjectId, {
        contract_value: numericContract,
        dp_amount: dpAmount,
      });

      if (!updateRes.success) {
        setErrorMessage(updateRes.error || "Gagal menyimpan nilai kontrak.");
        return;
      }

      const finishRes = await completeProjectScaffoldAction(draftProjectId);
      if (!finishRes.success || !finishRes.redirectUrl) {
        setErrorMessage(finishRes.error || "Gagal mengaktifkan proyek.");
        return;
      }

      router.push(finishRes.redirectUrl);
    });
  };

  return (
    <div className="max-w-3xl mx-auto py-4">
      {/* Top Header */}
      <div className="mb-8">
        <Link
          href="/admin/projects"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft size={14} /> Kembali ke Daftar Proyek
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <span className="eyebrow block mb-1">STAGED PROJECT WIZARD</span>
            <h1 className="font-serif text-3xl font-bold tracking-tight">
              Scaffold Proyek Baru
            </h1>
          </div>
          {draftProjectId && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-medium bg-[#09090b]/5 text-[#09090b] border border-[#09090b]/20">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Draft Tersimpan ({draftProjectId.slice(0, 8)})
            </span>
          )}
        </div>
      </div>

      {/* Step Tracker Indicator */}
      <div className="bg-white border border-border rounded-xl p-4 mb-8 shadow-xs">
        <div className="grid grid-cols-3 gap-2 text-center text-xs font-medium">
          <div
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-colors ${
              step === 1
                ? "bg-[#ff5a00] text-white font-semibold"
                : "bg-[#fafafa] text-[#71717a]"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[11px]">
              1
            </span>
            <span>Sektor & Layanan</span>
          </div>

          <div
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-colors ${
              step === 2
                ? "bg-[#ff5a00] text-white font-semibold"
                : step > 2
                ? "bg-[#09090b]/5 text-[#09090b] border border-[#09090b]/25"
                : "bg-[#fafafa] text-[#a1a1aa]"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[11px]">
              2
            </span>
            <span>Staging & Venue</span>
          </div>

          <div
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg transition-colors ${
              step === 3
                ? "bg-[#ff5a00] text-white font-semibold"
                : "bg-[#fafafa] text-[#a1a1aa]"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[11px]">
              3
            </span>
            <span>Komersial & Rilis</span>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="mb-6 p-4 bg-[#ff5a00]/10 border border-[#ff5a00]/40 rounded-xl flex items-start gap-3 text-[#ff5a00] text-sm">
          <AlertCircle size={18} className="shrink-0 text-[#ff5a00] mt-0.5" />
          <p>{errorMessage}</p>
        </div>
      )}

      {/* STEP 1: SECTOR DNA & PRICELIST PACKAGE */}
      {step === 1 && (
        <form onSubmit={handleStep1Submit} className="space-y-6">
          <div className="bg-white border border-border rounded-xl p-6 shadow-xs space-y-6">
            {/* 1. SECTOR DNA */}
            <div>
              <label className="block text-sm font-semibold text-[#09090b] mb-2">
                1. Pilih Pilar Layanan (Sector DNA) <span className="text-[#ff5a00]">*</span>
              </label>
              <div className="grid sm:grid-cols-3 gap-3">
                {SERVICE_PILLARS.map((p) => {
                  const isSelected = servicePillar === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handlePillarChange(p.id)}
                      className={`text-left p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? "border-[#09090b] bg-[#09090b] text-white shadow-sm ring-1 ring-[#09090b]"
                          : "border-border bg-[#fafafa] hover:bg-[#f4f4f5] text-[#3f3f46]"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase ${
                              isSelected
                                ? "bg-white/20 text-white"
                                : "bg-[#ececee] text-[#3f3f46]"
                            }`}
                          >
                            {p.badge}
                          </span>
                          {isSelected && <Check size={14} className="text-white" />}
                        </div>
                        <h4 className="font-bold text-sm leading-snug mb-1">
                          {p.title}
                        </h4>
                        <p
                          className={`text-xs leading-relaxed line-clamp-2 ${
                            isSelected ? "text-[#d4d4d8]" : "text-muted-foreground"
                          }`}
                        >
                          {p.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. PRICELIST PACKAGE INTEGRATION */}
            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-semibold text-[#09090b]">
                  2. Paket Layanan (Pricelist) <span className="text-[#a1a1aa] font-normal text-xs">(Opsional)</span>
                </label>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Sparkles size={11} className="text-emerald-600" /> Sinkronisasi Otomatis
                </span>
              </div>
              <p className="text-xs text-[#71717a] mb-3">
                Pilih paket dari pricelist aktif untuk mengisi nilai kontrak baseline, lingkup kerja, dan deliverables secara otomatis.
              </p>

              {/* Category Filter Tabs */}
              {relevantCategories.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  <button
                    type="button"
                    onClick={() => setActiveCategorySlug("all")}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      activeCategorySlug === "all"
                        ? "bg-[#09090b] text-white"
                        : "bg-[#f4f4f5] text-[#71717a] hover:bg-[#ececee]"
                    }`}
                  >
                    Semua Kategori ({relevantCategories.reduce((acc, c) => acc + c.packages.length, 0)})
                  </button>
                  {relevantCategories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setActiveCategorySlug(cat.slug)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        activeCategorySlug === cat.slug
                          ? "bg-[#09090b] text-white"
                          : "bg-[#f4f4f5] text-[#71717a] hover:bg-[#ececee]"
                      }`}
                    >
                      {cat.name} ({cat.packages.length})
                    </button>
                  ))}
                </div>
              )}

              {/* Package Cards Grid */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* Custom / No Package Card */}
                <button
                  type="button"
                  onClick={() => setSelectedPackageId(null)}
                  className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                    selectedPackageId === null
                      ? "border-[#09090b] bg-[#fafafa] ring-1 ring-[#09090b]"
                      : "border-border bg-white hover:bg-[#fafafa] text-[#71717a]"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#f4f4f5] text-[#52525b] font-medium uppercase">
                        Custom Scope
                      </span>
                      {selectedPackageId === null && <Check size={14} className="text-[#09090b]" />}
                    </div>
                    <h5 className="font-bold text-xs text-[#09090b] mb-1">Kustom / Tanpa Paket</h5>
                    <p className="text-[11px] text-[#71717a] leading-relaxed">
                      Tentukan nilai kontrak dan lingkup kerja kustom tanpa paket standar.
                    </p>
                  </div>
                  <p className="text-[11px] font-mono text-[#a1a1aa] mt-3 pt-2 border-t border-[#f4f4f5]">
                    Nilai kontrak manual
                  </p>
                </button>

                {/* Pricelist Packages */}
                {availablePackages.map(({ pkg, category }) => {
                  const isSelected = selectedPackageId === pkg.id;
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => handlePackageClick(pkg, category)}
                      className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? "border-[#09090b] bg-[#09090b] text-white shadow-sm ring-1 ring-[#09090b]"
                          : "border-border bg-white hover:bg-[#fafafa] text-[#3f3f46]"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span
                            className={`text-[9.5px] font-mono px-2 py-0.5 rounded-full font-medium ${
                              isSelected ? "bg-white/20 text-white" : "bg-[#f4f4f5] text-[#71717a]"
                            }`}
                          >
                            {category.name}
                          </span>
                          {isSelected && <Check size={14} className="text-white shrink-0" />}
                        </div>
                        <h5 className="font-bold text-sm leading-snug mb-1">{pkg.name}</h5>
                        <div className="flex items-baseline gap-1.5 my-1.5">
                          <span className={`font-mono text-sm font-bold ${isSelected ? "text-white" : "text-[#09090b]"}`}>
                            Rp {pkg.priceIdr.toLocaleString("id-ID")}
                          </span>
                          {pkg.duration && (
                            <span className={`text-[10px] font-mono ${isSelected ? "text-[#d4d4d8]" : "text-[#71717a]"}`}>
                              • {pkg.duration}
                            </span>
                          )}
                        </div>

                        {/* Scope / Includes Preview */}
                        {pkg.includes.length > 0 && (
                          <ul className="mt-2 space-y-1 text-[11px]">
                            {pkg.includes.slice(0, 2).map((item, idx) => (
                              <li
                                key={idx}
                                className={`line-clamp-1 flex items-center gap-1.5 ${
                                  isSelected ? "text-[#d4d4d8]" : "text-[#71717a]"
                                }`}
                              >
                                <span className="w-1 h-1 rounded-full bg-current shrink-0" />
                                <span>{item}</span>
                              </li>
                            ))}
                            {pkg.includes.length > 2 && (
                              <li className={`text-[10px] italic ${isSelected ? "text-[#a1a1aa]" : "text-[#a1a1aa]"}`}>
                                +{pkg.includes.length - 2} deliverable lainnya
                              </li>
                            )}
                          </ul>
                        )}
                      </div>

                      {pkg.crew.length > 0 && (
                        <p
                          className={`text-[10px] font-mono mt-2.5 pt-1.5 border-t line-clamp-1 ${
                            isSelected ? "border-white/10 text-[#a1a1aa]" : "border-[#f4f4f5] text-[#71717a]"
                          }`}
                        >
                          Kru: {pkg.crew.join(", ")}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Active Selection Banner */}
              {selectedPackage && (
                <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                    <span>
                      Paket Terpilih: <strong>{selectedPackage.category.name} — {selectedPackage.pkg.name}</strong> (Rp {selectedPackage.pkg.priceIdr.toLocaleString("id-ID")})
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-700">
                    {selectedPackage.pkg.includes.length} deliverables disinkronkan
                  </span>
                </div>
              )}
            </div>

            {/* 3. CLIENT & NAME */}
            <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-border">
              <div className="space-y-1.5">
                <label htmlFor="customer" className="text-xs font-bold text-[#3f3f46]">
                  3. Klien / Pemesan <span className="text-[#ff5a00]">*</span>
                </label>
                <select
                  id="customer"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  required
                  className="contact-input text-sm"
                >
                  <option value="">Pilih Klien / Instansi...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ""}
                    </option>
                  ))}
                </select>
                {selectedCustomer && (
                  <p className="text-[11px] text-muted-foreground">
                    Kontak: {selectedCustomer.phone || "-"} • {selectedCustomer.email || "Tanpa Email"}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="name" className="text-xs font-bold text-[#3f3f46]">
                  4. Nama Acara / Proyek <span className="text-[#ff5a00]">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  placeholder="e.g. Wisuda Ke-152 UNSOED 4-Cam Live Stream"
                  value={projectName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="contact-input text-sm font-medium"
                />
              </div>
            </div>

            {slugPreview && (
              <div className="p-3 bg-[#fafafa] rounded-lg border border-border text-xs text-muted-foreground flex items-center gap-2">
                <span className="font-mono text-[#a1a1aa]">URL Slug:</span>
                <span className="font-mono font-semibold text-[#3f3f46]">
                  /project/{slugPreview}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" asChild>
              <Link href="/admin/projects">Batal</Link>
            </Button>
            <Button type="submit" disabled={isPending} className="gap-2">
              {isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Menyimpan Draft...
                </>
              ) : (
                <>
                  Lanjut ke Staging & Jadwal <ArrowRight size={16} />
                </>
              )}
            </Button>
          </div>
        </form>
      )}

      {/* STEP 2: TEMPORAL STAGING & VENUE */}
      {step === 2 && (
        <form onSubmit={handleStep2Submit} className="space-y-6">
          <div className="bg-white border border-border rounded-xl p-6 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-serif text-lg font-bold">
                Jadwal Produksi & Titik Staging
              </h3>
              {selectedPackage && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                  <CheckCircle2 size={13} className="text-emerald-600" />
                  Paket: {selectedPackage.pkg.name} {selectedPackage.pkg.duration ? `(${selectedPackage.pkg.duration})` : ""}
                </span>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#3f3f46]">
                  Tanggal Acara / Hari-H (Shoot Date) <span className="text-[#ff5a00]">*</span>
                </label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={shootDate}
                    onChange={(e) => setShootDate(e.target.value)}
                    className="contact-input text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#3f3f46]">
                  Roll Time / Waktu Mulai Acara
                </label>
                <input
                  type="time"
                  value={rollTime}
                  onChange={(e) => setRollTime(e.target.value)}
                  className="contact-input text-sm"
                />
              </div>
            </div>

            {/* Rehearsal / D-1 Toggle */}
            <div className="p-4 bg-[#fafafa] rounded-xl border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-[#09090b]">
                    Memerlukan Gladi Bersih / Cabling Staging D-1?
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Sangat dianjurkan untuk FOH Live Streaming & Konser Musik
                  </p>
                </div>
                <input
                  type="checkbox"
                  id="rehearsal"
                  checked={hasRehearsal}
                  onChange={(e) => setHasRehearsal(e.target.checked)}
                  className="w-4 h-4 rounded text-[#09090b] cursor-pointer"
                />
              </div>

              {hasRehearsal && (
                <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-border/60">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[#52525b]">
                      Tanggal Rehearsal / Cabling
                    </label>
                    <input
                      type="date"
                      value={rehearsalDate}
                      onChange={(e) => setRehearsalDate(e.target.value)}
                      className="contact-input text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[#52525b]">
                      Waktu Call Time Rehearsal
                    </label>
                    <input
                      type="time"
                      value={rehearsalCallTime}
                      onChange={(e) => setRehearsalCallTime(e.target.value)}
                      className="contact-input text-xs"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Venue Location */}
            <div className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#3f3f46]">
                  Nama Lokasi / Gedung / Venue
                </label>
                <input
                  type="text"
                  placeholder="e.g. Auditorium Graha Widyatama UNSOED"
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  className="contact-input text-sm"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#52525b]">
                    Alamat Lengkap Venue
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Jl. HR Boenyamin No. 708, Purwokerto"
                    value={venueAddress}
                    onChange={(e) => setVenueAddress(e.target.value)}
                    className="contact-input text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#52525b]">
                    URL Google Maps Pin Point
                  </label>
                  <input
                    type="url"
                    placeholder="https://maps.google.com/?q=..."
                    value={venueMapsUrl}
                    onChange={(e) => setVenueMapsUrl(e.target.value)}
                    className="contact-input text-xs"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(1)}
              disabled={isPending}
            >
              ← Kembali ke Langkah 1
            </Button>
            <Button type="submit" disabled={isPending} className="gap-2">
              {isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Menyimpan Jadwal...
                </>
              ) : (
                <>
                  Lanjut ke Baseline Komersial <ArrowRight size={16} />
                </>
              )}
            </Button>
          </div>
        </form>
      )}

      {/* STEP 3: COMMERCIAL BASELINE */}
      {step === 3 && (
        <form onSubmit={handleStep3Submit} className="space-y-6">
          <div className="bg-white border border-border rounded-xl p-6 shadow-xs space-y-6">
            <h3 className="font-serif text-lg font-bold border-b border-border pb-3">
              Baseline Komersial & Nilai Kontrak
            </h3>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#3f3f46]">
                  Nilai Kontrak Klien (Gross Total) <span className="text-[#ff5a00]">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-muted-foreground font-mono">
                    Rp
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={50000}
                    required
                    value={contractValue}
                    onChange={(e) => setContractValue(e.target.value)}
                    className="contact-input pl-9 font-mono text-sm font-semibold"
                  />
                </div>
                {selectedPackage && (
                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    <span className="text-[#71717a]">
                      Standar Paket:{" "}
                      <strong className="font-mono text-[#09090b]">
                        Rp {selectedPackage.pkg.priceIdr.toLocaleString("id-ID")}
                      </strong>
                    </span>
                    {Number(contractValue) !== selectedPackage.pkg.priceIdr && (
                      <button
                        type="button"
                        onClick={() => setContractValue(selectedPackage.pkg.priceIdr.toString())}
                        className="text-[#ff5a00] hover:underline font-medium inline-flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw size={11} /> Reset ke Harga Paket
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#3f3f46]">
                  Struktur Termin Down Payment (DP)
                </label>
                <div className="flex items-center gap-3 pt-1">
                  <input
                    type="range"
                    min={20}
                    max={80}
                    step={10}
                    value={dpPercentage}
                    onChange={(e) => setDpPercentage(Number(e.target.value))}
                    className="flex-1 accent-[#09090b] cursor-pointer"
                  />
                  <span className="font-mono text-xs font-bold px-2.5 py-1 bg-[#f4f4f5] border border-[#ececee] rounded-md">
                    {dpPercentage}%
                  </span>
                </div>
              </div>
            </div>

            {/* Calculated Breakdown Card */}
            <div className="p-4 bg-[#fafafa] rounded-xl border border-border grid grid-cols-2 gap-4 text-xs font-mono">
              <div>
                <p className="text-muted-foreground mb-0.5">Invoice 1 (Down Payment {dpPercentage}%):</p>
                <p className="text-base font-bold text-[#09090b]">
                  Rp {(Math.round((Number(contractValue) || 0) * (dpPercentage / 100))).toLocaleString("id-ID")}
                </p>
                <p className="text-[10px] text-muted-foreground">Wajib lunas untuk mengunci jadwal</p>
              </div>

              <div>
                <p className="text-muted-foreground mb-0.5">Invoice 2 (Pelunasan Akhir):</p>
                <p className="text-base font-bold text-[#09090b]">
                  Rp {(Math.round((Number(contractValue) || 0) * ((100 - dpPercentage) / 100))).toLocaleString("id-ID")}
                </p>
                <p className="text-[10px] text-muted-foreground">Wajib lunas sebelum rilis master/download</p>
              </div>
            </div>

            {/* Scope & Deliverables Synchronization Card */}
            <div className="p-4 rounded-xl border border-border bg-[#fafafa] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers size={15} className="text-[#09090b]" />
                  <h4 className="text-xs font-bold text-[#09090b]">
                    Lingkup Kerja & Deliverables yang Disinkronkan
                  </h4>
                </div>
                {selectedPackage ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                    {selectedPackage.pkg.includes.length} Output Terkontrak
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#f4f4f5] text-[#71717a]">
                    Template Standar Pilar
                  </span>
                )}
              </div>

              {selectedPackage ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-[#71717a]">
                    Item deliverable berikut akan otomatis mengisi modul Sector Engine & Tracker pasca-peluncuran:
                  </p>
                  <ul className="grid sm:grid-cols-2 gap-1.5 text-xs text-[#3f3f46]">
                    {selectedPackage.pkg.includes.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 bg-white px-2.5 py-1.5 rounded-lg border border-[#ececee]">
                        <Check size={13} className="text-emerald-600 mt-0.5 shrink-0" />
                        <span className="leading-snug text-[11.5px]">{item}</span>
                      </li>
                    ))}
                  </ul>
                  {selectedPackage.pkg.crew.length > 0 && (
                    <div className="pt-2 border-t border-[#ececee] flex items-center gap-2 text-[11px] text-[#52525b]">
                      <Users size={12} className="text-[#71717a]" />
                      <span>Kru Dianjurkan: <strong>{selectedPackage.pkg.crew.join(", ")}</strong></span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-[#71717a] leading-relaxed">
                  Mode Kustom: Deliverables dan alur kerja akan mengikuti template default sektor{" "}
                  <strong className="text-[#09090b]">{servicePillar}</strong>. Anda dapat mengatur ulang spesifikasi di dalam workspace proyek.
                </p>
              )}
            </div>

            {/* Scaffold Summary Card */}
            <div className="p-4 rounded-xl border border-[#ececee] bg-white space-y-2 text-xs">
              <div className="flex items-center justify-between text-[#71717a] font-mono text-[11px] border-b border-[#ececee] pb-2">
                <span>SECTOR DNA</span>
                <span className="font-bold text-[#3f3f46]">{servicePillar}</span>
              </div>
              <div className="flex items-center justify-between text-[#71717a] font-mono text-[11px] border-b border-[#ececee] pb-2">
                <span>PAKET PRICELIST</span>
                <span className="font-bold text-[#3f3f46]">
                  {selectedPackage
                    ? `${selectedPackage.category.name} — ${selectedPackage.pkg.name}`
                    : "Kustom / Tanpa Paket"}
                </span>
              </div>
              <div className="flex items-center justify-between text-[#71717a] font-mono text-[11px] border-b border-[#ececee] pb-2">
                <span>NAMA PROYEK</span>
                <span className="font-bold text-[#3f3f46]">{projectName}</span>
              </div>
              <div className="flex items-center justify-between text-[#71717a] font-mono text-[11px]">
                <span>TANGGAL ACARA</span>
                <span className="font-bold text-[#3f3f46]">{shootDate || "Belum Ditentukan"}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(2)}
              disabled={isPending}
            >
              ← Kembali ke Langkah 2
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-[#09090b] hover:bg-[#27272a] text-white gap-2 font-semibold"
            >
              {isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Meluncurkan Workspace...
                </>
              ) : (
                <>
                  <Sparkles size={16} /> Luncurkan Workspace Proyek 🚀
                </>
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
