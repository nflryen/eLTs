// Unified User & Access Management Domain Types
// Aggregates across public.admins, public.crew_members, and public.customers

export type UserRole = "OWNER" | "FREELANCE" | "EDITOR" | "CLIENT";
export type UserStatus = "ACTIVE" | "SUSPENDED" | "READY";

export interface UnifiedUserProject {
  id: string;
  name: string;
  slug: string;
  galleryCode: string;
  accessToken: string;
  photographyType: string;
  status: string;
  shootDate: string | null;
  selectionLockedAt: string | null;
}

export interface UnifiedUser {
  id: string;
  name: string;
  role: UserRole;
  email: string;
  phone: string;
  details: string;
  status: UserStatus;
  lastActive: string | null;
  waLink: string;
  metadata?: {
    userId?: string;
    displayName?: string;
    createdAt?: string;
    lastSignIn?: string | null;
    crewCode?: string;
    roleCategory?: string;
    primarySkills?: string[];
    standardDayRate?: number;
    rating?: number;
    bankName?: string;
    bankAccountNumber?: string;
    bankAccountHolder?: string;
    isActive?: boolean;
    assignedTasksCount?: number;
    emergencyContact?: string | null;
    customerId?: string;
    archivedAt?: string | null;
    projectsCount?: number;
    projects?: UnifiedUserProject[];
    [key: string]: unknown;
  };
}
