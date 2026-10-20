import { requireStaff } from "@/lib/auth/roles";
import { getMyProfileAction } from "@/app/actions/profile";
import { PAYOUT_PROVIDERS } from "@/lib/payout-providers";
import { ProfileForm } from "@/components/settings/profile-form";

/**
 * Self-service profile and payout settings.
 *
 * Available to EVERY staff member, not just admins: a WORKER or EDITOR must be
 * able to set a payout destination or their payslip has nowhere to go.
 */
export default async function ProfileSettingsPage() {
  await requireStaff();
  const profile = await getMyProfileAction();

  if (!profile) {
    return (
      <div className="p-6">
        <p className="text-sm text-[#71717a]">Profil tidak ditemukan.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-lg font-semibold text-[#18181b]">Profil & Pembayaran</h1>
        <p className="mt-1 text-sm text-[#71717a]">
          Kelola data pribadi dan rekening penerimaan honor Anda.
        </p>
      </header>

      <ProfileForm
        initial={{
          email: profile.email,
          fullName: profile.fullName,
          displayName: profile.displayName,
          phone: profile.phone,
        }}
        payout={{
          method: profile.payoutMethod,
          bankName: profile.bankName,
          accountHolder: profile.bankAccountHolder,
          accountNumber: profile.bankAccountNumber,
          ewalletProvider: profile.ewalletProvider,
          ewalletId: profile.ewalletId,
        }}
        providers={PAYOUT_PROVIDERS}
      />
    </div>
  );
}
