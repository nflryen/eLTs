// Waterfall Profit Split Engine
// Pure calculation and financial types for Elts. commercial operations

export type MoneySplitStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
export type CashLedgerType = "INFLOW" | "OUTFLOW" | "FOUNDER_ADVANCE";
export type CashLedgerCategory =
  | "PROJECT_SPLIT"
  | "EQUIPMENT_MAINTENANCE"
  | "RESERVE_INFLOW"
  | "DIVIDEND_PAYOUT"
  | "OPERATIONAL";

export interface MoneySplitRow {
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
}

export interface CashLedgerRow {
  id: string;
  project_id: string | null;
  type: CashLedgerType;
  category: CashLedgerCategory;
  amount: number;
  description: string;
  created_at: string;
}
export interface ProjectSplitInput {
  projectId: string;
  grossRevenue: number;
  directCosts?: number;
  commissionPct?: number;
  closerName?: string | null;
}

export interface FinanceOverviewData {
  totalGrossRevenue: number;
  totalReserves: number;
  pendingApprovalsCount: number;
  approvedSplitsCount: number;
  splits: Array<
    MoneySplitRow & {
      project?: {
        id: string;
        name: string;
        slug: string;
        contract_value: number;
      };
    }
  >;
  ledgerEntries: CashLedgerRow[];
  availableProjects: Array<{
    id: string;
    name: string;
    slug: string;
    contract_value: number;
    photography_type: string;
    status: string;
  }>;
}

export interface WaterfallSplitInput {
  grossRevenue: number;
  directCosts?: number;
  reservePct?: number; // default 5.0%
  commissionPct?: number; // default 0.0%
  closerName?: string | null;
  nonCashDepreciation?: number;
  partnerGearPayoutA?: number;
  partnerGearPayoutB?: number;
}

export interface WaterfallSplitResult {
  grossRevenue: number;
  directCosts: number;
  netProfit: number;
  reservePct: number;
  reserveAmount: number;
  commissionPct: number;
  commissionAmount: number;
  closerName: string | null;
  remainder: number;
  founderAShare: number;
  founderBShare: number;
  nonCashDepreciation: number;
  partnerGearPayoutA: number;
  partnerGearPayoutB: number;
  totalFounderAPayout: number;
  totalFounderBPayout: number;
}

/**
 * Cleanly rounds currency values to 2 decimal places to avoid floating point precision errors.
 */
export function roundCurrency(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates the waterfall profit split for an Elts. commercial project:
 * 1. Net Profit = Gross Revenue - Direct Costs (clamped at 0)
 * 2. Studio Cash Reserve = Net Profit * 5% (or reservePct / 100)
 * 3. Closer Commission = Net Profit * (commissionPct / 100)
 * 4. Remainder = Net Profit - Cash Reserve - Closer Commission
 * 5. Founder A (Ray) = 50% of Remainder
 * 6. Founder B (Partner) = 50% of Remainder
 */
export function calculateWaterfallSplit(input: WaterfallSplitInput): WaterfallSplitResult {
  const grossRevenue = roundCurrency(Math.max(0, Number(input.grossRevenue) || 0));
  const directCosts = roundCurrency(Math.max(0, Number(input.directCosts) || 0));

  // Net Profit is gross minus direct costs
  const netProfit = roundCurrency(Math.max(0, grossRevenue - directCosts));

  const reservePct = input.reservePct !== undefined && input.reservePct !== null
    ? Math.max(0, Number(input.reservePct))
    : 5.0;

  const commissionPct = input.commissionPct !== undefined && input.commissionPct !== null
    ? Math.max(0, Number(input.commissionPct))
    : 0.0;

  const closerName = input.closerName?.trim() || null;

  // 1. Studio Cash Reserve (5% default)
  const reserveAmount = roundCurrency(netProfit * (reservePct / 100));

  // 2. Closer Commission (if applicable)
  const commissionAmount = roundCurrency(netProfit * (commissionPct / 100));

  // 3. Remainder to distribute between founders
  const remainder = roundCurrency(Math.max(0, netProfit - reserveAmount - commissionAmount));

  // 4. 50:50 Founder split
  const founderAShare = roundCurrency(remainder / 2);
  // Guarantee exact sum without fractional cent discrepancies
  const founderBShare = roundCurrency(remainder - founderAShare);

  const nonCashDepreciation = roundCurrency(Math.max(0, Number(input.nonCashDepreciation) || 0));
  const partnerGearPayoutA = roundCurrency(Math.max(0, Number(input.partnerGearPayoutA) || 0));
  const partnerGearPayoutB = roundCurrency(Math.max(0, Number(input.partnerGearPayoutB) || 0));

  const totalFounderAPayout = roundCurrency(founderAShare + partnerGearPayoutA);
  const totalFounderBPayout = roundCurrency(founderBShare + partnerGearPayoutB);

  return {
    grossRevenue,
    directCosts,
    netProfit,
    reservePct,
    reserveAmount,
    commissionPct,
    commissionAmount,
    closerName,
    remainder,
    founderAShare,
    founderBShare,
    nonCashDepreciation,
    partnerGearPayoutA,
    partnerGearPayoutB,
    totalFounderAPayout,
    totalFounderBPayout,
  };
}
