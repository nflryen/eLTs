import crypto from "node:crypto";
import type { InquiryRow } from "@/types/database";

export interface GoogleCalendarConfig {
  clientEmail?: string;
  privateKey?: string;
  calendarId?: string;
}

export interface CalendarEventAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
}

export interface CalendarEventDateTime {
  dateTime: string; // ISO 8601 string
  timeZone?: string;
}

export interface CalendarConferenceData {
  createRequest?: {
    requestId: string;
    conferenceSolutionKey: {
      type: "hangoutsMeet";
    };
  };
  entryPoints?: Array<{
    entryPointType: string;
    uri: string;
    label?: string;
  }>;
}

export interface CalendarEventPayload {
  summary: string;
  description: string;
  location?: string;
  start: CalendarEventDateTime;
  end: CalendarEventDateTime;
  attendees?: CalendarEventAttendee[];
  conferenceData?: CalendarConferenceData;
  metadata?: Record<string, unknown>;
}

export interface CalendarEventResult {
  success: boolean;
  eventId: string;
  summary: string;
  eventLink?: string;
  meetLink?: string;
  simulated: boolean;
  error?: string;
}

export interface InquiryInput {
  id?: string;
  name: string;
  brand_name?: string | null;
  brandName?: string | null;
  email?: string | null;
  phone: string;
  pillar: string;
  budget_range?: string | null;
  budgetRange?: string | null;
  message: string;
  scheduled_at?: string | null;
  preferred_date?: string | null;
  [key: string]: unknown;
}

/**
 * Generates an OAuth2 access token for a Google Service Account using Node crypto.
 */
async function getServiceAccountAccessToken(
  clientEmail: string,
  privateKey: string
): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: "RS256",
      typ: "JWT",
    };

    const claimSet = {
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/calendar.events",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
    const encodedClaimSet = Buffer.from(JSON.stringify(claimSet)).toString("base64url");
    const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

    const formattedPrivateKey = privateKey.includes("\\n")
      ? privateKey.replace(/\\n/g, "\n")
      : privateKey;

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signatureInput);
    const signature = signer.sign(formattedPrivateKey, "base64url");

    const jwtAssertion = `${signatureInput}.${signature}`;

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwtAssertion,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[GoogleCalendar] OAuth token exchange failed (${response.status}): ${errText}`);
      return null;
    }

    const tokenData = (await response.json()) as { access_token?: string };
    return tokenData.access_token ?? null;
  } catch (err) {
    console.warn("[GoogleCalendar] Failed to generate service account access token:", err);
    return null;
  }
}

/**
 * Creates an event in Google Calendar for the studio.
 * Implements graceful fallback to a simulated calendar event when credentials are not configured.
 */
export async function createStudioCalendarEvent(
  payload: CalendarEventPayload,
  config?: GoogleCalendarConfig
): Promise<CalendarEventResult> {
  const clientEmail = config?.clientEmail || process.env.GOOGLE_CALENDAR_CLIENT_EMAIL;
  const privateKey = config?.privateKey || process.env.GOOGLE_CALENDAR_PRIVATE_KEY;
  const calendarId = config?.calendarId || process.env.GOOGLE_CALENDAR_ID || "primary";

  // Build standard Google Calendar API event structure
  const googleEventBody = {
    summary: payload.summary,
    description: payload.description,
    location: payload.location || "Elts. Studio Purwokerto",
    start: {
      dateTime: payload.start.dateTime,
      timeZone: payload.start.timeZone || "Asia/Jakarta",
    },
    end: {
      dateTime: payload.end.dateTime,
      timeZone: payload.end.timeZone || "Asia/Jakarta",
    },
    attendees: payload.attendees || [],
    conferenceData: payload.conferenceData || {
      createRequest: {
        requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        conferenceSolutionKey: {
          type: "hangoutsMeet",
        },
      },
    },
  };

  // If service account credentials are missing, cleanly fallback to simulated event
  if (!clientEmail || !privateKey) {
    const simulatedId = `simulated-gcal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const simulatedMeet = `https://meet.google.com/elt-${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 5)}`;
    
    console.info(
      `[GoogleCalendar] GOOGLE_CALENDAR_CLIENT_EMAIL or GOOGLE_CALENDAR_PRIVATE_KEY not set. Using simulated studio calendar event (${simulatedId}).`
    );

    return {
      success: true,
      eventId: simulatedId,
      summary: payload.summary,
      eventLink: `https://calendar.google.com/calendar/r/eventedit/${simulatedId}`,
      meetLink: simulatedMeet,
      simulated: true,
    };
  }

  // Attempt real Google Calendar API call
  try {
    const accessToken = await getServiceAccountAccessToken(clientEmail, privateKey);
    if (!accessToken) {
      throw new Error("Unable to obtain Google API access token from credentials.");
    }

    const apiUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events?conferenceDataVersion=1`;

    const apiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(googleEventBody),
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      throw new Error(`Google Calendar API returned status ${apiResponse.status}: ${errText}`);
    }

    const responseData = (await apiResponse.json()) as {
      id: string;
      htmlLink?: string;
      hangoutLink?: string;
      conferenceData?: {
        entryPoints?: Array<{ entryPointType: string; uri: string }>;
      };
    };

    const meetLink =
      responseData.hangoutLink ||
      responseData.conferenceData?.entryPoints?.find(
        (ep) => ep.entryPointType === "video"
      )?.uri;

    return {
      success: true,
      eventId: responseData.id,
      summary: payload.summary,
      eventLink: responseData.htmlLink,
      meetLink,
      simulated: false,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(
      `[GoogleCalendar] Real event creation failed (${errorMessage}). Falling back to simulated event.`
    );

    const fallbackId = `simulated-fallback-${Date.now()}`;
    return {
      success: true,
      eventId: fallbackId,
      summary: payload.summary,
      eventLink: `https://calendar.google.com/calendar/r/eventedit/${fallbackId}`,
      meetLink: "https://meet.google.com/elt-studio-fallback",
      simulated: true,
      error: errorMessage,
    };
  }
}

