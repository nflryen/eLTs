import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatDateId, formatRupiah } from "@/lib/reminders/compose";

/**
 * Invoice PDF as a real vector document.
 *
 * Built with pdf-lib rather than an HTML-to-PDF browser because:
 *   - clients forward invoices to finance teams and printers, so text must stay
 *     selectable and sharp at any zoom (no rasterised pages);
 *   - rendering must not need a headless Chromium in production;
 *   - every value is written from the database, so there is no template engine
 *     to drift from the portal.
 */

export type InvoicePdfLineItem = {
  description?: string;
  label?: string;
  amount?: number;
  qty?: number;
  unit_price?: number;
};

export type InvoicePdfData = {
  invoiceNumber: string;
  issueDate: string | null;
  dueDate: string | null;
  lineItems: InvoicePdfLineItem[];
  clientNotes: string | null;
  contractValue: number;
  paidAmount: number;
  balanceDue: number;
  paymentStatus: string;
  payments: Array<{ receipt_number: string; amount: number; received_at: string; bank_name: string | null; verified: boolean }>;
  project: { name: string; shootDate: string | null };
  customer: { name: string; phone: string | null; email: string | null };
  bankDetails: Array<{ bank: string; account_number: string; account_holder: string; label: string | null }>;
  studioName: string;
};

const PAGE_WIDTH = 595.28; // A4 points
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.094, 0.094, 0.106);
const MUTED = rgb(0.443, 0.443, 0.482);
const HAIRLINE = rgb(0.8, 0.8, 0.83);
const SOFT_LINE = rgb(0.925, 0.925, 0.933);
const CANVAS = rgb(0.957, 0.957, 0.965);

/**
 * WinAnsi (the standard font encoding) cannot represent smart quotes, en
 * dashes, or emoji. Client-entered notes routinely contain them, and pdf-lib
 * throws on them, so they are folded to ASCII before drawing.
 */
export function toWinAnsi(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    // Anything outside the Latin-1 range (emoji, CJK, symbols) becomes "?".
    .replace(/[^\u0000-\u00FF]/g, "?");
}

function lineAmount(item: InvoicePdfLineItem): number {
  if (typeof item.amount === "number") return item.amount;
  const qty = typeof item.qty === "number" ? item.qty : 1;
  const unit = typeof item.unit_price === "number" ? item.unit_price : 0;
  return qty * unit;
}

