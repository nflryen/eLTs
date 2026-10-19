-- Migration: 202609280001_client_invoices_and_crud_extensions.sql
BEGIN;

-- ============================================================================
-- 1. COMMERCIAL CLIENT INVOICE SYSTEM (public.project_invoices)
-- ============================================================================
-- Strictly separated from internal expenses to guarantee zero-leakage privacy
CREATE TABLE IF NOT EXISTS public.project_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE CHECK (invoice_number ~ '^INV/[0-9]{8}/[A-Z0-9_-]{2,20}$'),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL CHECK (due_date >= issue_date),
  
  -- Commercial Retail Line Items (JSONB array of clean commercial services)
  -- Schema: [{ description: text, quantity: num, unit_price: num, subtotal: num }]
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  gross_contract_value NUMERIC NOT NULL CHECK (gross_contract_value >= 0),
  dp_amount NUMERIC NOT NULL DEFAULT 0 CHECK (dp_amount >= 0),
  dp_paid_at TIMESTAMPTZ,
  final_balance_amount NUMERIC NOT NULL DEFAULT 0 CHECK (final_balance_amount >= 0),
  final_balance_paid_at TIMESTAMPTZ,
  
  payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN (
    'UNPAID',               -- Belum ada pembayaran
    'PARTIALLY_PAID_DP',    -- DP Lunas, sisa pelunasan pending
    'PAID_IN_FULL',         -- Lunas 100%
    'CANCELLED'             -- Dibatalkan
  )),
  
  client_notes TEXT,
  pdf_storage_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pi_project ON public.project_invoices (project_id);
CREATE INDEX IF NOT EXISTS idx_pi_status ON public.project_invoices (payment_status);

-- ============================================================================
-- 2. TRIGGER: AUTOMATIC PROJECT PAYMENT SYNC FROM INVOICE STATUS
-- ============================================================================
-- Invariant: Updating invoice status automatically synchronizes is_dp_paid & is_fully_paid
CREATE OR REPLACE FUNCTION public.sync_project_payment_from_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.payment_status = 'PARTIALLY_PAID_DP' THEN
    UPDATE public.projects
    SET is_dp_paid = true, updated_at = now()
    WHERE id = NEW.project_id;
  ELSIF NEW.payment_status = 'PAID_IN_FULL' THEN
    UPDATE public.projects
    SET is_dp_paid = true, is_fully_paid = true, updated_at = now()
    WHERE id = NEW.project_id;
  ELSIF NEW.payment_status = 'UNPAID' THEN
    UPDATE public.projects
    SET is_dp_paid = false, is_fully_paid = false, updated_at = now()
    WHERE id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_project_payment ON public.project_invoices;
CREATE TRIGGER trg_sync_project_payment
  AFTER INSERT OR UPDATE OF payment_status ON public.project_invoices
  FOR EACH ROW EXECUTE FUNCTION public.sync_project_payment_from_invoice();

-- ============================================================================
-- 3. ZERO-LEAKAGE SECURITY DEFINER RPC: get_client_invoice_dto
-- ============================================================================
-- Strict Invariant: Redacts all direct costs, equipment expenses, and profit splits
CREATE OR REPLACE FUNCTION public.get_client_invoice_dto(p_invoice_number TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inv RECORD;
  v_proj RECORD;
  v_cust RECORD;
  v_response JSONB;
BEGIN
  SELECT * INTO v_inv FROM public.project_invoices WHERE invoice_number = p_invoice_number;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND', 'message', 'Invoice tidak ditemukan.');
  END IF;

  SELECT id, name, service_pillar, photography_type, shoot_date INTO v_proj FROM public.projects WHERE id = v_inv.project_id;
  SELECT name, email, phone INTO v_cust FROM public.customers WHERE id = (SELECT customer_id FROM public.projects WHERE id = v_inv.project_id);

  v_response := jsonb_build_object(
    'invoice_number', v_inv.invoice_number,
    'issue_date', v_inv.issue_date,
    'due_date', v_inv.due_date,
    'payment_status', v_inv.payment_status,
    'line_items', v_inv.line_items,
    'gross_contract_value', v_inv.gross_contract_value,
    'dp_amount', v_inv.dp_amount,
    'dp_paid_at', v_inv.dp_paid_at,
    'final_balance_amount', v_inv.final_balance_amount,
    'final_balance_paid_at', v_inv.final_balance_paid_at,
    'client_notes', v_inv.client_notes,
    'project', jsonb_build_object(
      'id', v_proj.id,
      'name', v_proj.name,
      'service_pillar', v_proj.service_pillar,
      'shoot_date', v_proj.shoot_date
    ),
    'customer', jsonb_build_object(
      'name', v_cust.name,
      'phone', v_cust.phone,
      'email', v_cust.email
    ),
    'studio_bank_details', jsonb_build_array(
      jsonb_build_object('bank', 'BCA', 'account_number', '046-092-8170', 'account_holder', 'Muhammad Rayyan Nufail'),
      jsonb_build_object('bank', 'Mandiri', 'account_number', '137-001-928-3701', 'account_holder', 'Studio Kineva Elts')
    )
  );

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.get_client_invoice_dto(TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_invoice_dto(TEXT) TO anon, authenticated, service_role;

-- RLS
ALTER TABLE public.project_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all_project_invoices ON public.project_invoices TO authenticated USING ((SELECT private.is_admin()));
GRANT ALL ON TABLE public.project_invoices TO authenticated, service_role;

COMMIT;
