/**
 * Google Ecosystem & Master Spreadsheet Synchronization Types
 * eLTs Visual Studio OS
 */
export type SyncEntityType =
  | "PROJECT"
  | "INVOICE"
  | "PAYMENT_RECEIPT"
  | "PROOFING_SELECTION";

export type WebhookEnvelopeEntityType = SyncEntityType | "BATCH";
export type SyncAction = "INSERT" | "UPDATE" | "DELETE";

export type SyncStatus = "PENDING" | "SYNCED" | "FAILED";

export interface ProjectSyncData {
  id: string;
  name: string;
  customerName: string;
  customerPhone?: string | null;
  servicePillar?: string | null;
  shootDate?: string | null;
  contractValue: number;
  status: string;
  proofingUrl?: string | null;
  selectionDeadline?: string | null;
}

export interface InvoiceSyncData {
  id: string;
  invoiceNumber: string;
  projectName: string;
  customerName: string;
  issueDate: string;
  dueDate: string;
  grossContractValue: number;
  minimumDpPct: number;
  isDpPaid: boolean;
  isFullyPaid: boolean;
}

export interface PaymentReceiptSyncData {
  id: string;
  receiptNumber: string;
  invoiceNumber: string;
  projectName: string;
  receivedAt: string;
  amount: number;
  paymentMethod: string;
  bankName?: string | null;
  referenceNumber?: string | null;
  verifiedAt?: string | null;
}

export interface ProofingSelectionSyncData {
  projectId: string;
  projectName: string;
  deliverableCount: number;
  quotaMin: number;
  quotaMax: number;
  selectionLockedAt: string;
  assignedEditor?: string | null;
  taskStatus?: string | null;
  googleDriveUrl?: string | null;
}

export type AnySyncData =
  | ProjectSyncData
  | InvoiceSyncData
  | PaymentReceiptSyncData
  | ProofingSelectionSyncData;

export interface WebhookEnvelope<T = AnySyncData> {
  entityType: WebhookEnvelopeEntityType;
  action: SyncAction;
  data: T;
  timestamp: string;
  secret?: string;
}

export interface SyncResult {
  success: boolean;
  sheet?: string;
  row?: number;
  error?: string;
  timestamp: string;
  isMock?: boolean;
}

export interface SpreadsheetSyncLogEntry {
  id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  action: SyncAction;
  sync_target: string;
  status: SyncStatus;
  payload_snapshot: Record<string, unknown>;
  attempts: number;
  last_error: string | null;
  synced_at: string | null;
  created_at: string;
}
