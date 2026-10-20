"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Save, Wallet } from "lucide-react";
import { updateProfileAction, updatePayoutAction } from "@/app/actions/profile";

type Provider = { value: string; label: string; kind: "BANK" | "EWALLET" };

type Props = {
  initial: {
    email: string;
    fullName: string;
    displayName: string;
    phone: string;
  };
  payout: {
    method: string | null;
    bankName: string | null;
    accountHolder: string | null;
    accountNumber: string | null;
    ewalletProvider: string | null;
    ewalletId: string | null;
  };
  providers: readonly Provider[];
};

export function ProfileForm({ initial, payout, providers }: Props) {
  const router = useRouter();

  /* ── Personal data ─────────────────────────────────────────────────────── */
  const [fullName, setFullName] = useState(initial.fullName);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [phone, setPhone] = useState(initial.phone);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [savingProfile, startProfile] = useTransition();

  /* ── Payout ────────────────────────────────────────────────────────────── */
  const currentProvider =
    payout.method === "EWALLET" ? payout.ewalletProvider ?? "" : payout.bankName ?? "";
  const [provider, setProvider] = useState(currentProvider);
  const [accountHolder, setAccountHolder] = useState(payout.accountHolder ?? "");
  const [accountNumber, setAccountNumber] = useState(
    payout.method === "EWALLET" ? payout.ewalletId ?? "" : payout.accountNumber ?? "",
  );
  const [payoutPassword, setPayoutPassword] = useState("");
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null);
  const [payoutErr, setPayoutErr] = useState<string | null>(null);
  const [savingPayout, startPayout] = useTransition();

  const submitProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setProfileErr(null);
    startProfile(async () => {
      const res = await updateProfileAction({ fullName, displayName, phone });
      if (!res.ok) {
        setProfileErr(res.error);
        return;
      }
      setProfileMsg("Profil tersimpan.");
      router.refresh();
    });
  };

  const submitPayout = (e: React.FormEvent) => {
    e.preventDefault();
    setPayoutMsg(null);
    setPayoutErr(null);
    startPayout(async () => {
      const res = await updatePayoutAction({
        provider,
        accountHolder,
        accountNumber,
        password: payoutPassword,
      });
      if (!res.ok) {
        setPayoutErr(res.error);
        return;
      }
      setPayoutMsg("Rekening tersimpan.");
      setPayoutPassword("");
      router.refresh();
    });
  };

  return (
    <>
      {/* ── Personal data ─────────────────────────────────────────────────── */}
      <form
        onSubmit={submitProfile}
        className="space-y-4 rounded-xl border border-[#ececee] bg-white p-5"
      >
        <h2 className="text-sm font-semibold text-[#18181b]">Data Pribadi</h2>

        <Field label="Email" htmlFor="email">
          <input
            id="email"
            value={initial.email}
            readOnly
            className="w-full cursor-not-allowed rounded-lg border border-[#ececee] bg-[#fafafa] px-3 py-2 text-sm text-[#71717a]"
          />
          <p className="mt-1 text-[11px] text-[#a1a1aa]">
            Email diubah melalui tab Keamanan (memerlukan konfirmasi).
          </p>
        </Field>

        <Field label="Nama Lengkap" htmlFor="fullName">
          <input
            id="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
          />
        </Field>

        <Field label="Nama Tampilan" htmlFor="displayName">
          <input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
          />
        </Field>

        <Field label="Telepon / WhatsApp" htmlFor="phone">
          <input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+62 812 3456 7890"
            className="w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
          />
        </Field>

        {profileErr && <p className="text-xs text-red-600">{profileErr}</p>}
        {profileMsg && <p className="text-xs text-emerald-600">{profileMsg}</p>}

        <button
          type="submit"
          disabled={savingProfile}
          className="flex items-center gap-2 rounded-lg bg-[#18181b] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          <Save size={14} /> {savingProfile ? "Menyimpan…" : "Simpan Profil"}
        </button>
      </form>

      {/* ── Payout ────────────────────────────────────────────────────────── */}
      <form
        onSubmit={submitPayout}
        className="space-y-4 rounded-xl border border-[#ececee] bg-white p-5"
      >
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-[#71717a]" />
          <h2 className="text-sm font-semibold text-[#18181b]">Rekening Penerimaan Honor</h2>
        </div>
        <p className="text-xs text-[#71717a]">
          Rekening ini dipakai untuk payslip otomatis. Perubahan memerlukan konfirmasi kata
          sandi.
        </p>

        <Field label="Bank / E-Wallet" htmlFor="provider">
          <select
            id="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            required
            className="w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
          >
            <option value="">Pilih…</option>
            {providers.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} {p.kind === "EWALLET" ? "(e-wallet)" : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Nama Pemilik Rekening" htmlFor="accountHolder">
          <input
            id="accountHolder"
            value={accountHolder}
            onChange={(e) => setAccountHolder(e.target.value)}
            required
            className="w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
          />
        </Field>

        <Field label="Nomor Rekening / ID E-Wallet" htmlFor="accountNumber">
          <input
            id="accountNumber"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            required
            inputMode="numeric"
            className="w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
          />
        </Field>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <label
            htmlFor="payoutPassword"
            className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-800"
          >
            <Lock size={12} /> Konfirmasi Kata Sandi
          </label>
          <input
            id="payoutPassword"
            type="password"
            autoComplete="current-password"
            value={payoutPassword}
            onChange={(e) => setPayoutPassword(e.target.value)}
            required
            placeholder="Wajib untuk mengubah rekening"
            className="w-full rounded-lg border border-amber-200 px-3 py-2 text-sm outline-none focus:border-amber-500"
          />
        </div>

        {payoutErr && <p className="text-xs text-red-600">{payoutErr}</p>}
        {payoutMsg && <p className="text-xs text-emerald-600">{payoutMsg}</p>}

        <button
          type="submit"
          disabled={savingPayout}
          className="flex items-center gap-2 rounded-lg bg-[#18181b] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          <Save size={14} /> {savingPayout ? "Menyimpan…" : "Simpan Rekening"}
        </button>
      </form>
    </>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-[#3f3f46]">
        {label}
      </label>
      {children}
    </div>
  );
}
