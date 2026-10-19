import "server-only";
import { createServiceSupabase } from "@/lib/supabase/service";

/**
 * Studio payment accounts — the single source of truth for anything that quotes
 * a bank account to a client, vendor, or crew member.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The same two account numbers were copy-pasted into seven places: the invoice
 * RPC, the public invoice view, the WhatsApp message template, the invoice
 * print route, the vendor purchase-order route, the invoices hub, and the
 * project workspace. Changing a bank account meant finding all seven, and a
 * missed one would keep quoting a dead account to clients.
 *
 * Every surface now reads from `public.studio_payment_methods` through this
 * helper. An empty result is returned as an empty array: callers render an
 * honest "contact the studio" state, never a placeholder account.
 */

export interface StudioBankAccount {
  bank: string;
  account_number: string;
  account_holder: string;
  label: string | null;
}

/**
 * Active accounts for display, ordered primary-first then by configured order.
 *
 * Deliberately does NOT throw. A document that cannot reach the database should
 * render without payment details rather than 500 — the invoice itself is still
 * valid, and the client still has the studio's WhatsApp contact.
 */
export async function getStudioBankAccounts(): Promise<StudioBankAccount[]> {
  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("studio_payment_methods")
      .select("bank_name, account_number, account_holder, label, is_primary, sort_order")
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("bank_name", { ascending: true });

    if (error) {
      console.error("studio_bank_accounts_failed", { code: error.code });
      return [];
    }

    return (data ?? []).map((row) => ({
      bank: row.bank_name as string,
      account_number: row.account_number as string,
      account_holder: row.account_holder as string,
      label: (row.label as string | null) ?? null,
    }));
  } catch (err: unknown) {
    console.error("studio_bank_accounts_threw", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return [];
  }
}
