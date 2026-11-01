/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * ==============================================================================
 * eLTs Studio OS - Master Operational Ledger & Executive Dashboard Webhook
 * ==============================================================================
 * Deploy this script as a Web App in Google Apps Script attached to your
 * Master Operational Google Sheet.
 *
 * Tab Architecture:
 * 1. 'Dashboard'           : Executive summary cards, monthly income/expense overviews,
 *                            total payroll obligations, and dynamic month/year filters.
 * 2. 'Projects & Schedule' : Master project database, shoot dates, client details,
 *                            service pillars, contract values, and Drive vault links.
 * 3. 'Payroll & Crew'      : Per-project crew fee/salary breakdown for team members
 *                            and freelancers, allowing individual lookup.
 * 4. 'Income & Expenses'   : Unified cash flow ledger tracking operational costs,
 *                            invoice settlements, and receipts.
 *
 * Setup Instructions:
 * 1. Open your Google Sheet -> Extensions -> Apps Script.
 * 2. Paste this complete script into Code.gs (replacing all previous content).
 * 3. In Script Properties (Project Settings), add:
 *    - SYNC_SECRET: Your strong random secret key (e.g., elts_sync_live_...)
 * 4. Deploy -> Manage Deployments -> Edit -> New Version -> Deploy.
 *    - Execute as: Me (your Google account)
 *    - Who has access: Anyone (authenticated via X-ELTS-SYNC-SECRET / HMAC)
 * 5. (Optional) Run 'setupOrUpgradeDashboard' from the Apps Script editor or use the
 *    '⚡ eLTs Studio OS' menu in Google Sheets to immediately repair all tabs.
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
    ensureDashboardInitialized(ss, false);

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
 * Standardizes all core operational tabs: auto-renames legacy aliases and ensures
 * all 3 data tabs exist so Dashboard formulas NEVER throw #REF! or #ERROR!.
 */
function standardizeAllSheets(ss) {
  var projectsSheet = getOrCreateSheet(ss, "Projects & Schedule", [
    "Sync Timestamp", "Project ID", "Project Name", "Customer Name", 
    "Customer Phone", "Service Pillar", "Shoot Date", "Status", 
    "Contract Value (IDR)", "Drive Vault URL", "Proofing Link", "Selection Deadline"
  ], "Projects Master");

  var incomeSheet = getOrCreateSheet(ss, "Income & Expenses", [
    "Sync Timestamp", "Transaction ID", "Transaction Type", "Reference Number", 
    "Project Name", "Customer / Entity", "Amount (IDR)", "Payment Method", 
    "Date", "Payment / Verification Status"
  ], "Invoices & Receivables");

  var payrollSheet = getOrCreateSheet(ss, "Payroll & Crew", [
    "Sync Timestamp", "Assignment ID", "Project Name", "Crew Member Name", 
    "Role Title", "Fee Amount (IDR)", "Payment Status", "Shoot Date", "Notes"
  ]);

  return {
    projectsSheetName: projectsSheet.getName(),
    incomeSheetName: incomeSheet.getName(),
    payrollSheetName: payrollSheet.getName()
  };
}

/**
 * Appends a row for a single operational entity into the structured operational tabs.
 */