/** Greedy wrap using measured glyph widths, so columns never overlap. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = toWinAnsi(text);
  const words = safe.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // A single word longer than the column is hard-broken.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function truncated(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const safe = toWinAnsi(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let out = safe;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

function drawTextRight(page: PDFPage, text: string, xRight: number, y: number, font: PDFFont, size: number, color = INK) {
  const safe = toWinAnsi(text);
  page.drawText(safe, { x: xRight - font.widthOfTextAtSize(safe, size), y, size, font, color });
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${data.invoiceNumber}`);
  doc.setAuthor(toWinAnsi(data.studioName));
  doc.setSubject(toWinAnsi(`Invoice for ${data.project.name}`));
  doc.setCreator(toWinAnsi(data.studioName));
  doc.setProducer("Elts. Studio OS");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  // ── Header ────────────────────────────────────────────────────────────────
  page.drawText(toWinAnsi(data.studioName), { x: MARGIN, y, size: 16, font: bold, color: INK });
  const headerRight = MARGIN + CONTENT_WIDTH;
  drawTextRight(page, "INVOICE", headerRight, y, bold, 22);
  y -= 16;
  drawTextRight(page, data.invoiceNumber, headerRight, y, regular, 9.5, MUTED);

  let leftY = y + 16;
  leftY -= 14;
  page.drawText(toWinAnsi(`Untuk ${data.customer.name}`), { x: MARGIN, y: leftY, size: 9.5, font: regular, color: MUTED });
  if (data.customer.phone) {
    leftY -= 12;
    page.drawText(toWinAnsi(data.customer.phone), { x: MARGIN, y: leftY, size: 9.5, font: regular, color: MUTED });
  }
  if (data.customer.email) {
    leftY -= 12;
    page.drawText(truncated(data.customer.email, regular, 9.5, 240), { x: MARGIN, y: leftY, size: 9.5, font: regular, color: MUTED });
  }

  y -= 30;

  // ── Meta columns ──────────────────────────────────────────────────────────
  const colRightX = MARGIN + CONTENT_WIDTH;
  page.drawText("PROYEK", { x: MARGIN, y, size: 7.5, font: bold, color: MUTED });
  page.drawText("TANGGAL", { x: MARGIN + 300, y, size: 7.5, font: bold, color: MUTED });
  y -= 13;
  page.drawText(truncated(data.project.name, regular, 9.5, 260), { x: MARGIN, y, size: 9.5, font: regular, color: INK });
  page.drawText(toWinAnsi(`Terbit: ${formatDateId(data.issueDate) ?? "-"}`), { x: MARGIN + 300, y, size: 9.5, font: regular, color: INK });
  y -= 12;
  if (data.project.shootDate) {
    page.drawText(toWinAnsi(`Tanggal: ${formatDateId(data.project.shootDate) ?? "-"}`), { x: MARGIN, y, size: 9.5, font: regular, color: MUTED });
  }
  page.drawText(toWinAnsi(`Jatuh tempo: ${formatDateId(data.dueDate) ?? "-"}`), { x: MARGIN + 300, y, size: 9.5, font: regular, color: MUTED });
  y -= 12;
  page.drawText(toWinAnsi(String(data.paymentStatus).toUpperCase()), { x: MARGIN + 300, y, size: 8, font: bold, color: MUTED });

  y -= 22;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: colRightX, y }, thickness: 1, color: HAIRLINE });
  y -= 14;

  // ── Line-item table ───────────────────────────────────────────────────────
  const xQty = MARGIN + 330;
  const xPrice = MARGIN + 410;
  const xTotal = colRightX;

  page.drawText("DESKRIPSI", { x: MARGIN, y, size: 7.5, font: bold, color: MUTED });
  drawTextRight(page, "QTY", xQty + 30, y, bold, 7.5, MUTED);
  drawTextRight(page, "HARGA", xPrice + 70, y, bold, 7.5, MUTED);
  drawTextRight(page, "JUMLAH", xTotal, y, bold, 7.5, MUTED);
  y -= 10;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN + 90) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  for (const item of data.lineItems.length > 0 ? data.lineItems : [{ description: "Tidak ada rincian", qty: 1, unit_price: 0 }]) {
    const label = item.description ?? item.label ?? "-";
    const descLines = wrapText(label, regular, 9.5, 300);
    const rowHeight = Math.max(20, descLines.length * 12 + 8);
    ensureSpace(rowHeight);

    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: colRightX, y: y + 4 },
      thickness: 0.5,
      color: SOFT_LINE,
    });
    y -= 8;
    descLines.forEach((line, i) => {
      page.drawText(line, { x: MARGIN, y: y - i * 12, size: 9.5, font: regular, color: INK });
    });
    drawTextRight(page, String(item.qty ?? 1), xQty + 30, y, regular, 9.5);
    drawTextRight(page, formatRupiah(item.unit_price ?? lineAmount(item)), xPrice + 70, y, regular, 9.5);
    drawTextRight(page, formatRupiah(lineAmount(item)), xTotal, y, regular, 9.5);
    y -= (descLines.length - 1) * 12 + 10;
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  ensureSpace(120);
  y -= 12;
  const totalsLeft = colRightX - 240;
  page.drawText("Nilai kontrak", { x: totalsLeft, y, size: 9.5, font: regular, color: MUTED });
  drawTextRight(page, formatRupiah(data.contractValue), colRightX, y, regular, 9.5);
  y -= 14;
  page.drawText("Sudah dibayar", { x: totalsLeft, y, size: 9.5, font: regular, color: MUTED });
  drawTextRight(page, `- ${formatRupiah(data.paidAmount)}`, colRightX, y, regular, 9.5);
  y -= 10;
  page.drawLine({ start: { x: totalsLeft, y }, end: { x: colRightX, y }, thickness: 1, color: INK });
  y -= 16;
  page.drawText("Sisa tagihan", { x: totalsLeft, y, size: 10.5, font: bold, color: INK });
  drawTextRight(page, formatRupiah(data.balanceDue), colRightX, y, bold, 10.5);

  // ── Payment accounts ──────────────────────────────────────────────────────
  if (data.bankDetails.length > 0) {
    const boxHeight = 30 + data.bankDetails.length * 13;
    ensureSpace(boxHeight + 20);
    y -= 26;
    page.drawRectangle({
      x: MARGIN,
      y: y - boxHeight + 12,
      width: CONTENT_WIDTH,
      height: boxHeight,
      color: CANVAS,
    });
    page.drawText("PEMBAYARAN", { x: MARGIN + 12, y: y - 4, size: 7.5, font: bold, color: MUTED });
    let bankY = y - 18;
    for (const b of data.bankDetails) {
      page.drawText(
        truncated(`${b.bank} ${b.account_number} a/n ${b.account_holder}${b.label ? ` (${b.label})` : ""}`, regular, 9, CONTENT_WIDTH - 24),
        { x: MARGIN + 12, y: bankY, size: 9, font: regular, color: INK }
      );
      bankY -= 13;
    }
    y = bankY;
  }

  // ── Client notes ──────────────────────────────────────────────────────────
  if (data.clientNotes) {
    y -= 20;
    for (const line of wrapText(data.clientNotes, regular, 9, CONTENT_WIDTH)) {
      ensureSpace(14);
      page.drawText(line, { x: MARGIN, y, size: 9, font: regular, color: MUTED });
      y -= 12;
    }
  }

  // ── Footer on every page ──────────────────────────────────────────────────
  const pages = doc.getPages();
  pages.forEach((p, index) => {
    const footY = MARGIN - 20;
    p.drawLine({
      start: { x: MARGIN, y: footY + 12 },
      end: { x: MARGIN + CONTENT_WIDTH, y: footY + 12 },
      thickness: 0.5,
      color: HAIRLINE,
    });
    p.drawText(toWinAnsi(data.studioName), { x: MARGIN, y: footY, size: 7.5, font: regular, color: MUTED });
    drawTextRight(p, `Halaman ${index + 1} dari ${pages.length}`, MARGIN + CONTENT_WIDTH, footY, regular, 7.5, MUTED);
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
