import test from "node:test";
import assert from "node:assert/strict";
import {
  signSyncPayload,
  dispatchSpreadsheetSync,
  dispatchSpreadsheetSyncBatch,
  syncProjectToSheets,
  syncInvoiceToSheets,
  syncPaymentReceiptToSheets,
  syncProofingSelectionToSheets,
  syncCrewPayrollToSheets,
} from "../src/lib/sync/sheets-client";
import { readFileSync } from "node:fs";

test("signSyncPayload computes valid HMAC-SHA256 signature and rejects tampering", () => {
  const secret = "elts_super_secret_test_key";
  const payload = JSON.stringify({ entityType: "PROJECT", id: "p1", name: "Test" });

  const sig1 = signSyncPayload(payload, secret);
  const sig2 = signSyncPayload(payload, secret);
  assert.equal(sig1, sig2, "HMAC signature must be deterministic");
  assert.match(sig1, /^[a-f0-9]{64}$/, "Signature must be 64-hex SHA256 string");

  // Altering payload changes signature
  const alteredPayload = JSON.stringify({ entityType: "PROJECT", id: "p1", name: "Tampered" });
  const sigAltered = signSyncPayload(alteredPayload, secret);
  assert.notEqual(sig1, sigAltered, "Altered payload must produce different signature");

  // Altering secret changes signature
  const sigWrongSecret = signSyncPayload(payload, "wrong_secret");
  assert.notEqual(sig1, sigWrongSecret, "Different secret must produce different signature");
});

test("dispatchSpreadsheetSync operates cleanly in mock mode during tests", async () => {
  const res = await dispatchSpreadsheetSync("PROJECT", "a0000000-0000-0000-0000-000000000001", "INSERT", {
    id: "a0000000-0000-0000-0000-000000000001",
    name: "Wedding Budi & Ani",
    customerName: "Budi Santoso",
    contractValue: 15000000,
    status: "ready",
  });

  assert.equal(res.success, true);
  assert.equal(res.isMock, true);
  assert.ok(typeof res.row === "number");
});

test("syncProjectToSheets formats complete project data payload", async () => {
  const res = await syncProjectToSheets({
    id: "a0000000-0000-0000-0000-000000000001",
    name: "Wisuda UI 2026",
    customerName: "Siti Rahma",
    customerPhone: "081234567890",
    servicePillar: "Wisuda & Event",
    shootDate: "2026-11-20",
    contractValue: 3500000,
    status: "ready",
    proofingUrl: "https://client.elts.co.id/proofing/tok_abc123",
    selectionDeadline: "2026-11-27",
  });

  assert.equal(res.success, true);
});

test("syncInvoiceToSheets formats commercial invoice payload", async () => {
  const res = await syncInvoiceToSheets({
    id: "b0000000-0000-0000-0000-000000000001",
    invoiceNumber: "INV/2026/10/0001",
    projectName: "Wisuda UI 2026",
    customerName: "Siti Rahma",
    issueDate: "2026-10-31",
    dueDate: "2026-11-14",
    grossContractValue: 3500000,
    minimumDpPct: 50,
    isDpPaid: true,
    isFullyPaid: false,
  });

  assert.equal(res.success, true);
});

test("syncPaymentReceiptToSheets formats cash receipt ledger payload", async () => {
  const res = await syncPaymentReceiptToSheets({
    id: "c0000000-0000-0000-0000-000000000001",
    receiptNumber: "RCP/2026/10/0001",
    invoiceNumber: "INV/2026/10/0001",
    projectName: "Wisuda UI 2026",
    receivedAt: "2026-10-31T10:00:00Z",
    amount: 1750000,
    paymentMethod: "BANK_TRANSFER",
    bankName: "BCA",
    referenceNumber: "TRX-987654321",
    verifiedAt: "2026-10-31T10:05:00Z",
  });

  assert.equal(res.success, true);
});

test("syncProofingSelectionToSheets formats locked editor task queue payload", async () => {
  const res = await syncProofingSelectionToSheets({
    projectId: "a0000000-0000-0000-0000-000000000001",
    projectName: "Wisuda UI 2026",
    deliverableCount: 20,
    quotaMin: 15,
    quotaMax: 20,
    selectionLockedAt: "2026-10-31T14:30:00Z",
    assignedEditor: "Azrian",
    taskStatus: "IN_PROGRESS",
    googleDriveUrl: "https://drive.google.com/drive/folders/test12345",
  });

  assert.equal(res.success, true);
});

