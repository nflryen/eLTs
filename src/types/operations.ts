// Operations & Crew Dispatch Domain Types
// Strictly mirrors public.crew_members, public.project_crew_assignments,
// public.equipment_presets, public.project_expenses

export type CrewPaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
export type CrewMemberType = "CORE_TEAM" | "FREELANCE";
export type AssignmentAcceptanceStatus =
  | "PENDING_OFFER"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED";

export type EquipmentCategory =
  | "CAMERA"
  | "LENS"
  | "WIRELESS_VIDEO"
  | "BROADCAST_SWITCHER"
  | "AUDIO"
  | "INTERCOM"
  | "LIGHTING"
  | "SUPPORT_RIG";

export type EquipmentOwnershipType = "IN_HOUSE" | "EXTERNAL_RENTAL";

export type ExpenseCategory =
  | "CREW_FEE"
  | "EQUIPMENT_RENTAL"
  | "EQUIPMENT_DEPRECIATION"
  | "TRANSPORT_LOGISTICS"
  | "MEALS_CONSUMPTION"
  | "BANDWIDTH_SIM"
  | "SUPPLIES_MISC"
  | "CLIENT_ADDON";

export type ExpensePaidBy =
  | "STUDIO_CASH"
  | "FOUNDER_A_ADVANCE"
  | "FOUNDER_B_ADVANCE"
  | "CLIENT_BILLED";

/**
 * `public.crew_members` — ASSIGNMENT facts only.
 *
 * Migration 0024 removed `phone`, `email`, `bank_*` and `avatar_url` from this
 * table. Person identity and payout live in exactly one place per crew member:
 *
 *   auth_user_id NOT NULL -> `public.user_profiles`   (they have a login)
 *   auth_user_id IS NULL  -> `public.crew_contact_details`
 *
 * Read them through the `v_crew_identity` view rather than querying either
 * table directly, so the linked/unlinked split never leaks into call sites.
 */
