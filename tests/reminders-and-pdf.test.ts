import test from "node:test";
import assert from "node:assert/strict";
import { buildWhatsAppLink, formatPhoneForDisplay, normalisePhone } from "../src/lib/whatsapp/phone";
import { composeReminder, formatDateId, formatRupiah, suggestedReminderKinds, type ReminderContext, type ReminderProject } from "../src/lib/reminders/compose";
import { signInvoicePdfToken, verifyInvoicePdfToken, PDF_LINK_TTL_MS } from "../src/lib/pdf/token";

// ─── Phone normalisation ─────────────────────────────────────────────────────

test("normalisePhone collapses the 08 / 62 / +62 families to one form", () => {
  const expected = "6281234567890";
  for (const input of [
    "081234567890",
    "6281234567890",
    "+6281234567890",
    "+62 812-3456-7890",
    "0812 3456 7890",
    "(0812) 3456 7890",
    "62081234567890", // stored country code re-imported as local
    "81234567890", // bare national without trunk zero
    "tel:+62-812-3456-7890",
  ]) {
    const result = normalisePhone(input);
    assert.equal(result.ok, true, `expected ${input} to parse`);
    assert.equal(result.ok && result.phone.e164, expected, `wrong output for ${input}`);
  }
});

test("normalisePhone rejects unusable input instead of guessing", () => {
  assert.equal(normalisePhone("").ok, false);
  assert.equal(normalisePhone("   ").ok, false);
  assert.equal(normalisePhone(null).ok, false);
  assert.equal(normalisePhone("abc").ok, false);
  assert.equal(normalisePhone("0812").ok, false); // too short
  assert.equal(normalisePhone("0".repeat(40)).ok, false); // too long
  const reason = normalisePhone("abc");
  assert.equal(reason.ok === false && reason.reason, "not_digits");
});

test("normalisePhone keeps foreign numbers without forcing 62", () => {
  const result = normalisePhone("+1 415 555 0100");
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.phone.e164, "14155550100");
  assert.equal(result.ok && result.phone.isIndonesian, false);
});

test("buildWhatsAppLink returns null rather than a broken url", () => {
  assert.equal(buildWhatsAppLink("abc"), null);
  assert.equal(buildWhatsAppLink(""), null);
  const link = buildWhatsAppLink("0812-3456-7890", "Halo & selamat");
  assert.equal(link, "https://wa.me/6281234567890?text=Halo%20%26%20selamat");
});

test("formatPhoneForDisplay groups national number and preserves junk", () => {
  assert.equal(formatPhoneForDisplay("081234567890"), "+62 8123-4567-890");
  assert.equal(formatPhoneForDisplay("bukan nomor"), "bukan nomor");
});

// ─── Reminder composition ────────────────────────────────────────────────────

const fullProject: ReminderProject = {
  name: "Pernikahan Andi & Sari",
  client_name: "Andi",
  client_phone: "0812-3456-7890",
  shoot_date: "2026-11-14",
  call_time: "07:30",
  venue_name: "Gedung Balai Kartini",
  venue_address: "Jl. Gatot Subroto No. 37, Jakarta",
  venue_maps_url: "https://maps.app.goo.gl/example",
  gallery_url: "https://studio.example/g/ELTS-ABCD1234",
  selection_deadline: "2026-11-28",
  crew_contacts: [
    { name: "Fajar", role: "Fotografer", phone: "08139 888 777" },
    { name: "Rina", role: "Asisten", phone: null },
  ],
};

const paymentMethods = [
  { bank_name: "BCA", account_number: "1234567890", account_holder: "Elts Studio", label: "Utama" },
];

function ctx(overrides: Partial<ReminderProject> = {}, extra: Partial<ReminderContext> = {}): ReminderContext {
  return {
    project: { ...fullProject, ...overrides },
    invoice: { invoice_number: "INV/2026/10/0001", amount_due: 2500000, due_date: "2026-10-25" },
    paymentMethods,
    studioName: "Elts. Photography",
    ...extra,
  };
}

