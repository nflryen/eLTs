import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { formatRupiah, formatDateId } from "@/lib/reminders/compose";
import type { PayslipData } from "./load-payslip";

/**
 * Payslip PDF as a real vector document.
 *
 * Same reasoning as the invoice renderer: a payslip gets printed, emailed and
 * forwarded to an accountant, so the text must stay selectable. Built with
 * pdf-lib, not a headless browser.
 *
 * The QR encodes the PUBLIC verification URL (not the amount), so scanning it
 * reveals nothing to a passer-by beyond a link that resolves server-side.
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.094, 0.094, 0.106);
const MUTED = rgb(0.443, 0.443, 0.482);
const HAIRLINE = rgb(0.8, 0.8, 0.83);
const SOFT = rgb(0.925, 0.925, 0.933);
const CANVAS = rgb(0.957, 0.957, 0.965);
const GREEN = rgb(0.024, 0.373, 0.275);

/**
 * WinAnsi cannot encode characters like "·" or em-dashes. Replacing them keeps
 * pdf-lib from throwing mid-render, which would 500 the download.
 */
function safe(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00b7/g, "-")
    .replace(/[^\x00-\xFF]/g, "?");
}

function dateLine(iso: string): string {
  try {
    return formatDateId(iso) ?? iso.slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

export async function renderPayslipPdf(
  data: PayslipData,
  verificationUrl: string,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Slip Gaji ${data.slipNumber}`);
  doc.setAuthor("Elts. Photography");
  doc.setSubject("Bukti Pembayaran Kompensasi");

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const mono = await doc.embedFont(StandardFonts.Courier);

  let y = PAGE_HEIGHT - MARGIN;

  const text = (
    value: string,
    opts: { x?: number; size?: number; font?: PDFFont; color?: typeof INK; align?: "left" | "right" } = {},
  ) => {
    const { x = MARGIN, size = 9, font = regular, color = INK, align = "left" } = opts;
    const s = safe(value);
    const px = align === "right" ? PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(s, size) : x;
    page.drawText(s, { x: px, y, size, font, color });
  };

  const rule = (gap = 10, color = HAIRLINE) => {
    y -= gap;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.6,
      color,
    });
  };

  // ── Header ──────────────────────────────────────────────────────────────
  text("ELTS.", { size: 20, font: bold });
  text("PHOTOGRAPHY", { x: MARGIN + 52, size: 8, font: regular, color: MUTED });
  y -= 22;
  text("BUKTI PEMBAYARAN KOMPENSASI", { size: 11, font: bold, color: MUTED });
  y -= 26;

  // ── Slip meta box ───────────────────────────────────────────────────────
  const boxTop = y + 8;
  page.drawRectangle({
    x: MARGIN,
    y: boxTop - 58,
    width: CONTENT_WIDTH,
    height: 58,
    color: CANVAS,
  });

  y = boxTop - 16;
  text("NOMOR SLIP", { size: 7, color: MUTED });
  text(data.slipNumber, { x: MARGIN + 95, size: 10, font: mono });

  y = boxTop - 32;
  text("PERIODE", { size: 7, color: MUTED });
  text(data.periodKey || "-", { x: MARGIN + 95, size: 9, font: regular });

  y = boxTop - 48;
  text("DITERBITKAN", { size: 7, color: MUTED });
  text(dateLine(data.issuedAt), { x: MARGIN + 95, size: 9, font: regular });

  // status badge, right aligned inside the box
  const badge = data.status === "DISBURSED" || data.status === "CLOSED" ? "LUNAS / PAID" : data.status;
  const badgeW = bold.widthOfTextAtSize(badge, 8) + 14;
  page.drawRectangle({
    x: PAGE_WIDTH - MARGIN - badgeW - 12,
    y: boxTop - 26,
    width: badgeW,
    height: 16,
    color: GREEN,
  });
  page.drawText(safe(badge), {
    x: PAGE_WIDTH - MARGIN - badgeW - 12 + 7,
    y: boxTop - 21,
    size: 8,
    font: bold,
    color: rgb(1, 1, 1),
  });

  y = boxTop - 74;

  // ── Recipient ───────────────────────────────────────────────────────────
  text("PENERIMA", { size: 7, font: bold, color: MUTED });
  y -= 14;
  text(data.payeeName, { size: 12, font: bold });
  y -= 13;
  const codeLine = [data.payeeCode, data.payeeType === "FREELANCE" ? "Kru Lepas" : "Staff Internal"]
    .filter(Boolean)
    .join("  -  ");
  text(codeLine, { size: 8, color: MUTED });
  if (data.bank) {
    y -= 12;
    text(`Rekening tujuan: ${data.bank.name} ${data.bank.accountNumber} a/n ${data.bank.holder}`, {
      size: 8,
      color: MUTED,
    });
  }

  rule(16);

  // ── Itemised table ──────────────────────────────────────────────────────
  const colDate = MARGIN;
  const colProject = MARGIN + 62;
  const colRole = MARGIN + 250;
  const colAmount = PAGE_WIDTH - MARGIN;

  y -= 12;
  text("TANGGAL", { x: colDate, size: 7, font: bold, color: MUTED });
  text("PROYEK / PENUGASAN", { x: colProject, size: 7, font: bold, color: MUTED });
  text("PERAN", { x: colRole, size: 7, font: bold, color: MUTED });
  text("KOMPENSASI", { x: colAmount, size: 7, font: bold, color: MUTED, align: "right" });

  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.6,
    color: SOFT,
  });

  for (const line of data.lines) {
    y -= 15;
    if (y < 210) break; // keep the summary block on page 1
    text(dateLine(line.earnedOn), { x: colDate, size: 8, font: regular });
    const project = safe(line.projectName ?? "Tanpa proyek").slice(0, 34);
    text(project, { x: colProject, size: 8, font: regular });
    if (line.roleLabel) {
      text(line.roleLabel.slice(0, 18), { x: colRole, size: 7.5, color: MUTED });
    }
    text(formatRupiah(line.netAmount), { x: colAmount, size: 8.5, font: mono, align: "right" });
  }

  if (data.lines.length === 0) {
    y -= 15;
    text("Tidak ada item kompensasi pada periode ini.", { size: 8, color: MUTED });
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  y -= 22;
  page.drawRectangle({
    x: MARGIN,
    y: y - 62,
    width: CONTENT_WIDTH,
    height: 62,
    color: CANVAS,
  });

  const labelX = MARGIN + 10;
  const valueX = PAGE_WIDTH - MARGIN - 10;
  y -= 8;
  text("Subtotal Kompensasi Bruto", { x: labelX, size: 8, color: MUTED });
  text(formatRupiah(data.totalGross), { x: valueX, size: 9, font: mono, align: "right" });

  y -= 15;
  text("Total Potongan / Administrasi", { x: labelX, size: 8, color: MUTED });
  text(formatRupiah(data.totalDeduction), { x: valueX, size: 9, font: mono, align: "right" });

  y -= 22;
  text("TOTAL BERSIH DITERIMA", { x: labelX, size: 10, font: bold });
  text(formatRupiah(data.totalNet), { x: valueX, size: 14, font: bold, align: "right" });

  // ── Footer with QR ──────────────────────────────────────────────────────
  const qrSize = 74;
  const qrPng = await QRCode.toBuffer(verificationUrl, {
    type: "png",
    margin: 1,
    width: qrSize * 3,
    errorCorrectionLevel: "M",
  });
  const qrImage = await doc.embedPng(qrPng);
  page.drawImage(qrImage, { x: MARGIN, y: 52, width: qrSize, height: qrSize });

  const footX = MARGIN + qrSize + 14;
  let fy = 118;
  page.drawText(safe("Dokumen ini ditandatangani secara digital oleh Elts. Photography."), {
    x: footX, y: fy, size: 7.5, font: regular, color: MUTED,
  });
  fy -= 11;
  page.drawText(safe("Pindai untuk verifikasi keabsahan dokumen di server resmi Elts."), {
    x: footX, y: fy, size: 7.5, font: regular, color: MUTED,
  });
  fy -= 13;
  page.drawText(safe("Verifikasi:"), { x: footX, y: fy, size: 7, font: bold, color: MUTED });
  fy -= 10;
  // The URL is long; wrap it across two short lines rather than overflow.
  const url = safe(verificationUrl);
  const cut = Math.min(url.length, 62);
  page.drawText(url.slice(0, cut), { x: footX, y: fy, size: 6, font: mono, color: INK });
  if (url.length > cut) {
    fy -= 8;
    page.drawText(url.slice(cut, cut + 62), { x: footX, y: fy, size: 6, font: mono, color: INK });
  }

  fy -= 16;
  page.drawText(safe(`Tanda tangan digital: ${data.verificationHash.slice(0, 43)}`), {
    x: footX, y: fy, size: 6, font: mono, color: MUTED,
  });

  // Baseline footer
  page.drawLine({
    start: { x: MARGIN, y: 40 },
    end: { x: PAGE_WIDTH - MARGIN, y: 40 },
    thickness: 0.6,
    color: SOFT,
  });
  page.drawText(safe(`Elts. Photography  -  Slip ${data.slipNumber}  -  Halaman 1`), {
    x: MARGIN, y: 28, size: 7, font: regular, color: MUTED,
  });

  void ({} as PDFPage);
  const bytes = await doc.save();
  return Buffer.from(bytes);
}