export type CrewMemberRow = {
  id: string;
  crew_code: string;
  full_name: string;
  /**
   * Login identity for this crew member (migration 0012).
   *
   * NULL means the freelancer has no portal account. Earnings RPCs resolve the
   * caller through this column, so a NULL here means `my_earnings_summary()`
   * returns zeros for that person.
   */
  auth_user_id: string | null;
  primary_skills: string[];
  standard_day_rate: number;
  rating: number;
  role_category?: string;
  emergency_contact?: string | null;
  member_type?: CrewMemberType;
  jobdesk_specialties?: string[];
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * `public.v_crew_identity` — resolved identity + payout destination.
 *
 * The single read model for "who is this and how do we pay them". `has_login`
 * distinguishes the two backing sources above.
 */
export type CrewIdentityRow = {
  crew_member_id: string;
  crew_code: string;
  full_name: string;
  auth_user_id: string | null;
  member_type: CrewMemberType | null;
  primary_skills: string[] | null;
  jobdesk_specialties: string[] | null;
  role_category: string | null;
  standard_day_rate: number;
  rating: number;
  is_active: boolean;
  has_login: boolean;
  phone: string | null;
  display_full_name: string | null;
  bank_name: string | null;
  bank_account_holder: string | null;
  bank_account_number: string | null;
  payout_method: "BANK" | "EWALLET" | null;
  display_name: string | null;
};

export type ProjectCrewAssignmentRow = {
  id: string;
  project_id: string;
  crew_member_id: string;
  magic_token: string;
  role_title: string;
  call_time: string;
  roll_time: string | null;
  venue_name: string;
  venue_address: string;
  venue_maps_url: string | null;
  dress_code: string;
  technical_notes: string | null;
  allocated_equipment: string[];
  raw_drop_url: string | null;
  fee_agreed: number;
  payment_status: CrewPaymentStatus;
  paid_at: string | null;
  payment_receipt_url: string | null;
  check_in_at: string | null;
  acceptance_status: AssignmentAcceptanceStatus;
  accepted_at: string | null;
  declined_at: string | null;
  declined_reason: string | null;
  /** Migration 0008: a revoked token behaves like an unknown one. */
  revoked_at: string | null;
  offer_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EquipmentPresetRow = {
  id: string;
  name: string;
  category: EquipmentCategory;
  default_rental_rate: number;
  ownership_type: EquipmentOwnershipType;
  is_active: boolean;
  created_at: string;
};

export type ProjectExpenseRow = {
  id: string;
  project_id: string;
  category: ExpenseCategory;
  name: string;
  unit_cost: number;
  quantity: number;
  total_cost: number;
  crew_assignment_id: string | null;
  equipment_preset_id: string | null;
  paid_by: ExpensePaidBy;
  asset_id?: string | null;
  source_type?: "IN_HOUSE" | "PARTNER_OWNED" | "VENDOR_RENTAL";
  owner_name?: string | null;
  vendor_name?: string | null;
  vendor_phone?: string | null;
  rental_duration_days?: number;
  return_date?: string | null;
  return_status?: "PENDING" | "RETURNED" | "OVERDUE";
  receipt_proof_url: string | null;
  notes: string | null;
  is_cash_outflow?: boolean;
  /** Migration 0006: gear pack verification before dispatch. */
  pack_status: string;
  pack_checked_at: string | null;
  pack_checked_by: string | null;
  return_condition: string | null;
  accessories: unknown;
  created_at: string;
  updated_at: string;
};
export interface AddProjectExpenseInput {
  category: ExpenseCategory;
  name: string;
  unitCost: number;
  quantity?: number;
  paidBy?: ExpensePaidBy;
  notes?: string | null;
  equipmentPresetId?: string | null;
  receiptProofUrl?: string | null;
  isCashOutflow?: boolean;
}

export interface ProjectExpensesResult {
  success: boolean;
  expenses: ProjectExpenseRow[];
  categoryTotals: Record<ExpenseCategory, number>;
  totalDirectCosts: number;
  totalCashOutflow?: number;
  totalNonCashDepreciation?: number;
  error?: string;
}

export interface AssignCrewInput {
  projectId: string;
  crewMemberId: string;
  roleTitle: string;
  callTime: string;
  rollTime?: string | null;
  venueName: string;
  venueAddress: string;
  venueMapsUrl?: string | null;
  dressCode?: string;
  technicalNotes?: string | null;
  allocatedEquipment?: string[];
  rawDropUrl?: string | null;
  feeAgreed: number;
}

export interface ProjectCrewAssignmentWithCrew extends ProjectCrewAssignmentRow {
  /*
   * Assignment + resolved identity.
   *
   * Contact and payout fields come from `v_crew_identity` (which resolves
   * user_profiles for linked crew and crew_contact_details for unlinked),
   * because migration 0024 dropped them from crew_members. They are optional:
   * a caller that only needs the name can omit them, and a crew member with no
   * recorded bank account must not make the assignment unrenderable.
   */
  crew_member: Pick<CrewMemberRow, "id" | "crew_code" | "full_name" | "primary_skills"> &
    Partial<{
      phone: string | null;
      bank_name: string | null;
      bank_account_number: string | null;
      bank_account_holder: string | null;
    }>;
}

// Scoped Zero-Leakage DTO returned by get_crew_hub_payload RPC
export interface CrewHubPayload {
  assignment_id: string;
  project_id?: string;
  role_title: string;
  acceptance_status?: AssignmentAcceptanceStatus;
  accepted_at?: string | null;
  declined_at?: string | null;
  declined_reason?: string | null;
  call_time: string;
  roll_time: string | null;
  venue_name: string;
  venue_address: string;
  venue_maps_url: string | null;
  dress_code: string;
  technical_notes: string | null;
  allocated_equipment: string[];
  raw_drop_url: string | null;
  fee_agreed: number;
  payment_status: CrewPaymentStatus;
  paid_at: string | null;
  payment_receipt_url: string | null;
  check_in_at: string | null;
  crew_member: {
    full_name: string;
    crew_code: string;
    bank_name?: string;
    bank_account_number?: string;
    bank_account_holder?: string;
  };
  project: {
    name: string;
    service_pillar: string;
    shoot_date: string | null;
  };
  error?: string;
  message?: string;
}