test("T_MINUS_7_PREP composes a sendable message with a wa.me link", () => {
  const r = composeReminder("T_MINUS_7_PREP", ctx());
  assert.deepEqual(r.missing, []);
  assert.equal(r.targetPhone, "6281234567890");
  assert.match(r.message, /Andi/);
  assert.match(r.message, /14 November 2026/);
  assert.match(r.message, /Gedung Balai Kartini/);
  assert.match(r.message, /maps\.app\.goo\.gl/);
  assert.ok(r.waUrl?.startsWith("https://wa.me/6281234567890?text="));
});

test("T_MINUS_1_CALLSHEET contains time, address, map, and crew contacts", () => {
  const r = composeReminder("T_MINUS_1_CALLSHEET", ctx());
  assert.deepEqual(r.missing, []);
  assert.match(r.message, /07:30/);
  assert.match(r.message, /Gatot Subroto/);
  assert.match(r.message, /Fajar — Fotografer \(628139888777\)/);
  assert.match(r.message, /Rina — Asisten(?! \()/); // no phone -> no empty parens
});

test("fail-closed: a missing venue map suppresses the message and names the field", () => {
  const r = composeReminder("T_MINUS_7_PREP", ctx({ venue_maps_url: null }));
  assert.deepEqual(r.missing, ["venue_maps_url"]);
  assert.equal(r.message, "");
  assert.equal(r.waUrl, null);
});

test("fail-closed: accumulation of every missing field", () => {
  const r = composeReminder("T_MINUS_1_CALLSHEET", ctx({
    shoot_date: null, call_time: null, venue_name: null, venue_address: null, venue_maps_url: null,
  }));
  assert.deepEqual(r.missing.sort(), ["call_time", "shoot_date", "venue_address", "venue_maps_url", "venue_name"].sort());
  assert.equal(r.message, "");
});

test("fail-closed: unparseable client phone blocks dispatch", () => {
  const r = composeReminder("SHOOT_DAY_ONSITE", ctx({ client_phone: "n/a" }));
  assert.ok(r.missing.includes("client_phone"));
  assert.equal(r.targetPhone, null);
  assert.equal(r.waUrl, null);
  assert.equal(r.message, "");
});

test("payment reminders inject accounts from configuration, never literals", () => {
  const r = composeReminder("PAYMENT_FINAL", ctx({}, {
    paymentMethods: [{ bank_name: "Mandiri", account_number: "9876543210", account_holder: "Orang Lain", label: null }],
  }));
  assert.deepEqual(r.missing, []);
  assert.match(r.message, /Mandiri 9876543210/);
  assert.match(r.message, /a\/n Orang Lain/);
  assert.doesNotMatch(r.message, /BCA 1234567890/, "must not leak the previous account");
  assert.match(r.message, /Rp2\.500\.000/);
});

test("payment reminder with no configured account fails closed", () => {
  const r = composeReminder("PAYMENT_DP", ctx({}, { paymentMethods: [] }));
  assert.deepEqual(r.missing, ["payment_methods"]);
  assert.equal(r.message, "");
});

test("payment reminder without an invoice fails closed", () => {
  const r = composeReminder("PAYMENT_OVERDUE", ctx({}, { invoice: null }));
  assert.ok(r.missing.includes("invoice_number"));
  assert.ok(r.missing.includes("amount_due"));
  assert.equal(r.message, "");
});

test("GALLERY_READY and SELECTION_REMINDER require the gallery link", () => {
  assert.deepEqual(composeReminder("GALLERY_READY", ctx()).missing, []);
  assert.deepEqual(composeReminder("GALLERY_READY", ctx({ gallery_url: null })).missing, ["gallery_url"]);
  assert.deepEqual(composeReminder("SELECTION_REMINDER", ctx()).missing, []);
  const r = composeReminder("SELECTION_REMINDER", ctx());
  assert.match(r.message, /28 November 2026/);
});

test("composition is deterministic", () => {
  const a = composeReminder("T_MINUS_7_PREP", ctx());
  const b = composeReminder("T_MINUS_7_PREP", ctx());
  assert.equal(a.message, b.message);
  assert.equal(a.waUrl, b.waUrl);
});

test("no hardcoded PII or bank accounts in source", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/lib/reminders/compose.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /6280000000000/, "studio whatsapp literal must not be embedded");
  assert.doesNotMatch(src, /\b\d{10,}\b.*a\/n/, "bank account literals must not be embedded");
});

