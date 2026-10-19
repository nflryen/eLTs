"use server";

import { createServiceSupabase } from "@/lib/supabase/service";
import { requireOps } from "@/lib/auth/roles";
import type {
  UpcomingAgendaItem,
  FinancialHealthSnapshot,
  ActionRequiredItem,
  ExecutiveCockpitData,
} from "@/types/cockpit";
/**
 * Normalizes disparate pillar and service tags into standard business pillars
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
    combined.includes("retouch") ||
    combined.includes("editing")
  ) {
    return "Digital Lab";
  }
  return "Pictures / Event";
}

/**
 * Formats a Date object to Indonesian localized weekday and date string
 * e.g., "Kamis, 24 Sep"
 */
function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Jakarta",
  });
}

/**
 * Formats time in Asia/Jakarta timezone e.g. "09:00 WIB"
 */
function formatTimeLabel(dateIso: string): string {
  try {
    const d = new Date(dateIso);
    return `${d.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jakarta",
    })} WIB`;
  } catch {
    return "Waktu Belum Diset";
  }
}

/**
 * Resolves executive cockpit data for the admin home dashboard:
 * 1. 5-Day Upcoming Agenda (studio_events, projects, project_crew_assignments)
 * 2. Financial Health Snapshot (cash_ledger, invoices, project_crew_assignments)
 * 3. Action-Required Queue (crew missing, curation ready, pending splits)
 * 4. Quick counts (active projects, active clients, pending invoices)
 */
