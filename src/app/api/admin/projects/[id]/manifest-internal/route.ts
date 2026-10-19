import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/auth/admin";
import { buildStreamA, ManifestInvariantError } from "@/app/actions/gear-exports";
import { jakartaShortDate } from "@/lib/datetime";
import { escapeHtml } from "@/lib/format";

export const runtime = "nodejs";

/**
 * STREAM A — Manifest Muat Internal & Partner (packing slip).
 *
 * Designed to be PRINTED and carried on a clipboard in the warehouse or the
 * van. That dictates the layout:
 *   • Pure black on white, high contrast, large enough to read under a van's
 *     interior light.
 *   • Physical checkbox glyphs (☐) so a pen works — crews do not tap tablets
 *     with gloves on.
 *   • Per-accessory tally cells ("Baterai ×4  [____]") so the person counting
 *     physically writes the number. That is the audit that catches a missing
 *     battery before the case leaves, not three weeks later.
 *   • TWO signature blocks: out (packing verified) and back (return condition:
 *     Good / Damaged / Lost).
 *
 * Zero colour. Zero decoration. This document's only job is to be filled in
 * correctly by a tired person at 05:30.
 */

function accessoryLines(acc: {
  batteries?: number;
  charger?: boolean;
  cards?: Array<{ capacity_gb: number; qty: number }>;
  cables?: string[];
}): string {
  const rows: string[] = [];
  if (acc.batteries) {
    rows.push(
      `<tr class="acc"><td class="acclabel">Baterai</td><td class="acccount">×${acc.batteries}</td><td class="accbox">[______]</td></tr>`,
    );
  }
  for (const c of acc.cards ?? []) {
    rows.push(
      `<tr class="acc"><td class="acclabel">Memory Card ${c.capacity_gb}GB</td><td class="acccount">×${c.qty}</td><td class="accbox">[______]</td></tr>`,
    );
  }
  if (acc.charger) {
    rows.push(`<tr class="acc"><td class="acclabel">Charger</td><td class="acccount">×1</td><td class="accbox">[______]</td></tr>`);
  }
  for (const cable of acc.cables ?? []) {
    rows.push(`<tr class="acc"><td class="acclabel">${escapeHtml(cable)}</td><td class="acccount">×1</td><td class="accbox">[______]</td></tr>`);
  }
  if (rows.length === 0) {
    rows.push(`<tr class="acc"><td class="acclabel">—</td><td class="acccount"></td><td class="accbox"></td></tr>`);
  }
  return rows.join("");
}

function itemBlock(i: {
  assetCode: string | null;
  name: string;
  serialNumber: string | null;
  ownerName: string;
  accessories: Parameters<typeof accessoryLines>[0];
}): string {
  return `
    <div class="item">
      <div class="itemhead">
        <span class="box">&#9744;</span>
        <span class="code">${escapeHtml(i.assetCode ?? "—")}</span>
        <span class="iname">${escapeHtml(i.name)}</span>
        ${i.serialNumber ? `<span class="serial">SN ${escapeHtml(i.serialNumber)}</span>` : `<span class="serial nosn">SN —</span>`}
      </div>
      <table class="acctable">${accessoryLines(i.accessories)}</table>
    </div>`;
}

function section(title: string, subtitle: string, items: Array<Parameters<typeof itemBlock>[0]>): string {
  if (items.length === 0) return "";
  return `
    <section class="group">
      <h2>${escapeHtml(title)}</h2>
      <p class="sub">${escapeHtml(subtitle)} &middot; ${items.length} item</p>
      ${items.map(itemBlock).join("")}
    </section>`;
}

/*
 * `mode: "redirect"` because this route serves an HTML print page. An operator
 * opening it in a new tab with an expired session must land on the login form,
 * not on Turbopack's error overlay. A JSON caller would use the default mode.
 */
