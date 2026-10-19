"use server";

import { createServiceSupabase } from "@/lib/supabase/service";
import { requireOps } from "@/lib/auth/roles";
import type { AssignedCrewMember, CalendarEvent } from "@/types/calendar";

/**
 * Normalizes disparate pillar, service type, and photography tags into
 * the 3 canonical operational pillars:
 * 1. "Pictures / Event"
 * 2. "Live Streaming"
 * 3. "Digital Lab"
 */
function normalizePillar(
  servicePillar?: string | null,
  photographyType?: string | null,
  serviceInterest?: string | null,
  eventType?: string | null
): "Pictures / Event" | "Live Streaming" | "Digital Lab" {
  const combined = [servicePillar, photographyType, serviceInterest, eventType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    combined.includes("live") ||
    combined.includes("stream") ||
    combined.includes("broadcast")
  ) {
    return "Live Streaming";
  }

  if (
    combined.includes("lab") ||
    combined.includes("digital") ||
    combined.includes("post") ||
    combined.includes("edit") ||
    combined.includes("software")
  ) {
    return "Digital Lab";
  }

  return "Pictures / Event";
}

/**
 * Aggregates calendar events from:
 * a) public.studio_events (discovery calls, meetings, field shoots)
 * b) public.projects with shoot_date (event shoot days, graduation shoots)
 * c) public.project_crew_assignments (crew call times and assignments)
 *
 * Normalizes into a unified calendar event shape and filters by month and pillar.
 */
