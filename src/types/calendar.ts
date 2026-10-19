export type StudioEventType =
  | "DISCOVERY_CALL"
  | "PRE_PRODUCTION"
  | "FIELD_SHOOT"
  | "DEADLINE";

export type StudioEventStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED";

export interface StudioEvent {
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
}

export type StudioEventInsert = Omit<StudioEvent, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type PublicBookingType = "DISCOVERY_CALL" | "PRE_PRODUCTION";

export interface BookingOption {
  type: PublicBookingType;
  title: string;
  durationMinutes: number;
  description: string;
  badge: string;
  mode: string;
}

export interface BookingSlot {
  time: string; // e.g. "09:00"
  startIso: string;
  endIso: string;
  available: boolean;
  conflictReason?: string;
}

export interface BookingConfirmationDetails {
  eventId: string;
  title: string;
  clientName: string;
  clientEmail?: string | null;
  clientPhone: string;
  serviceInterest: string;
  startTime: string;
  endTime: string;
  meetLink?: string | null;
  waLink: string;
}

export interface AssignedCrewMember {
  name: string;
  role: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  event_type:
    | "DISCOVERY_CALL"
    | "PRE_PRODUCTION"
    | "FIELD_SHOOT"
    | "DEADLINE"
    | "PROJECT_SHOOT"
    | "CREW_CALL"
    | string;
  pillar: "Pictures / Event" | "Live Streaming" | "Digital Lab" | string;
  project_id: string | null;
  project_name: string | null;
  venue_name: string | null;
  venue_maps_url: string | null;
  assigned_crew: AssignedCrewMember[];
  meet_link: string | null;
  notes?: string | null;
  status?: string;
  dress_code?: string | null;
  client_name?: string | null;
  client_phone?: string | null;
  client_email?: string | null;
}

export interface BookingFormData {
  eventType: "DISCOVERY_CALL" | "PRE_PRODUCTION";
  date: string;
  timeSlot: string;
  fullName: string;
  whatsapp: string;
  email?: string;
  servicePillar: "Pictures Event/Graduation" | "Broadcast Live Stream" | "Digital Lab";
  notes?: string;
}
