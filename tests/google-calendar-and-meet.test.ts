import test from "node:test";
import assert from "node:assert/strict";
import {
  scheduleProjectShootCalendarEvent,
  syncStudioEventToGoogleCalendar,
} from "../src/services/calendar/google";
import { notifyConsultationScheduled } from "../src/lib/notifications/whatsapp/dispatcher";

test("scheduleProjectShootCalendarEvent generates valid event with workspace link and metadata", async () => {
  const result = await scheduleProjectShootCalendarEvent({
    projectId: "a0000000-0000-0000-0000-000000000001",
    projectName: "Wedding Budi & Ani",
    customerName: "Budi Santoso",
    customerPhone: "081234567890",
    customerEmail: "budi@example.com",
    shootDate: "2026-11-20",
    callTime: "07:30",
    venueName: "Plataran Dharmawangsa",
    venueAddress: "Jl. Dharmawangsa Raya No. 6",
    venueMapsUrl: "https://maps.app.goo.gl/sample123",
    pillar: "Pictures / Event",
    notes: "Outdoor ceremony + ballroom reception",
  });

  assert.equal(result.success, true);
  assert.ok(result.eventId, "Event ID must be generated");
  assert.match(result.eventLink ?? "", /^https:\/\/calendar\.google\.com/);
});

test("syncStudioEventToGoogleCalendar generates valid Google Meet conference link", async () => {
  const result = await syncStudioEventToGoogleCalendar({
    id: "evt-test-12345",
    title: "Discovery Call - Siti Rahma",
    event_type: "DISCOVERY_CALL",
    client_name: "Siti Rahma",
    client_phone: "081234567890",
    client_email: "siti@example.com",
    service_interest: "Wisuda & Event",
    start_time: "2026-11-10T10:00:00+07:00",
    end_time: "2026-11-10T10:30:00+07:00",
  });

  assert.equal(result.success, true);
  assert.ok(result.eventId);
  assert.match(result.meetLink ?? "", /^https:\/\/meet\.google\.com\//);
});

test("notifyConsultationScheduled formats complete WhatsApp message with Google Meet link", async () => {
  const result = await notifyConsultationScheduled({
    clientName: "Siti Rahma",
    clientPhone: "081234567890",
    sessionType: "Discovery Call (15m)",
    dateStr: "10 November 2026",
    timeStr: "10:00",
    meetLink: "https://meet.google.com/elt-test-meet",
    notes: "Konsep visual wisuda outdoor",
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.success, true);
});