export const GET = withAdmin<{ id: string }>(
  async ({ params }) => {
    const { id } = params;

    let data;
    try {
      data = await buildStreamA(id);
    } catch (err) {
      if (err instanceof ManifestInvariantError) {
        return NextResponse.json({ error: "MANIFEST_INVARIANT", message: err.message }, { status: 422 });
      }
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const d = data.project.shootDate;
  const stamp = new Date().toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });

      const html = `<!DOCTYPE html>
    <html lang="id"><head><meta charset="utf-8">
    <title>Manifest Muat — ${escapeHtml(data.project.name)}</title>
    <style>
      @page { size: A4; margin: 14mm 12mm; }
      * { box-sizing: border-box; }
      body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
         color: #000; background: #fff; margin: 0; font-size: 11pt; line-height: 1.35; }
      .sheet { max-width: 186mm; margin: 0 auto; }

      header { border-bottom: 2.5px solid #000; padding-bottom: 8px; margin-bottom: 14px; }
      .brand { display: flex; justify-content: space-between; align-items: flex-start; }
      .brand h1 { font-size: 15pt; margin: 0; letter-spacing: -0.02em; text-transform: uppercase; }
      .brand .kind { font-size: 9pt; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 2px; }
      .brand .meta { text-align: right; font-size: 8.5pt; line-height: 1.5; }

      .proj { margin: 10px 0 4px; }
      .proj .pname { font-size: 12.5pt; font-weight: 700; }
      .proj .prow { font-size: 9.5pt; margin-top: 3px; }
      .proj .prow b { display: inline-block; min-width: 78px; }

      .summary { display: flex; gap: 16px; border: 1.5px solid #000; padding: 7px 10px; margin: 12px 0 16px; font-size: 9.5pt; }
      .summary div { flex: 1; }
      .summary .k { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.1em; }
      .summary .v { font-size: 13pt; font-weight: 700; }

      .group { margin-bottom: 16px; page-break-inside: auto; }
      .group h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: 0.08em;
              border-bottom: 1.5px solid #000; padding-bottom: 3px; margin: 0; }
      .group .sub { font-size: 8.5pt; margin: 3px 0 8px; }

      .item { border: 1px solid #000; padding: 6px 8px; margin-bottom: 7px; page-break-inside: avoid; }
      .itemhead { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
      .itemhead .box { font-size: 14pt; line-height: 1; }
      .itemhead .code { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 8.5pt;
                    border: 1px solid #000; padding: 0 4px; }
      .itemhead .iname { font-weight: 700; font-size: 10.5pt; flex: 1; }
      .itemhead .serial { font-family: ui-monospace, Menlo, monospace; font-size: 8.5pt; }
      .itemhead .serial.nosn { opacity: 0.45; }

      .acctable { width: 100%; margin-top: 5px; border-collapse: collapse; }
      .acctable .acc td { padding: 2.5px 0; font-size: 9pt; }
      .acctable .acclabel { width: 46%; padding-left: 20px; }
      .acctable .acccount { width: 12%; font-weight: 700; }
      .acctable .accbox { font-family: ui-monospace, Menlo, monospace; letter-spacing: 0.06em; }

      .sigs { display: flex; gap: 12px; margin-top: 18px; page-break-inside: avoid; }
      .sig { flex: 1; border: 1.5px solid #000; padding: 8px 10px; }
      .sig h3 { font-size: 9.5pt; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.08em;
            border-bottom: 1px solid #000; padding-bottom: 3px; }
      .sig .line { display: flex; gap: 8px; font-size: 8.5pt; margin: 5px 0; align-items: baseline; }
      .sig .line b { min-width: 62px; font-weight: 600; }
      .sig .blank { flex: 1; border-bottom: 1px solid #000; min-height: 15px; }
      .sig .cond { margin-top: 7px; font-size: 9pt; font-weight: 700; letter-spacing: 0.02em; }

      footer { margin-top: 14px; border-top: 1px solid #000; padding-top: 6px;
           font-size: 7.5pt; display: flex; justify-content: space-between; }
      .noprint { text-align: center; margin: 14px 0; font-size: 9pt; }
      @media print { .noprint { display: none; } }
      @media screen { body { background: #f2f2f0; padding: 20px 0; }
                  .sheet { background: #fff; padding: 14mm 12mm; box-shadow: 0 2px 16px rgba(0,0,0,.12); } }
    </style></head>
    <body><div class="sheet">

      <header>
    <div class="brand">
      <div>
        <h1>ELTS. Studio</h1>
        <div class="kind">Manifest Muat Internal &amp; Partner</div>
      </div>
      <div class="meta">
        Dicetak ${escapeHtml(stamp)} WIB<br>
        Dokumen internal &mdash; bukan tagihan<br>
        Halaman 1 / 1
      </div>
    </div>
      </header>

      <div class="proj">
    <div class="pname">${escapeHtml(data.project.name)}</div>
    <div class="prow"><b>Tanggal</b> ${escapeHtml(d ? jakartaShortDate(`${d}T00:00:00+07:00`) : "—")}</div>
    <div class="prow"><b>Lokasi</b> ${escapeHtml(data.project.venueName)}</div>
    ${data.project.venueAddress ? `<div class="prow"><b></b> ${escapeHtml(data.project.venueAddress)}</div>` : ""}
    ${data.project.rehearsalDate ? `<div class="prow"><b>Gladi Resik</b> ${escapeHtml(jakartaShortDate(`${data.project.rehearsalDate}T00:00:00+07:00`))}</div>` : ""}
      </div>

      <div class="summary">
    <div><div class="k">Total Item</div><div class="v">${data.totalItems}</div></div>
    <div><div class="k">Total Aksesori</div><div class="v">${data.totalAccessories}</div></div>
    <div><div class="k">Aset Studio</div><div class="v">${data.studioItems.length}</div></div>
    <div><div class="k">Aset Partner</div><div class="v">${data.partnerItems.length}</div></div>
      </div>

      ${section("Kit Internal Studio", "Peralatan milik studio &mdash; hitung aksesori satu per satu", data.studioItems)}
      ${section("Peralatan Pribadi Partner", "Milik co-founder / partner &mdash; pastikan kembali ke pemiliknya", data.partnerItems)}

      <div class="sigs">
    <div class="sig">
      <h3>Check-Out &mdash; Verifikasi Keberangkatan</h3>
      <div class="line"><b>Nama</b><span class="blank"></span></div>
      <div class="line"><b>Tanggal</b><span class="blank"></span></div>
      <div class="line"><b>Jam</b><span class="blank"></span></div>
      <div class="line"><b>Tanda tangan</b><span class="blank"></span></div>
      <div class="cond">Semua aksesori terhitung lengkap &#9744; Ya &nbsp; &#9744; Tidak</div>
    </div>
    <div class="sig">
      <h3>Check-In &mdash; Audit Kondisi Pengembalian</h3>
      <div class="line"><b>Nama</b><span class="blank"></span></div>
      <div class="line"><b>Tanggal</b><span class="blank"></span></div>
      <div class="line"><b>Jam</b><span class="blank"></span></div>
      <div class="line"><b>Tanda tangan</b><span class="blank"></span></div>
      <div class="cond">Kondisi: &nbsp; &#9744; Baik &nbsp; &#9744; Rusak &nbsp; &#9744; Hilang</div>
      <div class="line" style="margin-top:5px"><b>Catatan</b><span class="blank"></span></div>
    </div>
      </div>

      <div class="noprint">Tekan <b>Ctrl/Cmd + P</b> untuk mencetak dokumen ini.</div>

      <footer>
    <span>ELTS Studio OS &middot; Manifest Muat Internal</span>
    <span>${escapeHtml(data.project.id.slice(0, 8))} &middot; ${data.totalItems} item</span>
      </footer>

    </div></body></html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  },
  { mode: "redirect" },
);
