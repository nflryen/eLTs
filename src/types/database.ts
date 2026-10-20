export * from "./invoices";
export * from "./sectors";
import type { ProjectInvoiceRow, CommercialInvoiceStatus } from "./invoices";
export * from "./operations";
export * from "./inventory";
import type { InventoryAssetRow } from "./inventory";
import type {
  CrewMemberRow,
  ProjectCrewAssignmentRow,
  EquipmentPresetRow,
  ProjectExpenseRow,
  CrewPaymentStatus,
  EquipmentCategory,
  EquipmentOwnershipType,
  ExpenseCategory,
  ExpensePaidBy,
  CrewMemberType,
  AssignmentAcceptanceStatus,
} from "./operations";

// Foundation types mirror SQL. Regenerate from the connected Supabase project before admin work.
export type ProjectStatus =
  "draft" | "editing" | "ready" | "expired" | "archived";
export type PhotographyType =
  "wedding" | "prewedding" | "graduation" | "couple" | "event";
export type MediaType = "image" | "video";

export type InvoiceMilestone = "DP_50" | "FINAL_BALANCE" | "ADDON";
export type InvoiceStatus = "DRAFT" | "PENDING" | "PAID" | "CANCELLED";
export type EditorTaskStatus = "PENDING" | "IN_PROGRESS" | "REVIEW" | "COMPLETED";
export type InquiryStatus = "NEW" | "CONTACTED" | "QUOTED" | "CONVERTED" | "ARCHIVED";

export type MoodboardCardType = "IMAGE_REF" | "COLOR_SWATCH" | "SHOT_LIST" | "TECH_NOTE";
export type AuthorRole = "CLIENT" | "STUDIO";
export type MoneySplitStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
export type CashLedgerType = "INFLOW" | "OUTFLOW" | "FOUNDER_ADVANCE";
export type CashLedgerCategory =
  | "PROJECT_SPLIT"
  | "EQUIPMENT_MAINTENANCE"
  | "RESERVE_INFLOW"
  | "DIVIDEND_PAYOUT"
  | "OPERATIONAL";
