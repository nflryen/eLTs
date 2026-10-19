"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Search,
  X,
  Crown,
  Users,
  Scissors,
  Briefcase,
  Phone,
  Mail,
  ExternalLink,
  Key,
  Eye,
  Check,
  Copy,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  CreditCard,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  UnifiedUser,
  UserStatus,
  UnifiedUserProject,
} from "@/types/users";
import {
  toggleUserStatus,
  resetClientPin,
  generateRandomPinAction,
} from "@/app/actions/admin-users";

interface UserDirectoryClientProps {
  initialUsers: UnifiedUser[];
}

type TabType = "ALL" | "OWNER" | "FREELANCE" | "EDITOR" | "CLIENT";

export function UserDirectoryClient({ initialUsers }: UserDirectoryClientProps) {
  const [users, setUsers] = useState<UnifiedUser[]>(initialUsers);
  const [activeTab, setActiveTab] = useState<TabType>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | UserStatus>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [, startTransition] = useTransition();

  // Dialog states
  const [detailUser, setDetailUser] = useState<UnifiedUser | null>(null);
  const [pinDialogUser, setPinDialogUser] = useState<UnifiedUser | null>(null);

  // Status update tracking
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // PIN Reset form state
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [inputPin, setInputPin] = useState("");
  const [isSubmittingPin, setIsSubmittingPin] = useState(false);
  const [pinSuccessData, setPinSuccessData] = useState<{
    newPin: string;
    projectName: string;
    galleryUrl: string;
    waMessage: string;
  } | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Calculate tab counts
  const counts = useMemo(() => {
    let owner = 0;
    let freelance = 0;
    let editor = 0;
    let client = 0;

    for (const u of users) {
      if (u.role === "OWNER") owner++;
      else if (u.role === "FREELANCE") freelance++;
      else if (u.role === "EDITOR") editor++;
      else if (u.role === "CLIENT") client++;
    }

    return {
      ALL: users.length,
      OWNER: owner,
      FREELANCE: freelance,
      EDITOR: editor,
      CLIENT: client,
    };
  }, [users]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return users.filter((u) => {
      // 1. Tab Role Filter
      if (activeTab !== "ALL" && u.role !== activeTab) {
        return false;
      }

      // 2. Status Filter
      if (statusFilter !== "ALL" && u.status !== statusFilter) {
        return false;
      }

      // 3. Search Query Filter
      if (!q) return true;

      const nameMatch = u.name.toLowerCase().includes(q);
      const emailMatch = u.email.toLowerCase().includes(q);
      const phoneMatch = u.phone.toLowerCase().includes(q);
      const detailsMatch = u.details.toLowerCase().includes(q);
      const codeMatch = Boolean(
        u.metadata?.crewCode &&
          typeof u.metadata.crewCode === "string" &&
          u.metadata.crewCode.toLowerCase().includes(q)
      );

      const skillsMatch = Boolean(
        Array.isArray(u.metadata?.primarySkills) &&
          u.metadata.primarySkills.some((s) => s.toLowerCase().includes(q))
      );

      const projectsMatch = Boolean(
        Array.isArray(u.metadata?.projects) &&
          (u.metadata.projects as UnifiedUserProject[]).some(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              p.slug.toLowerCase().includes(q) ||
              p.galleryCode.toLowerCase().includes(q)
          )
      );

      return (
        nameMatch ||
        emailMatch ||
        phoneMatch ||
        detailsMatch ||
        codeMatch ||
        skillsMatch ||
        projectsMatch
      );
    });
  }, [users, activeTab, statusFilter, searchQuery]);

  // Copy helper
  const handleCopy = async (text: string, key: string) => {
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Toggle user status
  const handleToggleStatus = (user: UnifiedUser) => {
    if (user.role === "OWNER") {
      setBannerNotice({
        type: "error",
        text: "Akun Studio Owner dilindungi dan tidak dapat dinonaktifkan.",
      });
      return;
    }

    const nextStatus: UserStatus =
      user.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";

    setUpdatingUserId(user.id);

    startTransition(async () => {
      try {
        const res = await toggleUserStatus(user.id, user.role, nextStatus);
        if (res.success) {
          setUsers((prev) =>
            prev.map((item) =>
              item.id === user.id ? { ...item, status: nextStatus } : item
            )
          );
          setBannerNotice({
            type: "success",
            text: `Status ${user.name} berhasil diubah ke ${
              nextStatus === "ACTIVE" ? "Aktif" : "Suspended"
            }.`,
          });
        } else {
          setBannerNotice({
            type: "error",
            text: res.error || "Gagal memperbarui status pengguna.",
          });
        }
      } catch {
        setBannerNotice({
          type: "error",
          text: "Terjadi kesalahan saat menghubungi server.",
        });
      } finally {
        setUpdatingUserId(null);
      }
    });
  };

  // Open Reset PIN Dialog
  const handleOpenPinDialog = (user: UnifiedUser) => {
    setPinDialogUser(user);
    setPinError(null);
    setPinSuccessData(null);
    setInputPin("");

    const projects = (user.metadata?.projects as UnifiedUserProject[]) || [];
    if (projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    } else {
      setSelectedProjectId("");
    }
  };

  // Generate Random PIN
  const handleGeneratePin = async () => {
    const pin = await generateRandomPinAction();
    setInputPin(pin);
    setPinError(null);
  };

  // Submit Reset PIN
  const handleResetPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinDialogUser || !selectedProjectId) {
      setPinError("Pilih proyek yang ingin direset PIN galerinya.");
      return;
    }

    const clean = inputPin.trim();
    if (!/^\d{4,12}$/.test(clean)) {
      setPinError("PIN harus berupa 4 hingga 12 digit angka murni.");
      return;
    }

    setIsSubmittingPin(true);
    setPinError(null);

    try {
      const res = await resetClientPin(selectedProjectId, clean);
      if (res.success) {
        const projects =
          (pinDialogUser.metadata?.projects as UnifiedUserProject[]) || [];
        const activeProj =
          projects.find((p) => p.id === selectedProjectId) || projects[0];
        const projName = activeProj?.name || "Galeri Foto ELTs";
        const gallerySlug = activeProj?.slug || activeProj?.accessToken || "";
        const origin =
          typeof window !== "undefined" ? window.location.origin : "";
        const galleryUrl = `${origin}/gallery/${gallerySlug}`;

        const waMessage =
          `Halo kak ${pinDialogUser.name},\n\n` +
          `Berikut adalah detail akses galeri foto terbaru Anda dari *ELTs. Photography*:\n\n` +
          `Proyek: *${projName}*\n` +
          `Kode Galeri: *${activeProj?.galleryCode || "-"}*\n` +
          `PIN Rahasia Baru: *${clean}*\n` +
          `Tautan Galeri: ${galleryUrl}\n\n` +
          `Silakan simpan PIN ini untuk mengakses dan mengunduh foto Anda. Terima kasih!`;

        setPinSuccessData({
          newPin: clean,
          projectName: projName,
          galleryUrl,
          waMessage,
        });

        setBannerNotice({
          type: "success",
          text: `PIN galeri untuk proyek ${projName} berhasil direset.`,
        });
      } else {
        setPinError(res.error || "Gagal mereset PIN galeri klien.");
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Terjadi kesalahan server.";
      setPinError(msg);
    } finally {
      setIsSubmittingPin(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Feedback Banner */}
      {bannerNotice && (
        <div
          className={cn(
            "p-4 rounded-lg flex items-center justify-between text-sm transition-all border",
            bannerNotice.type === "success"
              ? "bg-[#09090b] text-white border-[#09090b]"
              : "bg-[#ff5a00]/10 text-[#ff5a00] border-[#ff5a00]/30"
          )}
        >
          <div className="flex items-center gap-2.5">
            {bannerNotice.type === "success" ? (
              <CheckCircle2 size={18} className="text-white shrink-0" />
            ) : (
              <AlertCircle size={18} className="text-[#ff5a00] shrink-0" />
            )}
            <p className="font-medium">{bannerNotice.text}</p>
          </div>
          <button
            onClick={() => setBannerNotice(null)}
            className="p-1 hover:bg-black/5 rounded text-current"
            aria-label="Tutup notifikasi"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Control Bar: Tabs, Search, and Status Filter */}
      <div className="bg-white border border-[#ececee] rounded-lg p-4 shadow-xs space-y-4">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
          <button
            type="button"
            onClick={() => setActiveTab("ALL")}
            className={cn(
              activeTab === "ALL"
                ? "bg-[#09090b] text-white"
                : "text-[#3f3f46] hover:bg-[#fafafa]"
            )}
          >
            <span>Semua</span>
            <span
              className={cn(
                activeTab === "ALL"
                  ? "bg-white/20 text-white"
                  : "bg-[#f4f4f5] text-[#3f3f46]"
              )}
            >
              {counts.ALL}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("OWNER")}
            className={cn(
              activeTab === "OWNER"
                ? "bg-[#09090b] text-white"
                : "text-[#3f3f46] hover:bg-[#fafafa]"
            )}
          >
            <Crown size={15} />
            <span>Owners</span>
            <span
              className={cn(
                activeTab === "OWNER"
                  ? "bg-white/20 text-white"
                  : "bg-[#f4f4f5] text-[#3f3f46] border border-[#ececee]"
              )}
            >
              {counts.OWNER}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("FREELANCE")}
            className={cn(
              activeTab === "FREELANCE"
                ? "bg-[#09090b] text-white"
                : "text-[#3f3f46] hover:bg-[#fafafa]"
            )}
          >
            <Users size={15} />
            <span>Freelancers</span>
            <span
              className={cn(
                activeTab === "FREELANCE"
                  ? "bg-white/20 text-white"
                  : "bg-[#f4f4f5] text-[#3f3f46] border border-[#ececee]"
              )}
            >
              {counts.FREELANCE}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("EDITOR")}
            className={cn(
              activeTab === "EDITOR"
                ? "bg-[#09090b] text-white"
                : "text-[#3f3f46] hover:bg-[#fafafa]"
            )}
          >
            <Scissors size={15} />
            <span>Editors</span>
            <span
              className={cn(
                activeTab === "EDITOR"
                  ? "bg-white/20 text-white"
                  : "bg-[#f4f4f5] text-[#3f3f46] border border-[#ececee]"
              )}
            >
              {counts.EDITOR}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("CLIENT")}
            className={cn(
              activeTab === "CLIENT"
                ? "bg-[#09090b] text-white"
                : "text-[#3f3f46] hover:bg-[#fafafa]"
            )}
          >
            <Briefcase size={15} />
            <span>Clients</span>
            <span
              className={cn(
                activeTab === "CLIENT"
                  ? "bg-white/20 text-white"
                  : "bg-[#f4f4f5] text-[#3f3f46] border border-[#ececee]"
              )}
            >
              {counts.CLIENT}
            </span>
          </button>
        </div>

        {/* Search Bar & Secondary Status Filter */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-96">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama, email, nomor HP, keahlian, kode..."
              className="w-full pl-10 pr-9 py-2 text-sm bg-[#fafafa] border border-[#ececee] rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#09090b] transition-all placeholder:text-[#a1a1aa]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded"
                aria-label="Bersihkan pencarian"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <SlidersHorizontal size={13} /> Status:
            </span>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "ALL" | UserStatus)
              }
              className="text-xs bg-[#fafafa] border border-[#ececee] rounded-md px-2.5 py-2 font-medium focus:outline-none focus:ring-1 focus:ring-[#09090b]"
            >
              <option value="ALL">Semua Status</option>
              <option value="ACTIVE">Aktif</option>
              <option value="READY">Ready</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </div>
        </div>
      </div>

      {/* Unified User Directory Table */}
      <div className="bg-white border border-[#ececee] rounded-lg shadow-xs overflow-hidden">
        {filteredUsers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#ececee] bg-[#fafafa] text-[#52525b] text-xs font-semibold uppercase tracking-wider">
                  <th className="px-6 py-3.5">Nama & Profil</th>
                  <th className="px-4 py-3.5">Peran / Klasifikasi</th>
                  <th className="px-4 py-3.5">Keahlian / Proyek</th>
                  <th className="px-4 py-3.5">Kontak & WhatsApp</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ececee]">
                {filteredUsers.map((user) => {
                  const isUpdating = updatingUserId === user.id;

                  // Initials
                  const initials = user.name
                    .split(" ")
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase();

                  // Avatar theme per role
                  const roleAvatarStyles = {
                    OWNER: "bg-[#f4f4f5] text-[#09090b] border-[#ececee]",
                    FREELANCE: "bg-[#f4f4f5] text-[#3f3f46] border-[#ececee]",
                    EDITOR: "bg-[#f4f4f5] text-[#3f3f46] border-[#ececee]",
                    CLIENT: "bg-[#f4f4f5] text-[#3f3f46] border-[#ececee]",
                  }[user.role];

                  return (
                    <tr
                      key={`${user.role}-${user.id}`}
                      className="hover:bg-[#fafafa] transition-colors group"
                    >
                      {/* Name & Identifier Badge */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs border shrink-0",
                              roleAvatarStyles
                            )}
                          >
                            {initials}
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={() => setDetailUser(user)}
                              className="inline-flex min-h-11 items-center font-medium text-foreground hover:underline text-left"
                            >
                              {user.name}
                            </button>
                            <div className="flex items-center gap-2 mt-0.5">
                              {user.metadata?.crewCode && (
                                <span className="inline-block text-[11px] font-mono font-semibold px-1.5 py-0.2 bg-[#f4f4f5] text-[#3f3f46] rounded border border-[#ececee]">
                                  {user.metadata.crewCode as string}
                                </span>
                              )}
                              {user.role === "OWNER" && (
                                <span className="inline-block text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.2 bg-[#09090b] text-white rounded">
                                  ADMIN
                                </span>
                              )}
                              {user.email && (
                                <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                                  {user.email}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Role Badge */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        {user.role === "OWNER" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#fafafa] text-[#09090b] border border-[#ececee]">
                            <Crown size={12} className="text-[#09090b]" />
                            Studio Owner
                          </span>
                        )}
                        {user.role === "FREELANCE" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#fafafa] text-[#3f3f46] border border-[#ececee]">
                            <Users size={12} className="text-[#52525b]" />
                            Freelancer
                          </span>
                        )}
                        {user.role === "EDITOR" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#fafafa] text-[#3f3f46] border border-[#ececee]">
                            <Scissors size={12} className="text-[#52525b]" />
                            Post Editor
                          </span>
                        )}
                        {user.role === "CLIENT" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#fafafa] text-[#3f3f46] border border-[#ececee]">
                            <Briefcase size={12} className="text-[#52525b]" />
                            Client
                          </span>
                        )}
                      </td>

                      {/* Primary Skill or Linked Project */}
                      <td className="px-4 py-4 text-xs">
                        <div className="max-w-[260px] line-clamp-2 text-[#3f3f46] leading-relaxed">
                          {user.details}
                        </div>
                        {user.metadata?.standardDayRate ? (
                          <p className="text-[11px] text-muted-foreground font-mono mt-1">
                            Rate: Rp{" "}
                            {Number(
                              user.metadata.standardDayRate
                            ).toLocaleString("id-ID")}{" "}
                            / sesi
                          </p>
                        ) : null}
                      </td>

                      {/* Contact & 1-Click WhatsApp Deep Link */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          {user.phone ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-medium text-[#3f3f46]">
                                {user.phone}
                              </span>
                              {user.waLink ? (
                                <a
                                  href={user.waLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex min-h-11 items-center gap-1 px-2.5 rounded-full text-[11px] font-semibold bg-[#09090b] text-white hover:bg-[#27272a] transition-colors"
                                  title="Buka WhatsApp Chat Langsung"
                                >
                                  <Phone size={11} className="text-white" />
                                  <span>Chat WA</span>
                                </a>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Tidak ada no. HP
                            </span>
                          )}
                          {user.email && (
                            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Mail size={11} />
                              <a
                                href={`mailto:${user.email}`}
                                className="hover:underline truncate max-w-[170px]"
                              >
                                {user.email}
                              </a>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        {user.status === "ACTIVE" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#09090b] text-white border border-[#09090b]">
                            <span className="size-1.5 rounded-full bg-white" />
                            Aktif
                          </span>
                        )}
                        {user.status === "READY" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#fafafa] text-[#3f3f46] border border-[#ececee]">
                            <span className="size-1.5 rounded-full bg-[#52525b]" />
                            Ready
                          </span>
                        )}
                        {user.status === "SUSPENDED" && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#ff5a00]/10 text-[#ff5a00] border border-[#ff5a00]/30">
                            <span className="size-1.5 rounded-full bg-[#ff5a00]" />
                            Suspended
                          </span>
                        )}
                      </td>

                      {/* Action Menu */}
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* 1-Click WhatsApp button */}
                          {user.waLink && (
                            <a
                              href={user.waLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center min-h-11 min-w-11 text-white bg-[#09090b] hover:bg-[#27272a] rounded-md transition-colors"
                              title="Buka WhatsApp"
                            >
                              <Phone size={14} />
                            </a>
                          )}

                          {/* View Details Button */}
                          <button
                            type="button"
                            onClick={() => setDetailUser(user)}
                            className="inline-flex items-center justify-center min-h-11 min-w-11 text-[#52525b] hover:text-[#09090b] hover:bg-[#fafafa] rounded-md transition-colors"
                            title="Lihat Detail Pengguna"
                          >
                            <Eye size={14} />
                          </button>

                          {/* Reset PIN / Magic Link (Client only) */}
                          {user.role === "CLIENT" && (
                            <button
                              type="button"
                              onClick={() => handleOpenPinDialog(user)}
                              className="inline-flex items-center justify-center min-h-11 min-w-11 text-[#ff5a00] bg-[#ff5a00]/10 hover:bg-[#ff5a00]/20 rounded-md border border-[#ff5a00]/30 transition-colors"
                              title="Reset PIN & Magic Link Galeri"
                            >
                              <Key size={14} />
                            </button>
                          )}

                          {/* Toggle Status (Active / Suspended) */}
                          {user.role !== "OWNER" && (
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() => handleToggleStatus(user)}
                              className={cn(
                                "inline-flex min-h-11 items-center px-3 text-xs rounded-full border transition-colors",
                                user.status === "SUSPENDED"
                                  ? "bg-[#09090b] text-white border-[#09090b] hover:bg-[#27272a]"
                                  : "border-[#ececee] text-[#3f3f46] hover:text-[#ff5a00] hover:bg-[#ff5a00]/10 hover:border-[#ff5a00]/30"
                              )}
                              title={
                                user.status === "SUSPENDED"
                                  ? "Aktifkan Akun"
                                  : "Suspend Akun"
                              }
                            >
                              {isUpdating ? (
                                <RefreshCw size={12} className="animate-spin" />
                              ) : user.status === "SUSPENDED" ? (
                                "Aktifkan"
                              ) : (
                                "Suspend"
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-16 px-4">
            <Users size={36} className="text-[#a1a1aa] mx-auto mb-3" />
            <p className="font-semibold text-[#09090b]">
              Tidak ada pengguna ditemukan
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              {searchQuery
                ? `Tidak ada hasil yang sesuai dengan kueri "${searchQuery}". Coba kata kunci lain.`
                : "Belum ada data untuk kategori yang dipilih."}
            </p>
            {searchQuery && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setSearchQuery("")}
              >
                Reset Pencarian
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 1. USER DETAILS MODAL (Radix Dialog)                                      */}
      {/* ========================================================================= */}
      <Dialog.Root
        open={detailUser !== null}
        onOpenChange={(open) => {
          if (!open) setDetailUser(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[95vw] max-w-2xl max-h-[88vh] overflow-y-auto bg-white rounded-lg p-6 shadow-xl border border-[#ececee] focus:outline-none">
            {detailUser && (
              <div className="space-y-6">
                {/* Header */}
                <div className="flex items-start justify-between border-b border-border pb-4">
                  <div className="flex items-center gap-3">
                    <div className="size-12 rounded-full bg-[#fafafa] flex items-center justify-center font-bold text-sm border border-[#ececee]">
                      {detailUser.name
                        .split(" ")
                        .slice(0, 2)
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()}
                    </div>
                    <div>
                      <Dialog.Title className="text-xl font-serif font-bold text-foreground">
                        {detailUser.name}
                      </Dialog.Title>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs px-2 py-0.5 rounded font-semibold bg-[#f4f4f5] text-[#3f3f46]">
                          {detailUser.role}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ID: {detailUser.id}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                      aria-label="Tutup"
                    >
                      <X size={18} />
                    </button>
                  </Dialog.Close>
                </div>

                <Dialog.Description className="text-xs text-muted-foreground">
                  Informasi profil lengkap, identitas akun, data perbankan, dan
                  riwayat operasional pengguna.
                </Dialog.Description>

                {/* Contact Info Card */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#fafafa] p-4 rounded-lg border border-[#ececee] text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">
                      Nomor Telepon / WhatsApp
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">
                        {detailUser.phone || "—"}
                      </span>
                      {detailUser.waLink && (
                        <a
                          href={detailUser.waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[#09090b] underline font-medium"
                        >
                          Buka WA
                        </a>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">
                      Alamat Email
                    </span>
                    <span className="font-mono text-[#3f3f46]">
                      {detailUser.email || "—"}
                    </span>
                  </div>

                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">
                      Status Akun
                    </span>
                    <span className="font-semibold text-[#3f3f46]">
                      {detailUser.status}
                    </span>
                  </div>

                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">
                      Terakhir Aktif
                    </span>
                    <span className="text-xs text-[#3f3f46]">
                      {detailUser.lastActive
                        ? new Date(detailUser.lastActive).toLocaleString("id-ID", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "—"}
                    </span>
                  </div>
                </div>

                {/* Banking info for Freelancers/Editors */}
                {(detailUser.role === "FREELANCE" ||
                  detailUser.role === "EDITOR") &&
                  detailUser.metadata?.bankAccountNumber && (
                    <div className="bg-[#fafafa] border border-[#ececee] rounded-lg p-4 text-sm space-y-2">
                      <div className="flex items-center gap-2 font-semibold text-[#09090b]">
                        <CreditCard size={16} /> Rekening Pencairan Honor Crew
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
                        <div>
                          <span className="text-muted-foreground block">
                            Bank:
                          </span>
                          <span className="font-bold text-[#3f3f46]">
                            {detailUser.metadata.bankName as string}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">
                            No. Rekening:
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-[#09090b]">
                              {detailUser.metadata.bankAccountNumber as string}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopy(
                                  String(
                                    detailUser.metadata?.bankAccountNumber || ""
                                  ),
                                  "bank"
                                )
                              }
                              className="text-xs text-[#3f3f46] hover:underline"
                            >
                              {copiedKey === "bank" ? "Disalin!" : "Salin"}
                            </button>
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">
                            Atas Nama:
                          </span>
                          <span className="font-semibold text-[#3f3f46]">
                            {detailUser.metadata.bankAccountHolder as string}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                {/* Linked Projects for Clients */}
                {detailUser.role === "CLIENT" && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <Briefcase size={14} /> Daftar Proyek Terhubung (
                      {detailUser.metadata?.projectsCount || 0})
                    </h4>
                    {Array.isArray(detailUser.metadata?.projects) &&
                    (detailUser.metadata.projects as UnifiedUserProject[]).length >
                      0 ? (
                      <div className="space-y-2">
                        {(
                          detailUser.metadata.projects as UnifiedUserProject[]
                        ).map((proj) => (
                          <div
                            key={proj.id}
                            className="p-3 bg-[#fafafa] border border-[#ececee] rounded-md flex items-center justify-between text-xs"
                          >
                            <div>
                              <p className="font-semibold text-[#09090b]">
                                {proj.name}
                              </p>
                              <p className="text-muted-foreground mt-0.5">
                                Kode:{" "}
                                <span className="font-mono font-bold text-[#3f3f46]">
                                  {proj.galleryCode}
                                </span>{" "}
                                • Status: {proj.status}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                asChild
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs"
                              >
                                <Link
                                  href={`/gallery/${proj.slug || proj.accessToken}`}
                                  target="_blank"
                                >
                                  Buka Galeri <ExternalLink size={12} />
                                </Link>
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs"
                                onClick={() => {
                                  setDetailUser(null);
                                  handleOpenPinDialog(detailUser);
                                }}
                              >
                                <Key size={12} /> Reset PIN
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Belum ada proyek terhubung ke klien ini.
                      </p>
                    )}
                  </div>
                )}

                {/* Footer Controls */}
                <div className="flex items-center justify-between border-t border-border pt-4">
                  {detailUser.waLink ? (
                    <Button asChild size="sm">
                      <a
                        href={detailUser.waLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5"
                      >
                        <Phone size={14} /> Chat via WhatsApp
                      </a>
                    </Button>
                  ) : (
                    <div />
                  )}
                  <Dialog.Close asChild>
                    <Button variant="outline" size="sm">
                      Tutup
                    </Button>
                  </Dialog.Close>
                </div>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* ========================================================================= */}
      {/* 2. RESET CLIENT PIN & MAGIC LINK MODAL (Radix Dialog)                     */}
      {/* ========================================================================= */}
      <Dialog.Root
        open={pinDialogUser !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPinDialogUser(null);
            setPinSuccessData(null);
            setPinError(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[95vw] max-w-lg bg-white rounded-lg p-6 shadow-xl border border-[#ececee] focus:outline-none">
            {pinDialogUser && (
              <div className="space-y-5">
                <div className="flex items-start justify-between border-b border-border pb-3">
                  <div>
                    <Dialog.Title className="text-lg font-serif font-bold text-foreground flex items-center gap-2">
                      <Key size={18} className="text-[#09090b]" />
                      Reset PIN Galeri Klien
                    </Dialog.Title>
                    <Dialog.Description className="text-xs text-muted-foreground mt-1">
                      Klien: <b>{pinDialogUser.name}</b>. PIN dienkripsi dengan
                      scrypt-v2 dan disimpan aman.
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      className="p-1 text-muted-foreground hover:text-foreground rounded"
                      aria-label="Tutup"
                    >
                      <X size={16} />
                    </button>
                  </Dialog.Close>
                </div>

                {pinError && (
                  <div className="p-3 bg-[#ff5a00]/10 text-[#ff5a00] text-xs rounded border border-[#ff5a00]/30 flex items-center gap-2">
                    <AlertCircle size={15} className="shrink-0" />
                    <span>{pinError}</span>
                  </div>
                )}

                {pinSuccessData ? (
                  <div className="space-y-4 py-2">
                    <div className="p-4 bg-[#09090b] border border-[#09090b] rounded-lg text-white space-y-2">
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <CheckCircle2 size={16} className="text-white" />
                        PIN Berhasil Direset & Diperbarui!
                      </div>
                      <p className="text-xs">
                        Proyek: <b>{pinSuccessData.projectName}</b>
                      </p>
                      <div className="flex items-center gap-3 pt-1">
                        <span className="text-xs text-muted-foreground">
                          PIN Baru:
                        </span>
                        <span className="font-mono text-xl font-bold tracking-widest text-white">
                          {pinSuccessData.newPin}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-[#3f3f46] block">
                        Teks Konfirmasi WhatsApp Siap Kirim:
                      </span>
                      <textarea
                        readOnly
                        value={pinSuccessData.waMessage}
                        rows={6}
                        className="w-full text-xs font-mono bg-[#fafafa] border border-[#ececee] p-3 rounded focus:outline-none"
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
                      <Button
                        type="button"
                        className="w-full sm:flex-1 text-xs"
                        onClick={() =>
                          handleCopy(pinSuccessData.waMessage, "waText")
                        }
                      >
                        {copiedKey === "waText" ? (
                          <>
                            <Check size={14} /> Pesan Disalin!
                          </>
                        ) : (
                          <>
                            <Copy size={14} /> Salin Pesan WA
                          </>
                        )}
                      </Button>
                      {pinDialogUser.phone && (
                        <Button
                          asChild
                          variant="outline"
                          className="w-full sm:flex-1 text-xs"
                        >
                          <a
                            href={`https://wa.me/${pinDialogUser.phone.replace(
                              /\D/g,
                              ""
                            )}?text=${encodeURIComponent(
                              pinSuccessData.waMessage
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Phone size={14} /> Buka WhatsApp
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleResetPinSubmit} className="space-y-4">
                    {/* Select Project */}
                    <div>
                      <label className="block text-xs font-semibold text-[#3f3f46] mb-1">
                        Pilih Proyek Galeri Klien:
                      </label>
                      <select
                        value={selectedProjectId}
                        onChange={(e) => setSelectedProjectId(e.target.value)}
                        required
                        className="w-full text-sm bg-[#fafafa] border border-[#ececee] rounded p-2 focus:bg-white focus:outline-none"
                      >
                        {Array.isArray(pinDialogUser.metadata?.projects) &&
                        (
                          pinDialogUser.metadata
                            .projects as UnifiedUserProject[]
                        ).length > 0 ? (
                          (
                            pinDialogUser.metadata
                              .projects as UnifiedUserProject[]
                          ).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.galleryCode})
                            </option>
                          ))
                        ) : (
                          <option value="">Tidak ada proyek ditemukan</option>
                        )}
                      </select>
                    </div>

                    {/* Input PIN */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-[#3f3f46]">
                          PIN Baru (4–12 Angka):
                        </label>
                        <button
                          type="button"
                          onClick={handleGeneratePin}
                          className="text-xs text-[#09090b] hover:underline flex items-center gap-1 font-medium"
                        >
                          <Sparkles size={12} /> Buat PIN Acak
                        </button>
                      </div>
                      <input
                        type="text"
                        pattern="[0-9]{4,12}"
                        maxLength={12}
                        value={inputPin}
                        onChange={(e) =>
                          setInputPin(e.target.value.replace(/\D/g, ""))
                        }
                        placeholder="Contoh: 123456"
                        required
                        className="w-full text-lg tracking-widest font-mono p-2.5 bg-[#fafafa] border border-[#ececee] rounded focus:bg-white focus:outline-none text-center"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                      <Dialog.Close asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isSubmittingPin}
                        >
                          Batal
                        </Button>
                      </Dialog.Close>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={isSubmittingPin || !inputPin || !selectedProjectId}
                      >
                        {isSubmittingPin ? (
                          <>
                            <RefreshCw size={14} className="animate-spin" />{" "}
                            Mereset PIN...
                          </>
                        ) : (
                          <>
                            <Key size={14} /> Simpan & Update PIN
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