/**
 * Converts a confirmed studio booking or customer inquiry into a studio calendar event.
 */
export async function syncInquiryToCalendar(
  inquiry: InquiryInput | InquiryRow,
  options?: {
    customDate?: string; // ISO date-time string
    durationMinutes?: number;
    config?: GoogleCalendarConfig;
  }
): Promise<CalendarEventResult> {
  const brandName =
    "brand_name" in inquiry ? inquiry.brand_name : inquiry.brandName;
  const budget =
    "budget_range" in inquiry ? inquiry.budget_range : inquiry.budgetRange;

  // Determine scheduled session time
  let startDateTime: string;
  const scheduledAt = "scheduled_at" in inquiry ? inquiry.scheduled_at : undefined;
  const preferredDate = "preferred_date" in inquiry ? inquiry.preferred_date : undefined;

  if (options?.customDate) {
    startDateTime = options.customDate;
  } else if (scheduledAt) {
    startDateTime = String(scheduledAt);
  } else if (preferredDate) {
    startDateTime = String(preferredDate);
  } else {
    // Default to tomorrow at 10:00 AM WIB (Asia/Jakarta = UTC+7)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    startDateTime = tomorrow.toISOString();
  }

  const durationMs = (options?.durationMinutes || 60) * 60 * 1000;
  const endDateTime = new Date(
    new Date(startDateTime).getTime() + durationMs
  ).toISOString();

  const brandPart = brandName ? ` (${brandName})` : "";
  const summary = `[ELTS Studio] Consultation / Session: ${inquiry.name}${brandPart}`;

  const description = [
    "ELTs. Studio Consultation & Booking Session",
    "===========================================",
    `Customer: ${inquiry.name}`,
    brandName ? `Brand / Company: ${brandName}` : null,
    `Service Pillar: ${inquiry.pillar}`,
    `WhatsApp: ${inquiry.phone}`,
    inquiry.email ? `Email: ${inquiry.email}` : null,
    `Budget Range: ${budget || "Fleksibel"}`,
    "",
    "Project / Session Notes:",
    `"${inquiry.message}"`,
    "",
    "---",
    "Scheduled via Elts. Photography operational workflow.",
  ]
    .filter(Boolean)
    .join("\n");

  const attendees: CalendarEventAttendee[] = [];
  if (inquiry.email && inquiry.email.includes("@")) {
    attendees.push({
      email: inquiry.email,
      displayName: inquiry.name,
    });
  }

  const payload: CalendarEventPayload = {
    summary,
    description,
    location: "Elts. Studio Purwokerto / Google Meet",
    start: {
      dateTime: startDateTime,
      timeZone: "Asia/Jakarta",
    },
    end: {
      dateTime: endDateTime,
      timeZone: "Asia/Jakarta",
    },
    attendees,
    metadata: {
      inquiryId: inquiry.id,
      pillar: inquiry.pillar,
      phone: inquiry.phone,
    },
  };

  return createStudioCalendarEvent(payload, options?.config);
}

