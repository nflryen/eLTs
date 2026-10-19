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

export interface ProjectInvoiceRow {
  id: string;
  project_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  line_items: CommercialInvoiceLineItem[];
  gross_contract_value: number;
  dp_amount: number;
  dp_paid_at: string | null;
  final_balance_amount: number;
  final_balance_paid_at: string | null;
  payment_status: CommercialInvoiceStatus;
  client_notes: string | null;
  pdf_storage_key: string | null;
  created_at: string;
  updated_at: string;
}

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
