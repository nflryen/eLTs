/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * ==============================================================================
 * eLTs Studio OS - Master Operational Ledger Synchronization Webhook
 * ==============================================================================
 * Deploy this script as a Web App in Google Apps Script attached to your
 * Master Operational Google Sheet.
 *
 * Setup Instructions:
 * 1. Open your Google Sheet -> Extensions -> Apps Script.
 * 2. Paste this complete script into Code.gs.
 * 3. In Script Properties (Project Settings), add:
 *    - SYNC_SECRET: Your strong random secret key (e.g., elts_sync_live_...)
 * 4. Deploy -> New Deployment -> Select type: Web App.
 *    - Execute as: Me (your Google account)
 *    - Who has access: Anyone (authenticated via X-ELTS-SYNC-SECRET / HMAC)
 * 5. Copy the Web App URL into your .env.local:
 *    GOOGLE_SHEETS_WEBHOOK_URL="https://script.google.com/macros/s/.../exec"
 *    GOOGLE_SHEETS_SYNC_SECRET="elts_sync_live_..."
 * ==============================================================================
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Acquire lock for up to 10 seconds to guarantee atomic row appending
    lock.waitLock(10000);

    var rawContent = e.postData.contents;
    var payload = JSON.parse(rawContent);

    // 1. Authenticate Request & Replay Protection
    var properties = PropertiesService.getScriptProperties();
    var expectedSecret = properties.getProperty("SYNC_SECRET");

    // Replay Window Check (300 seconds = 5 minutes)
    var timestampHeader = e.headers ? (e.headers["X-ELTS-TIMESTAMP"] || e.headers["x-elts-timestamp"]) : null;
    if (timestampHeader) {
      var clientTime = parseInt(timestampHeader, 10);
      var serverTime = Math.floor(new Date().getTime() / 1000);
      if (Math.abs(serverTime - clientTime) > 300) {
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          error: "Request expired: timestamp drift exceeds 300 seconds (replay protection)"
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // Check authorization in headers or query parameters
    var authHeader = e.headers ? (e.headers["X-ELTS-SYNC-SECRET"] || e.headers["x-elts-sync-secret"]) : null;
    var authParam = e.parameter ? e.parameter.secret : null;
    var providedSecret = authHeader || authParam || payload.secret;

    if (expectedSecret && providedSecret !== expectedSecret) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "Unauthorized: Invalid or missing sync secret"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // HMAC-SHA256 Signature Verification (if header supplied)
    var sigHeader = e.headers ? (e.headers["X-ELTS-SYNC-SIGNATURE"] || e.headers["x-elts-sync-signature"]) : null;
    if (expectedSecret && sigHeader) {
      var signatureBytes = Utilities.computeHmacSha256Signature(rawContent, expectedSecret);
      var computedSignature = signatureBytes.reduce(function(str, byte) {
        return str + ("0" + (byte & 0xFF).toString(16)).slice(-2);
      }, "");
      if (computedSignature !== sigHeader.toLowerCase()) {
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          error: "Unauthorized: Invalid HMAC-SHA256 signature"
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var entityType = payload.entityType;
    var data = payload.data;
    var nowStr = Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd HH:mm:ss");

    // 2. Handle Batch Aggregation vs Single Entity
    if (entityType === "BATCH") {
      var items = Array.isArray(data) ? data : (payload.items || []);
      var batchCount = 0;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        appendSingleEntityRow(ss, it.entityType, it.data, nowStr);
        batchCount++;
      }
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        entityType: "BATCH",
        count: batchCount,
        timestamp: nowStr
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Single Entity Dispatch
    var targetSheet = appendSingleEntityRow(ss, entityType, data, nowStr);

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      entityType: entityType,
      sheet: targetSheet.getName(),
      row: targetSheet.getLastRow(),
      timestamp: nowStr
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Appends a row for a single operational entity into the appropriate sheet tab.
 */
function appendSingleEntityRow(ss, entityType, data, nowStr) {
  var targetSheet;
  var rowData = [];

  switch (entityType) {
    case "PROJECT":
      targetSheet = getOrCreateSheet(ss, "Projects Master", [
        "Sync Timestamp", "Project ID", "Project Name", "Customer Name", 
        "Customer Phone", "Service Pillar", "Shoot Date", "Contract IDR", 
        "Status", "Proofing Link", "Selection Deadline"
      ]);
      rowData = [
        nowStr,
        data.id || "",
        data.name || "",
        data.customerName || "",
        data.customerPhone || "",
        data.servicePillar || "",
        data.shootDate || "",
        data.contractValue || 0,
        data.status || "",
        data.proofingUrl || "",
        data.selectionDeadline || ""
      ];
      break;

    case "INVOICE":
      targetSheet = getOrCreateSheet(ss, "Invoices & Receivables", [
        "Sync Timestamp", "Invoice ID", "Invoice Number", "Project Name", 
        "Customer Name", "Issue Date", "Due Date", "Gross Contract IDR", 
        "Minimum DP %", "Is DP Paid", "Is Fully Paid"
      ]);
      rowData = [
        nowStr,
        data.id || "",
        data.invoiceNumber || "",
        data.projectName || "",
        data.customerName || "",
        data.issueDate || "",
        data.dueDate || "",
        data.grossContractValue || 0,
        data.minimumDpPct || 30,
        data.isDpPaid ? "YES" : "NO",
        data.isFullyPaid ? "YES" : "NO"
      ];
      break;

    case "PAYMENT_RECEIPT":
      targetSheet = getOrCreateSheet(ss, "Cash Receipts Ledger", [
        "Sync Timestamp", "Receipt ID", "Receipt Number", "Invoice Number", 
        "Project Name", "Received At", "Amount IDR", "Payment Method", 
        "Bank Name", "Reference Number", "Verified Status"
      ]);
      rowData = [
        nowStr,
        data.id || "",
        data.receiptNumber || "",
        data.invoiceNumber || "",
        data.projectName || "",
        data.receivedAt || "",
        data.amount || 0,
        data.paymentMethod || "",
        data.bankName || "",
        data.referenceNumber || "",
        data.verifiedAt ? "VERIFIED" : "PENDING"
      ];
      break;

    case "PROOFING_SELECTION":
      targetSheet = getOrCreateSheet(ss, "Proofing & Editor Queue", [
        "Sync Timestamp", "Project ID", "Project Name", "Selected Photos Count", 
        "Quota Min-Max", "Locked At", "Assigned Editor", "Editor Task Status", 
        "Google Drive Delivery URL"
      ]);
      rowData = [
        nowStr,
        data.projectId || "",
        data.projectName || "",
        data.deliverableCount || 0,
        (data.quotaMin || 0) + " - " + (data.quotaMax || 0),
        data.selectionLockedAt || nowStr,
        data.assignedEditor || "Unassigned",
        data.taskStatus || "PENDING",
        data.googleDriveUrl || ""
      ];
      break;

    default:
      throw new Error("Unknown entityType: " + entityType);
  }

  targetSheet.appendRow(rowData);
  return targetSheet;
}

/**
 * Helper to retrieve an existing sheet or create it with headers if missing.
 */
function getOrCreateSheet(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#18181b");
    headerRange.setFontColor("#ffffff");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doGet(_e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "healthy",
    service: "eLTs Studio OS Master Ledger Webhook",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}