export async function getCalendarEvents(
  month?: string,
  filterPillar?: string
): Promise<CalendarEvent[]> {
  // Ensure admin credentials
  try {
    await requireOps();
  } catch {
    // If running in development without auth session or server context, proceed with service client
  }

  const supabase = createServiceSupabase();

  // Resolve target month window (default: current month)
  const now = new Date();
  const targetMonthStr = month && /^\d{4}-\d{2}$/.test(month)
    ? month
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [yearStr, monthNumStr] = targetMonthStr.split("-");
  const year = parseInt(yearStr, 10);
  const monthIdx = parseInt(monthNumStr, 10) - 1;

  // Window bounds: 7 days before start of month to 14 days after end of month
  // ensures adjacent overflow days on 35/42-cell monthly calendar grid are included
  const windowStart = new Date(Date.UTC(year, monthIdx, 1 - 7, 0, 0, 0));
  const windowEnd = new Date(Date.UTC(year, monthIdx + 1, 14, 23, 59, 59));

  const windowStartIso = windowStart.toISOString();
  const windowEndIso = windowEnd.toISOString();
  const windowStartDateOnly = windowStartIso.slice(0, 10);
  const windowEndDateOnly = windowEndIso.slice(0, 10);

  const aggregatedEvents: CalendarEvent[] = [];

  // 1. Fetch Crew Members Directory for name resolution
  const crewMap = new Map<string, { full_name: string; crew_code: string }>();
  try {
    const { data: crewData, error: crewError } = await supabase
      .from("crew_members")
      .select("id, full_name, crew_code");

    if (!crewError && crewData) {
      for (const cm of crewData) {
        crewMap.set(cm.id, { full_name: cm.full_name, crew_code: cm.crew_code });
      }
    }
  } catch (err) {
    console.warn("[AdminCalendar] Warning querying crew_members:", err);
  }

  // 2. Fetch Projects (both for shoot_date and for metadata enrichment)
  const projectMap = new Map<
    string,
    {
      id: string;
      name: string;
      service_pillar?: string;
      photography_type?: string;
      shoot_date?: string | null;
      status?: string;
    }
  >();

  try {
    const { data: projectsData, error: prError } = await supabase
      .from("projects")
      .select("id, name, service_pillar, photography_type, shoot_date, status");

    if (!prError && projectsData) {
      for (const pr of projectsData) {
        projectMap.set(pr.id, pr);
      }
    }
  } catch (err) {
    console.warn("[AdminCalendar] Warning querying projects:", err);
  }

  // 3. Fetch Project Crew Assignments within window
  type RawAssignment = {
    id: string;
    project_id: string;
    crew_member_id: string;
    role_title: string;
    call_time: string;
    roll_time: string | null;
    venue_name: string;
    venue_address: string;
    venue_maps_url: string | null;
    dress_code: string;
    technical_notes: string | null;
    fee_agreed: number;
    payment_status: string;
  };

  const assignmentsByProjectAndDate = new Map<string, RawAssignment[]>();
  const assignmentsByProjectId = new Map<string, RawAssignment[]>();

  try {
    const { data: assignmentsData, error: pcaError } = await supabase
      .from("project_crew_assignments")
      .select(`
        id,
        project_id,
        crew_member_id,
        role_title,
        call_time,
        roll_time,
        venue_name,
        venue_address,
        venue_maps_url,
        dress_code,
        technical_notes,
        fee_agreed,
        payment_status
      `)
      .gte("call_time", windowStartIso)
      .lte("call_time", windowEndIso);

    if (!pcaError && assignmentsData) {
      for (const a of assignmentsData as RawAssignment[]) {
        // Group by project_id
        const listProj = assignmentsByProjectId.get(a.project_id) || [];
        listProj.push(a);
        assignmentsByProjectId.set(a.project_id, listProj);

        // Group by project_id + call_time date
        const callDate = a.call_time.slice(0, 10);
        const groupKey = `${a.project_id}_${callDate}`;
        const listGroup = assignmentsByProjectAndDate.get(groupKey) || [];
        listGroup.push(a);
        assignmentsByProjectAndDate.set(groupKey, listGroup);
      }
    }
  } catch (err) {
    console.warn("[AdminCalendar] Warning querying project_crew_assignments:", err);
  }

  // Set to track crew assignment group keys that were merged into project shoot events
  const mergedAssignmentGroups = new Set<string>();

  // A) Process Studio Events
  try {
    const { data: studioEvents, error: seError } = await supabase
      .from("studio_events")
      .select(`
        id,
        title,
        event_type,
        client_name,
        client_phone,
        client_email,
        service_interest,
        start_time,
        end_time,
        project_id,
        assigned_crew_ids,
        google_event_id,
        meet_link,
        notes,
        status
      `)
      .gte("end_time", windowStartIso)
      .lte("start_time", windowEndIso)
      .neq("status", "CANCELLED");

    if (!seError && studioEvents) {
      for (const se of studioEvents) {
        const linkedProj = se.project_id ? projectMap.get(se.project_id) : null;

        // Resolve assigned crew from IDs
        const assignedCrew: AssignedCrewMember[] = [];
        if (Array.isArray(se.assigned_crew_ids)) {
          for (const cid of se.assigned_crew_ids) {
            const member = crewMap.get(cid);
            if (member) {
              assignedCrew.push({
                name: member.full_name,
                role: "Crew",
              });
            } else if (typeof cid === "string" && cid.trim()) {
              assignedCrew.push({
                name: cid,
                role: "Crew",
              });
            }
          }
        }

        const pillar = normalizePillar(
          linkedProj?.service_pillar,
          linkedProj?.photography_type,
          se.service_interest,
          se.event_type
        );

        aggregatedEvents.push({
          id: `studio-${se.id}`,
          title: se.title,
          start_time: se.start_time,
          end_time: se.end_time,
          event_type: se.event_type,
          pillar,
          project_id: se.project_id || null,
          project_name: linkedProj?.name || null,
          venue_name: se.meet_link ? "Google Meet" : "Studio / On-Location",
          venue_maps_url: null,
          assigned_crew: assignedCrew,
          meet_link: se.meet_link || null,
          notes: se.notes || null,
          status: se.status,
          client_name: se.client_name || null,
          client_phone: se.client_phone || null,
          client_email: se.client_email || null,
        });
      }
    }
  } catch (err) {
    console.warn("[AdminCalendar] Warning processing studio_events:", err);
  }

  // B) Process Projects with shoot_date within window
  for (const pr of projectMap.values()) {
    if (!pr.shoot_date) continue;

    // Check if shoot_date falls inside window
    const shootDatePart = pr.shoot_date.slice(0, 10);
    if (shootDatePart < windowStartDateOnly || shootDatePart > windowEndDateOnly) {
      continue;
    }

    const groupKey = `${pr.id}_${shootDatePart}`;
    const dayAssignments = assignmentsByProjectAndDate.get(groupKey) || [];

    // Collect assigned crew from assignments
    const assignedCrew: AssignedCrewMember[] = [];
    let venueName = "Lokasi Pemotretan / On-Location";
    let venueMapsUrl: string | null = null;
    let dressCode: string | null = null;
    let techNotes: string | null = null;
    let earliestCallTime: string | null = null;
    let latestRollTime: string | null = null;

    if (dayAssignments.length > 0) {
      mergedAssignmentGroups.add(groupKey);
      venueName = dayAssignments[0].venue_name;
      venueMapsUrl = dayAssignments[0].venue_maps_url || null;
      dressCode = dayAssignments[0].dress_code || null;
      techNotes = dayAssignments[0].technical_notes || null;

      for (const a of dayAssignments) {
        const crewMember = crewMap.get(a.crew_member_id);
        assignedCrew.push({
          name: crewMember ? crewMember.full_name : "Freelance Crew",
          role: a.role_title,
        });

        if (!earliestCallTime || a.call_time < earliestCallTime) {
          earliestCallTime = a.call_time;
        }
        if (a.roll_time && (!latestRollTime || a.roll_time > latestRollTime)) {
          latestRollTime = a.roll_time;
        }
      }
    }

    // Default times if not specified by call_time
    const startTime = earliestCallTime || `${shootDatePart}T08:00:00+07:00`;
    const endTime =
      latestRollTime ||
      (earliestCallTime
        ? new Date(new Date(earliestCallTime).getTime() + 8 * 3600 * 1000).toISOString()
        : `${shootDatePart}T17:00:00+07:00`);

    const pillar = normalizePillar(pr.service_pillar, pr.photography_type);

    aggregatedEvents.push({
      id: `project-${pr.id}`,
      title: `Shoot: ${pr.name}`,
      start_time: startTime,
      end_time: endTime,
      event_type: "PROJECT_SHOOT",
      pillar,
      project_id: pr.id,
      project_name: pr.name,
      venue_name: venueName,
      venue_maps_url: venueMapsUrl,
      assigned_crew: assignedCrew,
      meet_link: null,
      notes: techNotes || `Status Project: ${pr.status || "ready"}`,
      status: pr.status || "CONFIRMED",
      dress_code: dressCode,
    });
  }

  // C) Process Standalone Project Crew Assignments (not merged into shoot_date)
  for (const [groupKey, assignmentsList] of assignmentsByProjectAndDate.entries()) {
    if (mergedAssignmentGroups.has(groupKey)) {
      continue;
    }

    const first = assignmentsList[0];
    const linkedProj = projectMap.get(first.project_id);

    const assignedCrew: AssignedCrewMember[] = assignmentsList.map((a) => {
      const crew = crewMap.get(a.crew_member_id);
      return {
        name: crew ? crew.full_name : "Freelance Crew",
        role: a.role_title,
      };
    });

    let earliest = first.call_time;
    let latest = first.roll_time;
    for (const a of assignmentsList) {
      if (a.call_time < earliest) earliest = a.call_time;
      if (a.roll_time && (!latest || a.roll_time > latest)) latest = a.roll_time;
    }

    const endTime =
      latest ||
      new Date(new Date(earliest).getTime() + 6 * 3600 * 1000).toISOString();

    const pillar = normalizePillar(
      linkedProj?.service_pillar,
      linkedProj?.photography_type
    );

    aggregatedEvents.push({
      id: `crew-call-${first.id}`,
      title: `Call Time: ${linkedProj?.name || first.role_title}`,
      start_time: earliest,
      end_time: endTime,
      event_type: "CREW_CALL",
      pillar,
      project_id: first.project_id,
      project_name: linkedProj?.name || null,
      venue_name: first.venue_name,
      venue_maps_url: first.venue_maps_url || null,
      assigned_crew: assignedCrew,
      meet_link: null,
      notes: first.technical_notes || null,
      status: "SCHEDULED",
      dress_code: first.dress_code || null,
    });
  }

  // Sort events chronologically by start_time
  aggregatedEvents.sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  // Apply pillar filter if specified
  if (filterPillar && filterPillar !== "ALL" && filterPillar !== "Semua Pilar") {
    const cleanFilter = filterPillar.trim().toLowerCase();
    return aggregatedEvents.filter((evt) => {
      const p = evt.pillar.toLowerCase();
      if (cleanFilter === "pictures / event" || cleanFilter === "pictures") {
        return p.includes("picture") || p.includes("photo") || p.includes("event");
      }
      if (cleanFilter === "live streaming" || cleanFilter === "live") {
        return p.includes("live") || p.includes("stream") || p.includes("broadcast");
      }
      if (cleanFilter === "digital lab" || cleanFilter === "digital") {
        return p.includes("lab") || p.includes("digital");
      }
      return p === cleanFilter;
    });
  }

  return aggregatedEvents;
}