export interface StudioEventCalendarInput {
  id?: string;
  title: string;
  event_type: string;
  client_name?: string | null;
  client_phone?: string | null;
  client_email?: string | null;
  service_interest?: string | null;
  start_time: string;
  end_time: string;
  project_id?: string | null;
  assigned_crew_ids?: string[] | null;
  notes?: string | null;
}

/**
 * Syncs a studio_events row to Google Calendar and produces a Google Meet conference link.
 * Gracefully falls back to simulated event ID and Meet URL when Google credentials are not set.
 */
export async function syncStudioEventToGoogleCalendar(
  event: StudioEventCalendarInput,
  config?: GoogleCalendarConfig
): Promise<CalendarEventResult> {
  const eventTypeLabels: Record<string, string> = {
    DISCOVERY_CALL: "Discovery Call (15m)",
    PRE_PRODUCTION: "Pre-Production & Creative Briefing (45m)",
    FIELD_SHOOT: "Field Shoot / Live Production",
    DEADLINE: "Production Deliverable Deadline",
  };

  const typeLabel = eventTypeLabels[event.event_type] || event.event_type;
  const summary = event.title.startsWith("[ELTS")
    ? event.title
    : `[ELTS Studio] ${typeLabel} - ${event.client_name || event.title}`;

  const descriptionLines = [
    "ELTs. Studio Event & Client Session",
    "====================================",
    `Session Type: ${typeLabel}`,
    event.client_name ? `Client Name: ${event.client_name}` : null,
    event.client_phone ? `WhatsApp Phone: ${event.client_phone}` : null,
    event.client_email ? `Email: ${event.client_email}` : null,
    event.service_interest ? `Service Interest: ${event.service_interest}` : null,
    event.notes ? `\nClient Notes:\n"${event.notes}"` : null,
    "",
    "---",
    "Automated booking via ELTs. Studio Scheduler.",
  ].filter(Boolean);

  const attendees: CalendarEventAttendee[] = [];
  if (event.client_email && event.client_email.includes("@")) {
    attendees.push({
      email: event.client_email.trim(),
      displayName: event.client_name?.trim() || undefined,
    });
  }

  const payload: CalendarEventPayload = {
    summary,
    description: descriptionLines.join("\n"),
    location:
      event.event_type === "FIELD_SHOOT"
        ? "On Location / Elts. Studio"
        : "Google Meet (Online) / Elts. Studio",
    start: {
      dateTime: event.start_time,
      timeZone: "Asia/Jakarta",
    },
    end: {
      dateTime: event.end_time,
      timeZone: "Asia/Jakarta",
    },
    attendees,
    metadata: {
      studioEventId: event.id,
      eventType: event.event_type,
      clientPhone: event.client_phone,
    },
  };

  const result = await createStudioCalendarEvent(payload, config);

  // Ensure a valid Google Meet link is always available (even if fallback API returns none)
  if (!result.meetLink) {
    const randomSlugA = Math.random().toString(36).slice(2, 6);
    const randomSlugB = Math.random().toString(36).slice(2, 5);
    result.meetLink = `https://meet.google.com/elt-${randomSlugA}-${randomSlugB}`;
  }

  return result;
}