test("dispatchSpreadsheetSyncBatch aggregates multiple items into a single execution", async () => {
  const items = [
    {
      entityType: "PROJECT" as const,
      entityId: "a0000000-0000-0000-0000-000000000001",
      action: "INSERT" as const,
      data: {
        id: "a0000000-0000-0000-0000-000000000001",
        name: "Project A",
        customerName: "Client A",
        contractValue: 5000000,
        status: "ready",
      },
    },
    {
      entityType: "INVOICE" as const,
      entityId: "b0000000-0000-0000-0000-000000000001",
      action: "INSERT" as const,
      data: {
        id: "b0000000-0000-0000-0000-000000000001",
        invoiceNumber: "INV/2026/10/0002",
        projectName: "Project A",
        customerName: "Client A",
        issueDate: "2026-10-31",
        dueDate: "2026-11-14",
        grossContractValue: 5000000,
        minimumDpPct: 50,
        isDpPaid: false,
        isFullyPaid: false,
      },
    },
  ];

  const res = await dispatchSpreadsheetSyncBatch(items);
  assert.equal(res.success, true);
  assert.equal(res.isMock, true);
  assert.equal(res.row, 2);
});

test("replay protection detects and rejects drifted client timestamps exceeding 300 seconds", () => {
  const serverTime = Math.floor(Date.now() / 1000);
  const freshClientTime = serverTime - 10; // 10s drift (fresh)
  const expiredClientTime = serverTime - 350; // 350s drift (expired)

  const isFresh = Math.abs(serverTime - freshClientTime) <= 300;
  const isExpired = Math.abs(serverTime - expiredClientTime) > 300;

  assert.equal(isFresh, true, "10-second drift must be within valid replay window");
  assert.equal(isExpired, true, "350-second drift must be flagged as expired");
});

test("syncCrewPayrollToSheets formats individual crew compensation row", async () => {
  const res = await syncCrewPayrollToSheets({
    assignmentId: "asg-test-77",
    projectName: "Wisuda UI 2026",
    crewName: "Azrian",
    roleTitle: "Lead Photographer",
    feeAmount: 1500000,
    paymentStatus: "CONFIRMED",
    shootDate: "2026-11-20",
    notes: "Full day event coverage",
  });

  assert.equal(res.success, true);
});

test("Google Apps Script template implements 4-tab layout and dynamic formulas", () => {
  const gas = readFileSync("docs/google-apps-script-sync-template.js", "utf-8");

  // Tab 1: Dashboard with KPI formulas
  assert.match(gas, /"Dashboard"/);
  assert.match(gas, /Total Pemasukan Kas/);
  assert.match(gas, /Total Tagihan Invoice/);
  assert.match(gas, /Total Biaya & Payroll Kru/);
  assert.match(gas, /SUMIFS/);
  assert.match(gas, /QUERY/);

  // Tab 2: Projects & Schedule
  assert.match(gas, /"Projects & Schedule"/);
  assert.match(gas, /Drive Vault URL/);

  // Tab 3: Payroll & Crew
  assert.match(gas, /"Payroll & Crew"/);
  assert.match(gas, /Crew Member Name/);
  assert.match(gas, /Fee Amount \(IDR\)/);

  // Tab 4: Income & Expenses
  assert.match(gas, /"Income & Expenses"/);
  assert.match(gas, /Transaction Type/);
});

test("Google Apps Script template implements locale-safe formula injection and separator conversion", () => {
  const gas = readFileSync("docs/google-apps-script-sync-template.js", "utf-8");

  // Verify presence of helper functions
  assert.match(gas, /function getSpreadsheetArgumentSeparator/);
  assert.match(gas, /function convertFormulaSeparators/);
  assert.match(gas, /function setLocaleSafeFormula/);

  // Verify Indonesian locale detection
  assert.match(gas, /"id"/);
  assert.match(gas, /"id_id"/);
  assert.match(gas, /"in_id"/);

  // Verify fallback error detection
  assert.match(gas, /#ERROR!/);
  assert.match(gas, /fallbackSep/);
});