function appendSingleEntityRow(ss, entityType, data, nowStr) {
  var targetSheet;
  var rowData = [];

  switch (entityType) {
    case "PROJECT":
      // Primary: 'Projects & Schedule' (auto-upgrades from 'Projects Master')
      targetSheet = getOrCreateSheet(ss, "Projects & Schedule", [
        "Sync Timestamp", "Project ID", "Project Name", "Customer Name", 
        "Customer Phone", "Service Pillar", "Shoot Date", "Status", 
        "Contract Value (IDR)", "Drive Vault URL", "Proofing Link", "Selection Deadline"
      ], "Projects Master");

      rowData = [
        nowStr,
        data.id || "",
        data.name || "",
        data.customerName || "",
        data.customerPhone || "",
        data.servicePillar || "",
        data.shootDate || "",
        data.status || "",
        data.contractValue || 0,
        data.googleDriveUrl || "",
        data.proofingUrl || "",
        data.selectionDeadline || ""
      ];
      break;

    case "INVOICE":
      // Primary: 'Income & Expenses' (auto-upgrades from 'Invoices & Receivables')
      targetSheet = getOrCreateSheet(ss, "Income & Expenses", [
        "Sync Timestamp", "Transaction ID", "Transaction Type", "Reference Number", 
        "Project Name", "Customer / Entity", "Amount (IDR)", "Payment Method", 
        "Date", "Payment / Verification Status"
      ], "Invoices & Receivables");

      rowData = [
        nowStr,
        data.id || "",
        "TAGIHAN / INVOICE",
        data.invoiceNumber || "",
        data.projectName || "",
        data.customerName || "",
        data.grossContractValue || 0,
        "-",
        data.issueDate || "",
        data.isFullyPaid ? "LUNAS 100%" : (data.isDpPaid ? "DP_TERBAYAR" : "BELUM_LUNAS")
      ];
      break;

    case "PAYMENT_RECEIPT":
      // If payload is marked as crew payroll, route to 'Payroll & Crew'
      if (data.isPayroll || data.crewName || data.roleTitle) {
        targetSheet = getOrCreateSheet(ss, "Payroll & Crew", [
          "Sync Timestamp", "Assignment ID", "Project Name", "Crew Member Name", 
          "Role Title", "Fee Amount (IDR)", "Payment Status", "Shoot Date", "Notes"
        ]);
        rowData = [
          nowStr,
          data.id || data.assignmentId || "",
          data.projectName || "",
          data.crewName || data.bankName || "",
          data.roleTitle || "Crew Member",
          data.amount || data.feeAmount || 0,
          data.paymentStatus || (data.verifiedAt ? "CONFIRMED" : "PENDING"),
          data.shootDate || (data.receivedAt ? data.receivedAt.slice(0, 10) : ""),
          data.notes || ""
        ];
        break;
      }

      // Standard Cash Inflow -> 'Income & Expenses' (fallback: 'Cash Receipts Ledger')
      targetSheet = getOrCreateSheet(ss, "Income & Expenses", [
        "Sync Timestamp", "Transaction ID", "Transaction Type", "Reference Number", 
        "Project Name", "Customer / Entity", "Amount (IDR)", "Payment Method", 
        "Date", "Payment / Verification Status"
      ], "Cash Receipts Ledger");

      rowData = [
        nowStr,
        data.id || "",
        "PEMASUKAN / KAS MASUK",
        data.receiptNumber || "",
        data.projectName || "",
        data.customerName || "Klien eLTs",
        data.amount || 0,
        data.paymentMethod || "TRANSFER_BANK",
        data.receivedAt ? data.receivedAt.slice(0, 10) : "",
        data.verifiedAt ? "VERIFIED" : "PENDING"
      ];
      break;

    case "PAYROLL":
    case "CREW":
    case "CREW_ASSIGNMENT":
      // Primary: 'Payroll & Crew'
      targetSheet = getOrCreateSheet(ss, "Payroll & Crew", [
        "Sync Timestamp", "Assignment ID", "Project Name", "Crew Member Name", 
        "Role Title", "Fee Amount (IDR)", "Payment Status", "Shoot Date", "Notes"
      ]);

      rowData = [
        nowStr,
        data.id || data.assignmentId || "",
        data.projectName || "",
        data.crewName || "",
        data.roleTitle || "",
        data.feeAmount || 0,
        data.paymentStatus || "PENDING",
        data.shootDate || "",
        data.notes || ""
      ];
      break;

    case "PROOFING_SELECTION":
      // Primary: 'Projects & Schedule' (fallback: 'Proofing & Editor Queue')
      targetSheet = getOrCreateSheet(ss, "Projects & Schedule", [
        "Sync Timestamp", "Project ID", "Project Name", "Customer Name", 
        "Customer Phone", "Service Pillar", "Shoot Date", "Status", 
        "Contract Value (IDR)", "Drive Vault URL", "Proofing Link", "Selection Deadline"
      ], "Proofing & Editor Queue");

      rowData = [
        nowStr,
        data.projectId || "",
        data.projectName || "",
        "Seleksi Foto Terkunci",
        "",
        "Dipilih: " + (data.deliverableCount || 0) + " foto (" + (data.quotaMin || 0) + "-" + (data.quotaMax || 0) + ")",
        data.selectionLockedAt ? data.selectionLockedAt.slice(0, 10) : "",
        data.taskStatus || "SELECTION_LOCKED",
        0,
        data.googleDriveUrl || "",
        "",
        ""
      ];
      break;

    default:
      throw new Error("Unknown entityType: " + entityType);
  }

  targetSheet.appendRow(rowData);

  // Format currency column (Amount / Contract Value) with IDR format
  var lastRow = targetSheet.getLastRow();
  if (entityType === "PROJECT") {
    targetSheet.getRange(lastRow, 9).setNumberFormat('"Rp"#,##0');
  } else if (entityType === "INVOICE" || entityType === "PAYMENT_RECEIPT") {
    targetSheet.getRange(lastRow, 7).setNumberFormat('"Rp"#,##0');
  } else if (entityType === "PAYROLL" || entityType === "CREW" || entityType === "CREW_ASSIGNMENT") {
    targetSheet.getRange(lastRow, 6).setNumberFormat('"Rp"#,##0');
  }

  return targetSheet;
}

/**
 * Ensures the Executive 'Dashboard' tab is initialized and auto-healed.
 * Dynamically binds formulas using the exact sheet names that actually exist.
 */