export async function getExecutiveCockpitData(selectedSector?: string): Promise<ExecutiveCockpitData> {
  try {
    await requireOps();
  } catch {
    // If called outside authenticated session context, proceed with service client
  }

  const supabase = createServiceSupabase();

  const now = new Date();
  // Today 00:00:00 WIB
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayIso = todayStart.toISOString();
  const todayDateStr = now.toISOString().slice(0, 10);

  // 5 days window for upcoming agenda
  const in5Days = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const in5DaysIso = in5Days.toISOString();
  const in5DaysDateStr = in5Days.toISOString().slice(0, 10);

  // 7 days window for action queue crew check
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in7DaysDateStr = in7Days.toISOString().slice(0, 10);

  // 1. Fetch Crew Directory for lookup
  const crewMap = new Map<string, { full_name: string; crew_code: string }>();
  try {
    const { data: crewData } = await supabase
      .from("crew_members")
      .select("id, full_name, crew_code");
    if (crewData) {
      for (const c of crewData) {
        crewMap.set(c.id, { full_name: c.full_name, crew_code: c.crew_code });
      }
    }
  } catch (err) {
    console.warn("[AdminCockpit] Warning fetching crew_members:", err);
  }

  // 2. 5-Day Upcoming Agenda
  const upcomingAgenda: UpcomingAgendaItem[] = [];

  // A) Projects within 5 days
  type ProjectBasic = {
    id: string;
    name: string;
    shoot_date: string | null;
    service_pillar?: string;
    photography_type?: string;
    status: string;
  };
  const projectsInWindow: ProjectBasic[] = [];

  try {
    const { data: projectsData } = await supabase
      .from("projects")
      .select("id, name, shoot_date, service_pillar, photography_type, status")
      .gte("shoot_date", todayDateStr)
      .lte("shoot_date", in5DaysDateStr)
      .neq("status", "archived")
      .neq("status", "expired")
      .order("shoot_date", { ascending: true });

    if (projectsData) {
      projectsInWindow.push(...(projectsData as ProjectBasic[]));
    }
  } catch (err) {
    console.warn("[AdminCockpit] Warning fetching projects in window:", err);
  }

  // Fetch crew assignments for these projects or in 5 days window
  type RawAssignment = {
    id: string;
    project_id: string;
    crew_member_id: string;
    role_title: string;
    call_time: string;
    venue_name: string;
    venue_address: string;
  };

  const assignmentsByProject = new Map<string, RawAssignment[]>();
  try {
    const projectIds = projectsInWindow.map((p) => p.id);
    let query = supabase
      .from("project_crew_assignments")
      .select("id, project_id, crew_member_id, role_title, call_time, venue_name, venue_address");

    if (projectIds.length > 0) {
      query = query.in("project_id", projectIds);
    } else {
      query = query.gte("call_time", todayIso).lte("call_time", in5DaysIso);
    }

    const { data: assignmentsData } = await query;
    if (assignmentsData) {
      for (const a of assignmentsData as RawAssignment[]) {
        const list = assignmentsByProject.get(a.project_id) || [];
        list.push(a);
        assignmentsByProject.set(a.project_id, list);
      }
    }
  } catch (err) {
    console.warn("[AdminCockpit] Warning fetching project_crew_assignments:", err);
  }

  // Process projects into agenda items
  for (const p of projectsInWindow) {
    if (!p.shoot_date) continue;
    const assignments = assignmentsByProject.get(p.id) || [];
    const crewCount = assignments.length;

    // Pick field lead: preferential search for lead/director/pic/utama role
    let fieldLead = "Belum Ditugaskan";
    if (assignments.length > 0) {
      const leadAssignment =
        assignments.find((a) => {
          const r = a.role_title.toLowerCase();
          return (
            r.includes("lead") ||
            r.includes("director") ||
            r.includes("pic") ||
            r.includes("ketua") ||
            r.includes("utama") ||
            r.includes("project leader")
          );
        }) || assignments[0];

      const crewMember = crewMap.get(leadAssignment.crew_member_id);
      fieldLead = crewMember ? crewMember.full_name : "Kru Ditugaskan";
    }

    // Determine venue
    const firstVenue = assignments.find((a) => a.venue_name)?.venue_name;
    const location = firstVenue || "Lokasi Pemotretan / On-Location";

    const shootDateObj = new Date(p.shoot_date);
    const dateFormatted = formatDateLabel(shootDateObj);
    const timeFormatted = assignments[0]?.call_time
      ? formatTimeLabel(assignments[0].call_time)
      : "Jadwal Pemotretan";

    upcomingAgenda.push({
      id: `project-${p.id}`,
      date: dateFormatted,
      time: timeFormatted,
      title: p.name,
      pillar: normalizePillar(p.service_pillar, p.photography_type),
      location,
      fieldLead,
      crewCount,
      project_id: p.id,
      status: p.status,
      rawDate: p.shoot_date,
    });
  }

  // B) Studio Events in 5 days
  try {
    const { data: studioEvents } = await supabase
      .from("studio_events")
      .select("id, title, event_type, start_time, end_time, service_interest, project_id, assigned_crew_ids, meet_link, status")
      .gte("end_time", todayIso)
      .lte("start_time", in5DaysIso)
      .neq("status", "CANCELLED")
      .order("start_time", { ascending: true });

    if (studioEvents) {
      for (const se of studioEvents) {
        // Skip if already represented by project shoot_date
        const isProjectShoot = se.project_id && projectsInWindow.some((p) => p.id === se.project_id);
        if (isProjectShoot && se.event_type === "FIELD_SHOOT") {
          continue;
        }

        const crewIds = (se.assigned_crew_ids as string[] | null) || [];
        const crewCount = crewIds.length;
        let fieldLead = "-";
        if (crewIds.length > 0) {
          const leadMember = crewMap.get(crewIds[0]);
          fieldLead = leadMember ? leadMember.full_name : "PIC Event";
        }

        const location = se.meet_link ? "Google Meet (Online)" : "Studio / Meeting Room";
        const startDateObj = new Date(se.start_time);

        upcomingAgenda.push({
          id: `studio-${se.id}`,
          date: formatDateLabel(startDateObj),
          time: formatTimeLabel(se.start_time),
          title: se.title,
          pillar: normalizePillar(null, null, se.service_interest, se.event_type),
          location,
          fieldLead,
          crewCount,
          project_id: se.project_id,
          status: se.status,
          rawDate: se.start_time,
        });
      }
    }
  } catch (err) {
    console.warn("[AdminCockpit] Warning fetching studio_events in window:", err);
  }

  // Sort upcoming agenda chronologically
  upcomingAgenda.sort((a, b) => new Date(a.rawDate).getTime() - new Date(b.rawDate).getTime());

  // 3. Financial Health Snapshot
  let cashReserveBalance = 0;
  try {
    const { data: ledgerEntries } = await supabase
      .from("cash_ledger")
      .select("type, amount");

    if (ledgerEntries) {
      for (const entry of ledgerEntries) {
        const amt = Number(entry.amount) || 0;
        if (entry.type === "INFLOW" || entry.type === "FOUNDER_ADVANCE") {
          cashReserveBalance += amt;
        } else if (entry.type === "OUTFLOW") {
          cashReserveBalance -= amt;
        }
      }
    }
  } catch (err) {
    console.warn("[AdminCockpit] Warning calculating cash reserve balance:", err);
  }

  let pendingReceivables = 0;
  let pendingInvoicesCount = 0;
  try {
    const { data: pendingInvoices } = await supabase
      .from("invoices")
      .select("id, amount, status")
      .eq("status", "PENDING");

    if (pendingInvoices) {
      pendingInvoicesCount = pendingInvoices.length;
      pendingReceivables = pendingInvoices.reduce(
        (sum, inv) => sum + (Number(inv.amount) || 0),
        0
      );
    }
  } catch (err) {
    console.warn("[AdminCockpit] Warning querying pending invoices:", err);
  }

  let unpaidCrewFees = 0;
  try {
    const { data: unpaidAssignments } = await supabase
      .from("project_crew_assignments")
      .select("id, fee_agreed, payment_status")
      .eq("payment_status", "UNPAID");

    if (unpaidAssignments) {
      unpaidCrewFees = unpaidAssignments.reduce(
        (sum, a) => sum + (Number(a.fee_agreed) || 0),
        0
      );
    }
  } catch (err) {
    console.warn("[AdminCockpit] Warning querying unpaid crew fees:", err);
  }

  // 4. Action-Required Queue
  const actionQueue: ActionRequiredItem[] = [];

  // A) Projects with shoot_date in < 7 days but 0 crew assigned ("KRU BELUM LENGKAP")
  try {
    const { data: shootSoonProjects } = await supabase
      .from("projects")
      .select("id, name, shoot_date, status")
      .gte("shoot_date", todayDateStr)
      .lte("shoot_date", in7DaysDateStr)
      .neq("status", "archived")
      .neq("status", "expired");

    if (shootSoonProjects && shootSoonProjects.length > 0) {
      const soonProjectIds = shootSoonProjects.map((p) => p.id);
      const { data: existingAssignments } = await supabase
        .from("project_crew_assignments")
        .select("id, project_id")
        .in("project_id", soonProjectIds);

      const assignedProjSet = new Set((existingAssignments || []).map((a) => a.project_id));

      for (const p of shootSoonProjects) {
        if (!assignedProjSet.has(p.id) && p.shoot_date) {
          const shootDate = new Date(p.shoot_date);
          const diffDays = Math.max(
            0,
            Math.ceil((shootDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          );
          const timeText = diffDays === 0 ? "Hari ini" : diffDays === 1 ? "Besok" : `${diffDays} hari lagi`;

          actionQueue.push({
            id: `crew-missing-${p.id}`,
            type: "KRU BELUM LENGKAP",
            title: p.name,
            description: `Pemotretan ${timeText} (${formatDateLabel(shootDate)}) belum memiliki penugasan kru!`,
            href: `/admin/projects/${p.id}`,
            severity: "urgent",
            badgeText: "KRU BELUM LENGKAP",
          });
        }
      }
    }
  } catch (err) {
    console.warn("[AdminCockpit] Warning checking crew missing action queue:", err);
  }

  // A.2) Projects with shoot_date within 48h having crew in DECLINED or PENDING_OFFER state ("KRU BELUM LENGKAP")
  try {
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const in48hDateStr = in48h.toISOString().slice(0, 10);

    const { data: nearTermProjects } = await supabase
      .from("projects")
      .select("id, name, shoot_date, status")
      .gte("shoot_date", todayDateStr)
      .lte("shoot_date", in48hDateStr)
      .neq("status", "archived")
      .neq("status", "expired");

    if (nearTermProjects && nearTermProjects.length > 0) {
      const nearIds = nearTermProjects.map((p) => p.id);
      const { data: nearAssignments } = await supabase
        .from("project_crew_assignments")
        .select("id, project_id, role_title, acceptance_status, declined_reason")
        .in("project_id", nearIds)
        .in("acceptance_status", ["PENDING_OFFER", "DECLINED"]);

      if (nearAssignments && nearAssignments.length > 0) {
        const unconfirmedByProject = new Map<string, typeof nearAssignments>();
        for (const a of nearAssignments) {
          const list = unconfirmedByProject.get(a.project_id) || [];
          list.push(a);
          unconfirmedByProject.set(a.project_id, list);
        }

        for (const p of nearTermProjects) {
          const unconfirmedList = unconfirmedByProject.get(p.id);
          if (unconfirmedList && unconfirmedList.length > 0) {
            const pendingCount = unconfirmedList.filter((a) => a.acceptance_status === "PENDING_OFFER").length;
            const declinedCount = unconfirmedList.filter((a) => a.acceptance_status === "DECLINED").length;

            const statusDetail =
              pendingCount > 0 && declinedCount > 0
                ? `${pendingCount} pending / ${declinedCount} ditolak`
                : pendingCount > 0
                ? `${pendingCount} pending konfirmasi kru`
                : `${declinedCount} ditolak kru`;

            const shootDate = p.shoot_date ? new Date(p.shoot_date) : null;
            const dateText = shootDate ? formatDateLabel(shootDate) : "dalam 48 jam";

            actionQueue.push({
              id: `crew-unconfirmed-${p.id}`,
              type: "KRU BELUM LENGKAP",
              title: "Penugasan Kru Perlu Konfirmasi",
              description: `${p.name} (${dateText}): ${statusDetail} - segera tindak lanjuti alokasi kru.`,
              href: `/admin/projects/${p.id}`,
              severity: "urgent",
              badgeText: "KRU BELUM LENGKAP",
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn("[AdminCockpit] Warning checking unconfirmed crew action queue:", err);
  }

  // B) Projects with status 'ready' and 15-20 photos selected ("KURASI MASUK")
  try {
    const { data: readyProjects } = await supabase
      .from("projects")
      .select("id, name, status, selection_quota_min, selection_quota_max")
      .eq("status", "ready");

    if (readyProjects && readyProjects.length > 0) {
      const readyIds = readyProjects.map((p) => p.id);
      const { data: favData } = await supabase
        .from("favorites")
        .select("project_id, media_id")
        .in("project_id", readyIds);

      const favCountMap = new Map<string, number>();
      if (favData) {
        for (const f of favData) {
          favCountMap.set(f.project_id, (favCountMap.get(f.project_id) || 0) + 1);
        }
      }

      for (const p of readyProjects) {
        const count = favCountMap.get(p.id) || 0;
        if (count >= 15) {
          actionQueue.push({
            id: `curation-ready-${p.id}`,
            type: "KURASI MASUK",
            title: p.name,
            description: `${count} foto kurasi klien siap diproses editor / diekspor.`,
            href: `/admin/editor-queue`,
            severity: "warning",
            badgeText: "KURASI MASUK",
          });
        }
      }
    }
  } catch (err) {
    console.warn("[AdminCockpit] Warning checking curation ready action queue:", err);
  }

  // C) Money splits with status 'PENDING_APPROVAL' ("APPROVAL PENDING")
  try {
    const { data: pendingSplits } = await supabase
      .from("money_splits")
      .select("id, project_id, gross_revenue, approved_by_a, approved_by_b, status")
      .eq("status", "PENDING_APPROVAL");

    if (pendingSplits && pendingSplits.length > 0) {
      const splitProjectIds = pendingSplits.map((s) => s.project_id);
      const { data: splitProjects } = await supabase
        .from("projects")
        .select("id, name")
        .in("id", splitProjectIds);

      const projectNameMap = new Map((splitProjects || []).map((p) => [p.id, p.name]));

      for (const s of pendingSplits) {
        const pName = projectNameMap.get(s.project_id) || `Proyek #${s.project_id.slice(0, 8)}`;
        const waitingFor =
          !s.approved_by_a && !s.approved_by_b
            ? "Founder A & B"
            : !s.approved_by_a
            ? "Founder A"
            : "Founder B";

        actionQueue.push({
          id: `split-approval-${s.id}`,
          type: "APPROVAL PENDING",
          title: pName,
          description: `Bagi hasil omzet Rp ${Number(s.gross_revenue).toLocaleString("id-ID")} menunggu approval ${waitingFor}.`,
          href: `/admin/finance`,
          severity: "info",
          badgeText: "APPROVAL PENDING",
        });
      }
    }
  } catch (err) {
    console.warn("[AdminCockpit] Warning checking pending splits action queue:", err);
  }

  // 5. Quick counts
  let activeProjectsCount = 0;
  let activeClientsCount = 0;

  try {
    const [projCountRes, custCountRes] = await Promise.all([
      supabase
        .from("projects")
        .select("*", { count: "exact", head: true })
        .in("status", ["draft", "editing", "ready"]),
      supabase
        .from("customers")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null),
    ]);

    activeProjectsCount = projCountRes.count ?? 0;
    activeClientsCount = custCountRes.count ?? 0;
  } catch (err) {
    console.warn("[AdminCockpit] Warning querying quick counts:", err);
  }
  // Filter agenda by sector if requested
  const filteredAgenda = selectedSector && selectedSector !== "ALL"
    ? upcomingAgenda.filter((item) => {
        const p = item.pillar.toLowerCase();
        if (selectedSector === "BROADCAST") return p.includes("broadcast") || p.includes("stream") || p.includes("foh");
        if (selectedSector === "VIDEO") return p.includes("video") || p.includes("aftermovie");
        if (selectedSector === "PHOTO") return p.includes("photo") || p.includes("grad") || p.includes("event");
        return true;
      })
    : upcomingAgenda;

  return {
    upcomingAgenda: filteredAgenda,
    financialHealth: {
      cashReserveBalance,
      pendingReceivables,
      unpaidCrewFees,
      activeProjectsCount,
    },
    actionQueue,
    quickCounts: {
      activeProjects: activeProjectsCount,
      activeClients: activeClientsCount,
      pendingInvoices: pendingInvoicesCount,
    },
  };
}
