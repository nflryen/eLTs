// Executive Cockpit Domain Types

export interface UpcomingAgendaItem {
  id: string;
  date: string;
  time: string;
  title: string;
  pillar: "Pictures / Event" | "Live Streaming" | "Digital Lab" | string;
  location: string;
  fieldLead: string;
  crewCount: number;
  project_id?: string | null;
  status?: string;
  rawDate: string;
}

export interface FinancialHealthSnapshot {
  cashReserveBalance: number;
  pendingReceivables: number;
  unpaidCrewFees: number;
  activeProjectsCount: number;
}

export interface ActionRequiredItem {
  id: string;
  type: "KRU BELUM LENGKAP" | "KURASI MASUK" | "APPROVAL PENDING";
  title: string;
  description: string;
  href: string;
  severity: "urgent" | "warning" | "info";
  badgeText: string;
}

export interface ExecutiveCockpitData {
  upcomingAgenda: UpcomingAgendaItem[];
  financialHealth: FinancialHealthSnapshot;
  actionQueue: ActionRequiredItem[];
  quickCounts: {
    activeProjects: number;
    activeClients: number;
    pendingInvoices: number;
  };
}