export type StudioEventType = "DISCOVERY_CALL" | "PRE_PRODUCTION" | "FIELD_SHOOT" | "DEADLINE";
export type StudioEventStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED";
export type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};
export type ProjectRow = {
  id: string;
  customer_id: string;
  name: string;
  slug: string;
  photography_type: PhotographyType;
  gallery_code: string;
  gallery_pin_hash: string;
  access_token: string;
  shoot_date: string | null;
  cover_media_id: string | null;
  status: ProjectStatus;
  allow_download: boolean;
  watermark_enabled: boolean;
  expires_at: string | null;
  contract_value: number;
  dp_amount: number;
  is_dp_paid: boolean;
  is_fully_paid: boolean;
  service_pillar: string;
  selection_quota_min: number;
  selection_quota_max: number;
  selection_locked_at: string | null;
  /** Migration 0006: client selection deadline (distinct from lock time). */
  selection_deadline: string | null;
  rehearsal_date?: string | null;
  sector_specs?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
export type MediaRow = {
  id: string;
  project_id: string;
  type: MediaType;
  file_name: string;
  mime_type: string;
  storage_provider: "supabase" | "cloudinary";
  original_key: string;
  thumbnail_key: string | null;
  preview_key: string | null;
  watermarked_thumbnail_key: string | null;
  watermarked_preview_key: string | null;
  cloudinary_public_id: string | null;
  cloudinary_delivery_type: "upload" | "authenticated" | null;
  width: number | null;
  height: number | null;
  file_size: number;
  duration_seconds: number | null;
  processing_status: "pending" | "processing" | "ready" | "failed";
  sort_order: number;
  created_at: string;
};
export type FavoriteRow = {
  id: string;
  project_id: string;
  media_id: string;
  session_id: string;
  created_at: string;
};
export type AdminRow = {
  user_id: string;
  display_name: string;
  created_at: string;
};

export type InvoiceRow = {
  id: string;
  project_id: string;
  invoice_number: string;
  milestone: InvoiceMilestone;
  amount: number;
  status: InvoiceStatus;
  due_date: string | null;
  paid_at: string | null;
  pdf_url: string | null;
  created_at: string;
};

export interface CreateInvoiceInput {
  projectId: string;
  milestone: InvoiceMilestone;
  amount: number;
  dueDate?: string | null;
  invoiceNumber?: string;
}

export interface InquiryFormValues {
  name: string;
  brandName?: string;
  phone: string;
  email?: string;
  pillar: string;
  budgetRange?: string;
  message: string;
  sourcePage?: string;
}

export type EditorTaskRow = {
  id: string;
  project_id: string;
  /** Migration 0012: the login identity that owns this task (auth.uid() scope). */
  /**
   * Legacy free-text editor reference. Still present in the schema; kept for
   * compatibility. Use `assigned_user_id` for auth-scoped ownership.
   */
  assigned_editor_id: string | null;
  /** Migration 0012: the login identity that owns this task (auth.uid() scope). */
  assigned_user_id: string | null;
  /** Migration 0012: rate row used to price the task. */
  rate_id: string | null;
  /** Migration 0012: explicit override; falls back to the rate table. */
  payable_amount: number | null;
  /** Migration 0012: payee identity (may differ from the assignee). */
  payee_user_id: string | null;
  status: EditorTaskStatus;
  deliverable_count: number;
  notes: string | null;
  manifest_json: Record<string, unknown> | Array<unknown> | null;
  created_at: string;
  updated_at: string;
};

export type InquiryRow = {
  id: string;
  name: string;
  brand_name: string | null;
  email: string | null;
  phone: string;
  pillar: string;
  budget_range: string | null;
  message: string;
  status: InquiryStatus;
  source_page: string | null;
  created_at: string;
};

export type MoodboardCardRow = {
  id: string;
  project_id: string;
  card_type: MoodboardCardType;
  title: string;
  payload: Record<string, unknown>;
  sort_order: number;
  created_at: string;
};

export type MoodboardCommentRow = {
  id: string;
  card_id: string;
  author_role: AuthorRole;
  author_name: string;
  content: string;
  created_at: string;
};

export type MoneySplitRow = {
  id: string;
  project_id: string;
  gross_revenue: number;
  direct_costs: number;
  net_profit: number;
  reserve_pct: number;
  reserve_amount: number;
  commission_pct: number;
  commission_amount: number;
  closer_name: string | null;
  founder_a_share: number;
  founder_b_share: number;
  approved_by_a: boolean;
  approved_by_b: boolean;
  status: MoneySplitStatus;
  created_at: string;
  updated_at: string;
};

export type CashLedgerRow = {
  id: string;
  project_id: string | null;
  type: CashLedgerType;
  category: CashLedgerCategory;
  amount: number;
  description: string;
  created_at: string;
};

export type StudioEventRow = {
  id: string;
  title: string;
  event_type: StudioEventType;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  service_interest: string | null;
  start_time: string;
  end_time: string;
  project_id: string | null;
  assigned_crew_ids: string[] | null;
  google_event_id: string | null;
  meet_link: string | null;
  notes: string | null;
  status: StudioEventStatus;
  created_at: string;
};

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  /*
   * Required by @supabase/postgrest-js >= 1.x.
   *
   * The typed client resolves its schema through
   *   Omit<Database, "__InternalSupabase">[SchemaName]
   * and only treats that as a GenericSchema when this marker is present. Without
   * it every `.from(...).select(...)` infers `never`, which is why every caller
   * in this codebase had been using the untyped service-role client instead.
   * The client library is unaffected; only type inference changes.
   */
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      admins: Table<AdminRow, "user_id" | "display_name">;
      /* ── Payroll pivot (migrations 0012–0015) ───────────────────────────── */
      partner_accounts: Table<
        {
          id: string;
          user_id: string;
          display_name: string;
          equity_bp: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        },
        "user_id" | "display_name" | "equity_bp"
      >;
      compensation_rates: Table<
        {
          id: string;
          role_key: string;
          task_kind: string;
          label: string;
          amount: number;
          unit: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        },
        "role_key" | "task_kind" | "label" | "amount"
      >;
      project_profit_snapshots: Table<
        {
          id: string;
          project_id: string;
          gross_revenue: number;
          direct_costs: number;
          net_profit: number;
          operational_reserve: number;
          distributable_profit: number;
          status: "DRAFT" | "FINALIZED" | "LOSS" | "SUPERSEDED";
          computed_at: string;
          computed_by: string | null;
          superseded_by: string | null;
        },
        "project_id"
      >;
      compensation_line_items: Table<
        {
          id: string;
          payee_user_id: string | null;
          payee_crew_id: string | null;
          kind: "CREW_FEE" | "EDITOR_RATE" | "SALARY" | "DIVIDEND" | "RESERVE";
          project_id: string | null;
          source_table: string;
          source_id: string;
          role_label: string | null;
          gross_amount: number;
          deduction_amount: number;
          net_amount: number;
          earned_on: string;
          state: "PENDING_VERIFICATION" | "APPROVED" | "READY_FOR_DISBURSEMENT" | "PAID" | "VOID";
          payroll_cycle_id: string | null;
          payslip_id: string | null;
          paid_at: string | null;
          created_at: string;
          updated_at: string;
        },
        "kind" | "source_table" | "source_id" | "gross_amount"
      >;
      payroll_cycles: Table<
        {
          id: string;
          period_key: string;
          status: "DRAFT" | "APPROVED" | "DISBURSED" | "CLOSED";
          opened_at: string;
          approved_at: string | null;
          disbursed_at: string | null;
          closed_at: string | null;
          created_by: string | null;
        },
        "period_key"
      >;
      payslip_records: Table<
        {
          id: string;
          slip_number: string;
          payroll_cycle_id: string;
          payee_user_id: string | null;
          payee_crew_id: string | null;
          total_gross: number;
          total_deduction: number;
          total_net: number;
          verification_hash: string;
          issued_at: string;
        },
        "slip_number" | "payroll_cycle_id" | "verification_hash"
      >;
      customers: Table<CustomerRow, "name">;
      projects: Table<
        ProjectRow,
        | "customer_id"
        | "name"
        | "slug"
        | "photography_type"
        | "gallery_code"
        | "gallery_pin_hash"
        | "access_token"
      >;
      media: Table<
        MediaRow,
        | "project_id"
        | "type"
        | "file_name"
        | "mime_type"
        | "original_key"
        | "file_size"
      >;
      favorites: Table<FavoriteRow, "project_id" | "media_id" | "session_id">;
      editor_tasks: Table<
        EditorTaskRow,
        "project_id"
      >;
      inquiries: Table<
        InquiryRow,
        "name" | "phone" | "pillar" | "message"
      >;
      moodboard_cards: Table<MoodboardCardRow, "project_id" | "card_type" | "title">;
      moodboard_comments: Table<MoodboardCommentRow, "card_id" | "author_role" | "author_name" | "content">;
      money_splits: Table<MoneySplitRow, "project_id" | "gross_revenue">;
      cash_ledger: Table<CashLedgerRow, "type" | "category" | "amount" | "description">;
      studio_events: Table<StudioEventRow, "title" | "event_type" | "start_time" | "end_time">;
      crew_members: Table<CrewMemberRow, "crew_code" | "full_name" | "phone" | "bank_name" | "bank_account_number" | "bank_account_holder">;
      project_crew_assignments: Table<ProjectCrewAssignmentRow, "project_id" | "crew_member_id" | "magic_token" | "role_title" | "call_time" | "venue_name" | "venue_address">;
      equipment_presets: Table<EquipmentPresetRow, "name" | "category">;
      project_expenses: Table<ProjectExpenseRow, "project_id" | "category" | "name" | "unit_cost">;
      inventory_assets: Table<InventoryAssetRow, "asset_code" | "name" | "category">;
      project_invoices: Table<ProjectInvoiceRow, "project_id" | "invoice_number" | "gross_contract_value">;

      /* -- Remaining live tables (previously undeclared) ---------------------
       * Generated from information_schema against the hosted database.
       * `never` as the required-key set means "no insert path is declared";
       * these are read-only from the app or written by SQL functions.
       */
client_reminders_log: Table<
        {
          id: string;
          project_id: string | null;
          invoice_id: string | null;
          reminder_kind: string;
          target_phone: string;
          channel: string;
          dispatched_by: string | null;
          dispatched_at: string;
          body_snapshot: string;
        },
        never
      >;
      document_sequences: Table<
        {
          doc_type: string;
          period_key: string;
          last_value: number;
          updated_at: string;
        },
        never
      >;
      invoice_payment_receipts: Table<
        {
          id: string;
          invoice_id: string;
          receipt_number: string;
          amount: number;
          currency: string;
          payment_method: string;
          bank_name: string | null;
          reference_number: string | null;
          received_at: string;
          proof_storage_key: string | null;
          applied_to: string;
          verified_at: string | null;
          verified_by: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        },
        never
      >;
      outgoing_rental_items: Table<
        {
          id: string;
          order_id: string;
          asset_id: string;
          quantity: number;
          unit_rate: number;
          line_total: number | null;
          condition_out: string;
          accessories_out: Record<string, unknown>;
          accessories_in: Record<string, unknown> | null;
          notes: string | null;
          created_at: string;
        },
        never
      >;
      outgoing_rental_orders: Table<
        {
          id: string;
          order_number: string;
          renter_name: string;
          renter_type: string;
          company_name: string | null;
          renter_phone: string;
          renter_email: string | null;
          ktp_number: string | null;
          ktp_photo_key: string | null;
          ktp_verified_at: string | null;
          ktp_verified_by: string | null;
          pickup_at: string;
          return_due_at: string;
          buffer_hours: number;
          actual_returned_at: string | null;
          rental_days: number;
          subtotal: number;
          deposit_amount: number;
          deposit_held_at: string | null;
          deposit_refunded_at: string | null;
          late_fee_accrued: number;
          late_fee_per_day: number;
          damage_charge: number;
          status: string;
          condition_on_return: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        },
        never
      >;
      payroll_audit_log: Table<
        {
          id: string;
          cycle_id: string | null;
          event: string;
          actor_user_id: string | null;
          actor_rank: number | null;
          detail: Record<string, unknown>;
          created_at: string;
        },
        never
      >;
      permissions: Table<
        {
          key: string;
          description: string;
          domain: string;
        },
        never
      >;
      portfolio_showcases: Table<
        {
          id: string;
          project_id: string | null;
          slug: string;
          title: string;
          summary: string | null;
          category: string;
          cover_media_id: string | null;
          cover_url: string | null;
          embed_url: string | null;
          embed_provider: string | null;
          embed_video_id: string | null;
          thumbnail_url: string | null;
          client_name: string | null;
          client_logo_url: string | null;
          credits: Record<string, unknown>;
          tags: string[];
          is_published: boolean;
          is_featured: boolean;
          sort_order: number;
          published_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        },
        never
      >;
      role_assignments: Table<
        {
          user_id: string;
          role_key: string;
          granted_by: string | null;
          granted_at: string;
          revoked_at: string | null;
        },
        never
      >;
      role_permissions: Table<
        {
          role_key: string;
          permission_key: string;
        },
        never
      >;
      roles: Table<
        {
          key: string;
          label: string;
          rank: number;
          description: string | null;
          is_staff: boolean;
          created_at: string;
        },
        never
      >;
      schema_migrations: Table<
        {
          filename: string;
          applied_at: string;
        },
        never
      >;
      studio_payment_methods: Table<
        {
          id: string;
          bank_name: string;
          account_number: string;
          account_holder: string;
          label: string | null;
          is_active: boolean;
          is_primary: boolean;
          sort_order: number;
          effective_from: string;
          effective_to: string | null;
          created_at: string;
          updated_at: string;
        },
        never
      >;
      vendor_purchase_order_items: Table<
        {
          id: string;
          po_id: string;
          asset_id: string | null;
          description: string;
          quantity: number;
          unit_days: number;
          unit_rate: number;
          line_total: number | null;
          created_at: string;
        },
        never
      >;
      vendor_purchase_orders: Table<
        {
          id: string;
          po_number: string;
          project_id: string;
          vendor_name: string;
          vendor_phone: string | null;
          vendor_address: string | null;
          pickup_at: string;
          return_due_at: string;
          status: string;
          subtotal: number;
          deposit_amount: number;
          wa_sent_at: string | null;
          confirmed_at: string | null;
          picked_up_at: string | null;
          returned_at: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        },
        never
      >;
    };
    /*
     * Must be a concrete Record<string, GenericView>, NOT Record<string, never>.
     *
     * @supabase/postgrest-js checks `public extends GenericSchema`, and
     * GenericSchema requires Tables + Views + Functions. `Record<string, never>`
     * does not satisfy `Record<string, GenericView>`, so the check failed and the
     * whole schema fell back to `any` — every `.from().select()` inferred
     * `never`. That is why callers had been routing reads through the untyped
     * service client.
     */
    Views: {
      v_invoice_financial_position: {
        Row: {
          invoice_id: string;
          invoice_number: string;
          project_id: string;
          issue_date: string;
          due_date: string;
          contract_value: number;
          minimum_dp_pct: number;
          minimum_dp_required: number;
          paid_amount: number;
          unverified_amount: number;
          balance_due: number;
          overpayment_amount: number;
          derived_status: string;
          dp_floor_satisfied: boolean;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      v_inventory_assets_for_caller: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
    };
    Functions: {
      create_gallery_session: {
        Args: { p_project_id: string; p_verified_pin_hash: string; p_token_hash: string; p_upgraded_pin_hash?: string | null };
        Returns: { session_id: string; project_id: string; access_token: string; expires_at: string }[];
      };
      resolve_gallery_session: {
        Args: { p_token_hash: string };
        Returns: { session_id: string; project_id: string; access_token: string; slug: string; expires_at: string | null }[];
      };
      revoke_gallery_session: { Args: { p_token_hash: string }; Returns: undefined };
      consume_gallery_attempt: {
        Args: { p_bucket_key: string };
        Returns: { allowed: boolean; retry_after_seconds: number }[];
      };
      submit_photo_selection: {
        Args: { p_project_id: string; p_session_id: string };
        Returns: { success: boolean; task_id: string; deliverable_count: number; locked_at: string };
      };
      approve_money_split: {
        Args: { p_split_id: string; p_founder: string };
        Returns: { success: boolean; status: string; approved_by_a: boolean; approved_by_b: boolean }[];
      };
      get_crew_hub_payload: {
        Args: { p_magic_token: string };
        Returns: Record<string, unknown>;
      };
      check_asset_scheduling_conflict: {
        Args: { p_asset_id: string; p_project_id: string; p_event_date: string };
        Returns: { conflict_found: boolean; conflicting_project_id: string; conflicting_project_name: string }[];
      };
      check_asset_scheduling_conflict_v2: {
        Args: {
          p_asset_id: string;
          p_project_id: string;
          p_target_date: string;
          p_prep_days_before?: number;
          p_return_days_after?: number;
        };
        Returns: {
          conflict_found: boolean;
          conflict_type: string;
          conflicting_project_id: string;
          conflicting_project_name: string;
          conflicting_date: string;
        }[];
      };
      respond_crew_assignment_offer: {
        Args: { p_magic_token: string; p_accept: boolean; p_declined_reason?: string | null };
        Returns: { success: boolean; status: string; message: string };
      };
      crew_check_in: {
        Args: { p_magic_token: string };
        Returns: {
          success: boolean;
          error?: string;
          message?: string;
          already_checked_in?: boolean;
          check_in_at?: string;
        };
      };
      get_asset_utilization_calendar: {
        Args: { p_asset_id: string };
        Returns: Record<string, unknown>;
      };
      get_client_invoice_dto: {
        Args: { p_invoice_number: string };
        Returns: Record<string, unknown>;
      };
      // RBAC helpers (migration 0002). SECURITY DEFINER, resolving the actor
      // from auth.uid(); must be called on a user-scoped client, never the
      // service-role client (which carries no JWT and yields a null role).
      my_earnings_summary: {
        Args: Record<string, never>;
        Returns: Record<string, unknown>;
      };
      payroll_operational_summary: {
        Args: { p_caller_rank?: number };
        Returns: Record<string, unknown>;
      };
      payroll_executive_summary: {
        Args: { p_caller_rank?: number };
        Returns: Record<string, unknown>;
      };
      /* ── Payroll cycle lifecycle (migrations 0017/0018) ──────────────── */
      next_document_number: {
        Args: { p_doc_type: string; p_period_key: string };
        Returns: string;
      };
      next_slip_number: {
        Args: { p_period_key: string };
        Returns: string;
      };
      generate_payroll_cycle: {
        Args: {
          p_period_key: string;
          p_caller_rank: number;
          p_include_dividends?: boolean;
        };
        Returns: {
          success: boolean;
          error?: string;
          message?: string;
          cycle_id?: string;
          period_key?: string;
          slips_created?: number;
          lines_settled?: number;
          total_disbursement?: number;
          reused_cycle?: boolean;
          run_key?: string;
        };
      };
      lock_payroll_cycle: {
        Args: { p_cycle_id: string; p_caller_rank: number; p_actor?: string | null };
        Returns: {
          success: boolean;
          error?: string;
          message?: string;
          cycle_id?: string;
          status?: string;
        };
      };
      disburse_payroll_cycle: {
        Args: { p_cycle_id: string; p_caller_rank: number; p_actor?: string | null };
        Returns: {
          success: boolean;
          error?: string;
          message?: string;
          cycle_id?: string;
          slips?: number;
          total_disbursement?: number;
          disbursed_at?: string;
        };
      };
      get_caller_role: {
        Args: Record<string, never>;
        Returns: {
          role_key: string | null;
          role_rank: number | null;
          display_name: string | null;
        }[];
      };
      has_permission_for_caller: {
        Args: { p_permission_key: string };
        Returns: boolean;
      };
    };
    Enums: {
      project_status: ProjectStatus;
      photography_type: PhotographyType;
      media_type: MediaType;
      invoice_milestone: InvoiceMilestone;
      invoice_status: InvoiceStatus;
      editor_task_status: EditorTaskStatus;
      inquiry_status: InquiryStatus;
      moodboard_card_type: MoodboardCardType;
      author_role: AuthorRole;
      money_split_status: MoneySplitStatus;
      cash_ledger_type: CashLedgerType;
      cash_ledger_category: CashLedgerCategory;
      studio_event_type: StudioEventType;
      studio_event_status: StudioEventStatus;
      crew_payment_status: CrewPaymentStatus;
      equipment_category: EquipmentCategory;
      equipment_ownership_type: EquipmentOwnershipType;
      expense_category: ExpenseCategory;
      expense_paid_by: ExpensePaidBy;
      crew_member_type: CrewMemberType;
      assignment_acceptance_status: AssignmentAcceptanceStatus;
      commercial_invoice_status: CommercialInvoiceStatus;
    };
  };
};