function ensureDashboardInitialized(ss, forceRefresh) {
  var sheetNames = standardizeAllSheets(ss);
  var sheet = ss.getSheetByName("Dashboard");
  var isNewSheet = false;

  if (!sheet) {
    sheet = ss.insertSheet("Dashboard", 0);
    sheet.setTabColor("#ff5a00");
    isNewSheet = true;
  }

  var pName = sheetNames.projectsSheetName;
  var iName = sheetNames.incomeSheetName;
  var payName = sheetNames.payrollSheetName;

  var b7 = sheet.getRange("B7");
  var currentVal = String(b7.getValue() || "");
  var needsFormulaRepair =
    isNewSheet ||
    forceRefresh ||
    currentVal.indexOf("#ERROR!") !== -1 ||
    currentVal.indexOf("#REF!") !== -1 ||
    !b7.getFormula();

  if (!needsFormulaRepair) return;

  // Title Banner
  sheet.getRange("B2:G2").merge();
  var titleCell = sheet.getRange("B2");
  titleCell.setValue("eLTs Visual Studio OS — Executive Operational Dashboard");
  titleCell.setFontSize(16);
  titleCell.setFontWeight("bold");
  titleCell.setFontColor("#18181b");

  // Filter Dropdowns
  sheet.getRange("B4").setValue("Filter Tahun:").setFontWeight("bold");
  sheet.getRange("C4").setValue("2026").setFontWeight("bold");
  sheet.getRange("D4").setValue("Filter Bulan:").setFontWeight("bold");
  sheet.getRange("E4").setValue("ALL").setFontWeight("bold");

  // KPI Summary Cards
  var kpiTitles = [
    ["Total Pemasukan Kas", "Total Tagihan Invoice", "Total Biaya & Payroll Kru", "Total Proyek Aktif"]
  ];
  sheet.getRange("B6:E6").setValues(kpiTitles);
  sheet.getRange("B6:E6").setFontWeight("bold").setBackground("#18181b").setFontColor("#ffffff");

  // Dynamic Robust Formulas (using verified exact sheet names)
  sheet.getRange("B7").setFormula(
    '=IFERROR(SUMIFS(\'' + iName + '\'!G:G, \'' + iName + '\'!C:C, "*PEMASUKAN*"), 0)'
  );
  sheet.getRange("C7").setFormula(
    '=IFERROR(SUMIFS(\'' + iName + '\'!G:G, \'' + iName + '\'!C:C, "*INVOICE*"), 0)'
  );
  sheet.getRange("D7").setFormula(
    '=IFERROR(SUM(\'' + payName + '\'!F:F), 0)'
  );
  sheet.getRange("E7").setFormula(
    '=IFERROR(COUNTA(\'' + pName + '\'!C2:C), 0)'
  );

  sheet.getRange("B7:D7").setNumberFormat('"Rp"#,##0').setFontSize(13).setFontWeight("bold");
  sheet.getRange("E7").setFontSize(13).setFontWeight("bold");

  // Dynamic Projects Table (QUERY Formula)
  sheet.getRange("B10").setValue("📋 15 Proyek Terkini (Dynamic Feed):").setFontWeight("bold").setFontSize(12);
  sheet.getRange("B11").setFormula(
    '=IFERROR(QUERY(\'' + pName + '\'!A:K, "SELECT C, D, E, F, G, H, I WHERE C IS NOT NULL LIMIT 15", 1), "Belum ada data proyek")'
  );

  // Dynamic Payroll Table (QUERY Formula)
  sheet.getRange("B29").setValue("👥 Ringkasan Payroll & Kru Terkini:").setFontWeight("bold").setFontSize(12);
  sheet.getRange("B30").setFormula(
    '=IFERROR(QUERY(\'' + payName + '\'!A:I, "SELECT C, D, E, F, G, H WHERE C IS NOT NULL LIMIT 15", 1), "Belum ada data kru")'
  );

  sheet.autoResizeColumns(2, 6);
}

/**
 * Helper to retrieve an existing sheet, auto-rename a legacy alias, or create with headers.
 */
function getOrCreateSheet(ss, sheetName, headers, legacyAlias) {
  var sheet = ss.getSheetByName(sheetName);

  // Auto-upgrade and rename legacy alias if present
  if (!sheet && legacyAlias) {
    var legacySheet = ss.getSheetByName(legacyAlias);
    if (legacySheet) {
      try {
        legacySheet.setName(sheetName);
        sheet = legacySheet;
      } catch (err) {
        // If rename blocked, reuse legacySheet
        sheet = legacySheet;
      }
    }
  }

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

/**
 * Google Sheets UI Menu Trigger: gives operators a 1-click button in the sheet
 * to instantly heal, upgrade tabs, and refresh formulas.
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("⚡ eLTs Studio OS")
      .addItem("🔄 Perbarui & Perbaiki Dashboard", "setupOrUpgradeDashboard")
      .addToUi();
  } catch (err) {
    // Ignore in non-interactive background triggers
  }
}

/**
 * Manual execution function: run directly from Google Apps Script editor.
 */
function setupOrUpgradeDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureDashboardInitialized(ss, true);
}

function doGet(_e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "healthy",
    service: "eLTs Studio OS Master Ledger Webhook",
    architecture: [
      "Dashboard",
      "Projects & Schedule",
      "Payroll & Crew",
      "Income & Expenses"
    ],
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}
