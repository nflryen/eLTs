/**
 * Client-safe workspace contract.
 *
 * The data loader in `@/lib/workspace` is `server-only`, so anything a client
 * component needs (module ids, labels, group order) lives here instead. Keep
 * this file free of `server-only` and `next/headers`.
 */

export type WorkspaceModule =
  | "callsheet"
  | "sector"
  | "crew"
  | "gear"
  | "invoice"
  | "rab"
  | "media"
  | "proofing";

export const WORKSPACE_MODULES: Array<{
  id: WorkspaceModule;
  label: string;
  group: "Operate" | "Resource" | "Money" | "Deliver";
}> = [
  { id: "callsheet", label: "Call Sheet", group: "Operate" },
  { id: "sector", label: "Sector Engine", group: "Operate" },
  { id: "crew", label: "Kru", group: "Resource" },
  { id: "gear", label: "Gear", group: "Resource" },
  { id: "invoice", label: "Tagihan Klien", group: "Money" },
  { id: "rab", label: "RAB Internal", group: "Money" },
  { id: "media", label: "Media", group: "Deliver" },
  { id: "proofing", label: "Proofing", group: "Deliver" },
];

export const WORKSPACE_MODULE_GROUPS = ["Operate", "Resource", "Money", "Deliver"] as const;

export const WORKSPACE_MODULE_LABEL: Record<WorkspaceModule, string> = {
  callsheet: "Call Sheet",
  sector: "Sector Engine",
  crew: "Kru & Dispatch",
  gear: "Alat & Logistik",
  invoice: "Tagihan Klien",
  rab: "RAB Internal",
  media: "Media",
  proofing: "Proofing Klien",
};
