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

export type CrewMemberRow = {
  id: string;
  crew_code: string;
  full_name: string;
  phone: string;
  email: string | null;
  /**
   * Login identity for this crew member (migration 0012).
   *
   * NULL means the freelancer has no portal account. Earnings RPCs resolve the
   * caller through this column, so a NULL here means `my_earnings_summary()`
   * returns zeros for that person.
   */
  auth_user_id: string | null;
  primary_skills: string[];
  bank_name: string;
  bank_account_number: string;
  bank_account_holder: string;
  standard_day_rate: number;
  rating: number;
  role_category?: string;
  emergency_contact?: string | null;
  avatar_url?: string | null;
  member_type?: CrewMemberType;
  jobdesk_specialties?: string[];
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
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
  crew_member: Pick<
    CrewMemberRow,
    | "id"
    | "crew_code"
    | "full_name"
    | "phone"
    | "primary_skills"
    | "bank_name"
    | "bank_account_number"
    | "bank_account_holder"
  >;
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
