// Commercial Client Invoice Domain Types
// Strictly isolated from internal expenses to guarantee zero-leakage privacy

export type CommercialInvoiceStatus =
  | "UNPAID"
  | "PARTIALLY_PAID_DP"
  | "PAID_IN_FULL"
  | "CANCELLED";

export interface CommercialInvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  duration_days?: number;
}

/**
 * Row of `public.project_invoices`.
 *
 * LEDGER SPINE, NOT DOCUMENT SKIN (migration 0001 section 12):
 * `gross_contract_value` is the immutable contract. There is deliberately no
 * `dp_amount`, `dp_paid_at`, `final_balance_amount`, `final_balance_paid_at` or
 * `payment_status` column — payments are ROWS in `invoice_payment_receipts`, and
 * balance/status are DERIVED in `v_invoice_financial_position`.
 *
 * Those five columns used to be declared here. They never existed in the
 * database, which is why every `.select()` against this table silently resolved
 * to `never` once the client became properly typed.
 */
export type ProjectInvoiceRow = {
  id: string;
  project_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  line_items: CommercialInvoiceLineItem[];
  gross_contract_value: number;
  /** DP floor percentage; the payable DP is derived, not stored. */
  minimum_dp_pct: number;
  client_notes: string | null;
  pdf_storage_key: string | null;
  referral_code_id?: string | null;
  referral_code?: string | null;
  referral_discount_amount?: number;
  /** Migration 0006: cancelled invoices reject new receipts. */
  is_cancelled: boolean;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
};

export interface ClientInvoiceDTO {
  id?: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  payment_status: CommercialInvoiceStatus;
  line_items: CommercialInvoiceLineItem[];
  gross_contract_value: number;
  contract_value?: number;
  dp_amount: number;
  minimum_dp_required?: number;
  dp_paid_at: string | null;
  final_balance_amount: number;
  balance_due?: number;
  paid_amount?: number;
  final_balance_paid_at: string | null;
  client_notes: string | null;
  payments?: Array<{
    receipt_number: string;
    amount: number;
    payment_method: string;
    bank_name?: string | null;
    received_at: string;
    applied_to: string;
    verified: boolean;
  }>;
  project: {
    id: string;
    name: string;
    service_pillar: string;
    shoot_date: string | null;
    sector_specs?: Record<string, unknown> | null;
  };
  customer: {
    name: string;
    phone: string;
    email: string | null;
    company?: string | null;
    address?: string | null;
  };
  studio_bank_details: Array<{
    bank: string;
    account_number: string;
    account_holder: string;
  }>;
}

/**
 * Result of a client-facing invoice lookup.
 *
 * Discriminated on `status` so callers cannot treat an infrastructure failure
 * as a successful render. `not_found` maps to a 404; `error` maps to a 5xx.
 */
export type InvoiceLookup =
  | { status: "ok"; data: ClientInvoiceDTO }
  | { status: "not_found" }
  | { status: "error"; code: string }
