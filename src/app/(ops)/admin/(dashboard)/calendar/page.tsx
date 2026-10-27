import type { Metadata } from "next";
import { getCalendarEvents } from "@/app/actions/admin-calendar";
import type { CalendarEvent } from "@/types/calendar";
import { CalendarDashboardClient } from "@/components/admin/calendar/calendar-dashboard-client";

export const metadata: Metadata = {
  title: "Operations Calendar - Admin Dashboard",
  description:
    "Master Operations Calendar for shoots, broadcast live streams, client meetings, and crew call times.",
};

export const dynamic = "force-dynamic";

export default async function AdminCalendarPage() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(
    now.getMonth() + 1
  ).padStart(2, "0")}`;

  let initialEvents: CalendarEvent[] = [];
  try {
    initialEvents = await getCalendarEvents(currentMonth);
  } catch (err) {
    console.error("[AdminCalendarPage] Failed to fetch initial events:", err);
  }

  return (
    <CalendarDashboardClient
      initialEvents={initialEvents}
      initialMonth={currentMonth}
    />
  );
}