test("date and currency formatters are timezone-independent", () => {
  assert.equal(formatDateId("2026-01-01"), "1 Januari 2026");
  assert.equal(formatDateId("2026-12-31"), "31 Desember 2026");
  assert.equal(formatDateId(null), null);
  assert.equal(formatRupiah(2500000), "Rp2.500.000");
});

test("suggestedReminderKinds follows the shoot countdown", () => {
  const base = { shoot_date: "2026-11-14", gallery_url: null, selection_deadline: null };
  assert.deepEqual(suggestedReminderKinds(base, "2026-11-07"), ["T_MINUS_7_PREP"]);
  assert.deepEqual(suggestedReminderKinds(base, "2026-11-13"), ["T_MINUS_1_CALLSHEET"]);
  assert.deepEqual(suggestedReminderKinds(base, "2026-11-14"), ["SHOOT_DAY_ONSITE"]);
  assert.deepEqual(suggestedReminderKinds(base, "2026-11-15"), []);
  assert.deepEqual(
    suggestedReminderKinds({ ...base, gallery_url: "https://x", selection_deadline: "2026-11-28" }, "2026-11-20"),
    ["GALLERY_READY", "SELECTION_REMINDER"]
  );
});

// ─── PDF link tokens ─────────────────────────────────────────────────────────

const SECRET = "s".repeat(48);
const INVOICE = "b0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";

test("a signed token round-trips and binds to its invoice", () => {
  const token = signInvoicePdfToken(INVOICE, SECRET, 1_000_000);
  const claim = verifyInvoicePdfToken(token, SECRET, 1_000_001);
  assert.equal(claim?.invoiceId, INVOICE);
  assert.equal(claim?.exp, 1_000_000 + PDF_LINK_TTL_MS);
});

test("tokens expire on their own", () => {
  const token = signInvoicePdfToken(INVOICE, SECRET, 1_000_000);
  assert.ok(verifyInvoicePdfToken(token, SECRET, 1_000_000 + PDF_LINK_TTL_MS - 1));
  assert.equal(verifyInvoicePdfToken(token, SECRET, 1_000_000 + PDF_LINK_TTL_MS), null);
});

test("tokens are rejected when forged, tampered, or signed with another secret", () => {
  const token = signInvoicePdfToken(INVOICE, SECRET, 1_000_000);
  const [payload, signature] = token.split(".");

  // Repointed payload with the original signature.
  const otherPayload = Buffer.from(JSON.stringify({ v: 1, invoiceId: OTHER, exp: Number.MAX_SAFE_INTEGER })).toString("base64url");
  assert.equal(verifyInvoicePdfToken(`${otherPayload}.${signature}`, SECRET, 1_000_001), null);

  // Extended expiry with the original signature.
  const extended = Buffer.from(JSON.stringify({ v: 1, invoiceId: INVOICE, exp: Number.MAX_SAFE_INTEGER })).toString("base64url");
  assert.equal(verifyInvoicePdfToken(`${extended}.${signature}`, SECRET, 1_000_001), null);

  // Wrong secret.
  assert.equal(verifyInvoicePdfToken(token, "x".repeat(48), 1_000_001), null);

  // Malformed input.
  assert.equal(verifyInvoicePdfToken(null, SECRET), null);
  assert.equal(verifyInvoicePdfToken("", SECRET), null);
  assert.equal(verifyInvoicePdfToken("not-a-token", SECRET), null);
  assert.equal(verifyInvoicePdfToken(`${payload}.`, SECRET), null);
  assert.equal(verifyInvoicePdfToken(`${payload}.${signature}.extra`, SECRET), null);
});
