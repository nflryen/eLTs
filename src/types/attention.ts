import "server-only";

/**
 * Attention types — the contract between the attention engine and the
 * "Hari Ini" queue UI.
 *
 * The whole point of this engine is to surface CROSS-REFERENCES that no single
 * page can show: a shoot on the 5th with unconfirmed crew AND a gear clash AND
 * an unpaid DP are three separate screens today, but one problem in reality.
 */

export type AttentionSeverity = "critical" | "high" | "medium";

export type AttentionAction = {
  label: string;
  /** Where tapping the action goes. External (wa.me / tel) opens a new tab. */
  href: string;
  kind: "primary" | "secondary" | "whatsapp";
};

export type AttentionItem = {
  id: string;
  severity: AttentionSeverity;
  /** Grouping label, e.g. "HARI INI", "TERLAMBAT DIKIRIM". */
  category: string;
  title: string;
  detail: string;
  /** How long this has been waiting, already humanised ("9 jam", "2 hari"). */
  ageLabel: string;
  /** Sort key: hours waiting. Larger = staler = higher in the queue. */
  ageHours: number;
  /** Sub-findings under one problem (e.g. 2 unconfirmed + 1 declined). */
  findings: string[];
  actions: AttentionAction[];
};

export type AttentionQueue = {
  items: AttentionItem[];
  generatedAt: string;
  /** Counts by severity, for the header summary. */
  summary: { critical: number; high: number; medium: number; total: number };
};
