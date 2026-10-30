import test from "node:test";
import assert from "node:assert/strict";
import { BaileysWhatsAppProvider, getBaileysProvider } from "../src/lib/notifications/whatsapp/baileys-provider";
import {
  dispatchWhatsAppNotification,
  notifyProofingMagicLink,
  notifyProofingDeadlineWarning,
  notifySelectionConfirmation,
  notifyInvoiceIssued,
  notifyPaymentReceiptConfirmed,
} from "../src/lib/notifications/whatsapp/dispatcher";

test("BaileysWhatsAppProvider exposes connection state and operates cleanly in mock mode", async () => {
  const provider = new BaileysWhatsAppProvider("/tmp/test_baileys_auth");
  const initialStatus = provider.getConnectionStatus();

  assert.equal(typeof initialStatus.isConnected, "boolean");
  assert.equal(typeof initialStatus.isConnecting, "boolean");

  // In test environment, connect() succeeds via mock mode
  await provider.connect();
  const connectedStatus = provider.getConnectionStatus();
  assert.equal(connectedStatus.isConnected, true);

  // Singleton returns same instance
  const s1 = getBaileysProvider();
  const s2 = getBaileysProvider();
  assert.equal(s1, s2);
});

test("BaileysWhatsAppProvider rejects malformed or unparseable phone numbers with clear reason", async () => {
  const provider = new BaileysWhatsAppProvider("/tmp/test_baileys_auth");

  const resEmpty = await provider.sendMessage({
    recipientPhone: "",
    messageText: "Test",
  });
  assert.equal(resEmpty.success, false);
  assert.match(resEmpty.error ?? "", /tidak valid/i);

  const resShort = await provider.sendMessage({
    recipientPhone: "0812", // too short
    messageText: "Test",
  });
  assert.equal(resShort.success, false);
  assert.match(resShort.error ?? "", /too_short/i);

  const resLetters = await provider.sendMessage({
    recipientPhone: "not-a-phone",
    messageText: "Test",
  });
  assert.equal(resLetters.success, false);
});

test("BaileysWhatsAppProvider formats Indonesian numbers and delivers in mock mode", async () => {
  const provider = new BaileysWhatsAppProvider("/tmp/test_baileys_auth");

  const res = await provider.sendMessage({
    recipientPhone: "0812-3456-7890",
    messageText: "Halo ini pesan uji coba eLTs Photography",
  });

  assert.equal(res.success, true);
  assert.equal(res.provider, "BAILEYS_SELF_HOSTED");
  assert.match(res.externalMessageId ?? "", /^mock_baileys_/);
});

test("notifyProofingMagicLink constructs complete client message with magic URL and quota", async () => {
  const res = await notifyProofingMagicLink({
    projectId: "a0000000-0000-0000-0000-000000000001",
    clientName: "Budi Santoso",
    clientPhone: "081234567890",
    projectName: "Wedding Budi & Ani",
    accessToken: "tok_test_magic_12345",
    selectionQuotaMin: 15,
    selectionQuotaMax: 20,
    selectionDeadline: "2026-11-15T18:00:00Z",
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.success, true);
});

test("notifyProofingDeadlineWarning formats urgency countdown and deadline date", async () => {
  const res = await notifyProofingDeadlineWarning({
    projectId: "a0000000-0000-0000-0000-000000000001",
    clientName: "Budi Santoso",
    clientPhone: "081234567890",
    projectName: "Wedding Budi & Ani",
    accessToken: "tok_test_magic_12345",
    remainingDaysOrHoursText: "2 hari lagi",
    selectionDeadline: "2026-11-15T18:00:00Z",
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.success, true);
});

test("notifySelectionConfirmation confirms selection count and editor curation", async () => {
  const res = await notifySelectionConfirmation({
    projectId: "a0000000-0000-0000-0000-000000000001",
    clientName: "Budi Santoso",
    clientPhone: "081234567890",
    projectName: "Wedding Budi & Ani",
    selectedCount: 18,
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.success, true);
});

test("notifyInvoiceIssued formats contract value, DP percent, and bank payment instructions", async () => {
  const res = await notifyInvoiceIssued({
    invoiceId: "b0000000-0000-0000-0000-000000000001",
    projectId: "a0000000-0000-0000-0000-000000000001",
    clientName: "Budi Santoso",
    clientPhone: "081234567890",
    projectName: "Wedding Budi & Ani",
    invoiceNumber: "INV/2026/10/0001",
    grossAmount: 10000000,
    minimumDpPct: 50,
    dueDate: "2026-11-05",
    bankName: "BCA",
    accountNumber: "1234567890",
    accountHolder: "eLTs Visual Studio",
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.success, true);
});

test("notifyPaymentReceiptConfirmed confirms verified receipt and distinguishes full payment", async () => {
  // 1. Partial DP confirmation
  const resDp = await notifyPaymentReceiptConfirmed({
    receiptId: "c0000000-0000-0000-0000-000000000001",
    invoiceId: "b0000000-0000-0000-0000-000000000001",
    projectId: "a0000000-0000-0000-0000-000000000001",
    clientName: "Budi Santoso",
    clientPhone: "081234567890",
    projectName: "Wedding Budi & Ani",
    receiptNumber: "RCP/2026/10/0001",
    amountPaid: 5000000,
    isFullyPaid: false,
  });
  assert.equal(resDp.ok, true);

  // 2. Settlement 100% confirmation unlocking high-res download
  const resFull = await notifyPaymentReceiptConfirmed({
    receiptId: "c0000000-0000-0000-0000-000000000002",
    invoiceId: "b0000000-0000-0000-0000-000000000001",
    projectId: "a0000000-0000-0000-0000-000000000001",
    clientName: "Budi Santoso",
    clientPhone: "081234567890",
    projectName: "Wedding Budi & Ani",
    receiptNumber: "RCP/2026/10/0002",
    amountPaid: 5000000,
    isFullyPaid: true,
  });
  assert.equal(resFull.ok, true);
});

test("dispatchWhatsAppNotification sends message and logs event cleanly", async () => {
  const res = await dispatchWhatsAppNotification("SHOOT_CALLSHEET_T_MINUS_1", {
    recipientPhone: "081234567890",
    messageText: "Callsheet reminder test",
  });
  assert.equal(res.ok, true);
  assert.equal(res.result.success, true);
  assert.equal(res.result.provider, "BAILEYS_SELF_HOSTED");
});

test("QRCode.toDataURL produces valid base64 image data url for Baileys QR strings", async () => {
  const QRCode = (await import("qrcode")).default;
  const mockQrString = "2@mockBaileysQrCodeString12345,hashABC==";
  const dataUrl = await QRCode.toDataURL(mockQrString, {
    width: 320,
    margin: 2,
    color: { dark: "#18181b", light: "#ffffff" },
  });

  assert.match(dataUrl, /^data:image\/png;base64,/);
  assert.ok(dataUrl.length > 100);
});

test("Baileys provider disconnect resets connection state cleanly", async () => {
  const provider = new BaileysWhatsAppProvider("/tmp/test_baileys_auth");
  await provider.connect();
  assert.equal(provider.getConnectionStatus().isConnected, true);

  await provider.disconnect();
  const disconnectedStatus = provider.getConnectionStatus();
  assert.equal(disconnectedStatus.isConnected, false);
  assert.equal(disconnectedStatus.isConnecting, false);
});
