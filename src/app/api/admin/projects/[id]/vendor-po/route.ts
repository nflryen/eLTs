import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/auth/admin";
import { buildStreamB, ManifestInvariantError } from "@/app/actions/gear-exports";
import { jakartaShortDate, jakartaTime } from "@/lib/datetime";
import { escapeHtml, idr } from "@/lib/format";
import { getStudioBankAccounts } from "@/lib/studio/payment-methods";

export const runtime = "nodejs";

/**
 * STREAM B — Purchase Order Sewa Vendor.
 *
 * This IS a commercial document, so it reads as one: letterhead, vendor
 * details, an itemised table with quantity × days × rate, a prominent SLA
 * pickup/return block, and deposit terms.
 *
 * The SLA block is deliberately loud, not a footnote. A rental house that
 * cannot hit the pickup window tells you immediately — and that is exactly the
 * information needed to plan a contingency before shoot day.
 *
 * `?vendor=` renders a single-vendor PO (the default when only one exists);
 * without it, every vendor is rendered on its own page for batch printing.
 */


/*
 * `mode: "redirect"` because this route serves an HTML print page. An expired
 * session must land on the login form, not on Turbopack's error overlay.
 */
export const GET = withAdmin<{ id: string }>(
  async ({ req, params }) => {
    const { id } = params;
    const url = new URL(req.url);
    const onlyVendor = url.searchParams.get("vendor");

    // Vendor payments quote the studio's configured accounts, not literals.
    const bankAccounts = await getStudioBankAccounts();

    let data;
    try {
      data = await buildStreamB(id);
    } catch (err) {
      if (err instanceof ManifestInvariantError) {
        return NextResponse.json({ error: "PO_INVARIANT", message: err.message }, { status: 422 });
      }
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

  const vendors = onlyVendor ? data.vendors.filter((v) => v.vendorName === onlyVendor) : data.vendors;
  if (vendors.length === 0) {
    return NextResponse.json(
      { error: "NO_VENDOR_ITEMS", message: "Tidak ada item sewa vendor pada proyek ini." },
      { status: 404 },
    );
  }

      const stamp = new Date().toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });
      const shoot = data.project.shootDate;

      const vendorPage = (v: (typeof vendors)[number]) => `
      <div class="sheet">
    <header>
      <div class="letterhead">
        <div class="studio">
          <div class="mark">ELTS.</div>
          <div class="tag">Creative &amp; Digital Studio</div>
          <div class="contact">
            Purwokerto, Jawa Tengah<br>
            WhatsApp 0822-3459-0719<br>
            studio@elts.id
          </div>
        </div>
        <div class="doctitle">
          <h1>PURCHASE ORDER</h1>
          <div class="ponum">${escapeHtml(v.poNumber ?? "DRAFT")}</div>
          <div class="status">Status: <b>${escapeHtml(v.status)}</b></div>
          <div class="issued">Diterbitkan ${escapeHtml(stamp)} WIB</div>
        </div>
      </div>
    </header>

    <div class="parties">
      <div class="party">
        <div class="plabel">Kepada (Vendor)</div>
        <div class="pname">${escapeHtml(v.vendorName)}</div>
        ${v.vendorAddress ? `<div class="prow">${escapeHtml(v.vendorAddress)}</div>` : ""}
        ${v.vendorPhone ? `<div class="prow">Telp/WA: ${escapeHtml(v.vendorPhone)}</div>` : ""}
      </div>
      <div class="party">
        <div class="plabel">Untuk Proyek</div>
        <div class="pname">${escapeHtml(data.project.name)}</div>
        ${shoot ? `<div class="prow">Tanggal produksi: ${escapeHtml(jakartaShortDate(`${shoot}T00:00:00+07:00`))}</div>` : ""}
        <div class="prow">Ref: ${escapeHtml(data.project.id.slice(0, 8).toUpperCase())}</div>
      </div>
    </div>

    <div class="sla">
      <div class="slablock">
        <div class="slalabel">AMBIL (PICK-UP)</div>
        <div class="slaval">${v.pickupAt ? `${escapeHtml(jakartaShortDate(v.pickupAt))} &middot; ${escapeHtml(jakartaTime(v.pickupAt))} WIB` : "Belum ditetapkan"}</div>
      </div>
      <div class="slablock">
        <div class="slalabel">KEMBALI (RETURN)</div>
        <div class="slaval">${v.returnDueAt ? `${escapeHtml(jakartaShortDate(v.returnDueAt))} &middot; ${escapeHtml(jakartaTime(v.returnDueAt))} WIB` : "Belum ditetapkan"}</div>
      </div>
      <div class="slanote">MOHON KONFIRMASI KETERSEDIAAN SEBELUM TANGGAL AMBIL</div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th class="c-no">No</th>
          <th class="c-desc">Deskripsi Alat</th>
          <th class="c-qty">Qty</th>
          <th class="c-days">Hari</th>
          <th class="c-rate">Tarif/Hari</th>
          <th class="c-total">Jumlah</th>
        </tr>
      </thead>
      <tbody>
        ${v.lines.map((l, i) => `
        <tr>
          <td class="c-no">${i + 1}</td>
          <td class="c-desc">${escapeHtml(l.description)}</td>
          <td class="c-qty">${l.quantity}</td>
          <td class="c-days">${l.unitDays}</td>
          <td class="c-rate">${escapeHtml(idr(l.unitRate))}</td>
          <td class="c-total">${escapeHtml(idr(l.lineTotal))}</td>
        </tr>`).join("")}
      </tbody>
      <tfoot>
        <tr class="sub"><td colspan="5">Subtotal Sewa</td><td>${escapeHtml(idr(v.subtotal))}</td></tr>
        ${v.depositAmount > 0 ? `<tr class="dep"><td colspan="5">Deposit Jaminan (dikembalikan saat alat kembali lengkap)</td><td>${escapeHtml(idr(v.depositAmount))}</td></tr>` : ""}
        <tr class="grand"><td colspan="5">TOTAL DIBAYAR SAAT PENGAMBILAN</td><td>${escapeHtml(idr(v.subtotal + v.depositAmount))}</td></tr>
      </tfoot>
    </table>

    ${v.notes ? `<div class="notes"><b>Catatan:</b> ${escapeHtml(v.notes)}</div>` : ""}

    <div class="terms">
      <div class="tcol">
        <h3>Syarat &amp; Ketentuan</h3>
        <ol>
          <li>Alat diperiksa bersama pada saat pengambilan dan pengembalian.</li>
          <li>Kerusakan akibat kelalaian menjadi tanggungan penyewa.</li>
          <li>Keterlambatan pengembalian dikenakan biaya tambahan per hari.</li>
          <li>Deposit dikembalikan penuh apabila alat kembali lengkap &amp; berfungsi baik.</li>
        </ol>
      </div>
      <div class="tcol">
        <h3>Pembayaran</h3>
        ${
          bankAccounts.length > 0
            ? bankAccounts
                .map(
                  (b) =>
                    `<div class="bank">${escapeHtml(b.bank)} ${escapeHtml(b.account_number)}<br><span>a.n. ${escapeHtml(b.account_holder)}</span></div>`,
                )
                .join("")
            : `<div class="bank"><span>Detail rekening belum tersedia — hubungi studio.</span></div>`
        }
      </div>
    </div>

    <div class="sigs">
      <div class="sig"><div class="sigrole">Disetujui Vendor</div><div class="sigline"></div><div class="signame">Nama &amp; Tanda Tangan</div></div>
      <div class="sig"><div class="sigrole">ELTS. Studio</div><div class="sigline"></div><div class="signame">Nama &amp; Tanda Tangan</div></div>
    </div>

    <footer>
      <span>ELTS. Studio OS &middot; Purchase Order ${escapeHtml(v.poNumber ?? "DRAFT")}</span>
      <span>${escapeHtml(v.vendorName)} &middot; ${v.lines.length} item</span>
    </footer>
      </div>`;

      const html = `<!DOCTYPE html>
    <html lang="id"><head><meta charset="utf-8">
    <title>PO Sewa Vendor — ${escapeHtml(data.project.name)}</title>
    <style>
      @page { size: A4; margin: 13mm 12mm; }
      * { box-sizing: border-box; }
      body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
         color: #14110d; background: #fff; margin: 0; font-size: 10.5pt; line-height: 1.4; }
      .sheet { max-width: 186mm; margin: 0 auto; page-break-after: always; }
      .sheet:last-child { page-break-after: auto; }

      header { border-bottom: 3px double #14110d; padding-bottom: 10px; margin-bottom: 14px; }
      .letterhead { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
      .studio .mark { font-family: Georgia, "Times New Roman", serif; font-size: 26pt; font-weight: 700;
                  letter-spacing: -0.03em; line-height: 1; }
      .studio .tag { font-size: 8pt; letter-spacing: 0.16em; text-transform: uppercase;
                 color: #6a6357; margin-top: 2px; }
      .studio .contact { font-size: 8pt; color: #4a453c; margin-top: 7px; line-height: 1.55; }
      .doctitle { text-align: right; }
      .doctitle h1 { font-size: 16pt; margin: 0; letter-spacing: 0.1em; }
      .doctitle .ponum { font-family: ui-monospace, Menlo, monospace; font-size: 11pt; font-weight: 700;
                     margin-top: 4px; padding: 3px 8px; border: 1.5px solid #14110d; display: inline-block; }
      .doctitle .status { font-size: 8.5pt; margin-top: 6px; color: #4a453c; }
      .doctitle .issued { font-size: 7.5pt; color: #6a6357; margin-top: 2px; }

      .parties { display: flex; gap: 14px; margin-bottom: 14px; }
      .party { flex: 1; border: 1px solid #cfc9bd; padding: 9px 11px; background: #faf9f6; }
      .plabel { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.12em; color: #6a6357; }
      .pname { font-size: 11pt; font-weight: 700; margin-top: 3px; }
      .prow { font-size: 9pt; color: #3c3830; margin-top: 2px; }

      .sla { display: flex; gap: 12px; align-items: stretch; border: 2px solid #14110d;
         margin-bottom: 16px; background: #fff; }
      .slablock { flex: 1; padding: 9px 12px; }
      .slablock + .slablock { border-left: 2px solid #14110d; }
      .slalabel { font-size: 7.5pt; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 700; }
      .slaval { font-size: 12pt; font-weight: 700; margin-top: 3px; }
      .slanote { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 7pt; font-weight: 700;
             letter-spacing: 0.1em; background: #14110d; color: #fff; padding: 7px 4px; text-align: center; }

      table.items { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
      table.items th { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.08em;
                   border-bottom: 2px solid #14110d; padding: 6px 5px; text-align: left; }
      table.items td { border-bottom: 1px solid #ddd8cd; padding: 7px 5px; font-size: 9.5pt; vertical-align: top; }
      .c-no { width: 7%; } .c-qty { width: 8%; text-align: center; } .c-days { width: 9%; text-align: center; }
      .c-rate, .c-total { width: 17%; text-align: right; font-family: ui-monospace, Menlo, monospace; }
      th.c-qty, th.c-days, th.c-rate, th.c-total { text-align: center; }
      th.c-rate, th.c-total { text-align: right; }
      table.items tfoot td { border: none; padding: 5px; font-size: 9.5pt; }
      tr.sub td { border-top: 1.5px solid #14110d !important; }
      tr.sub td:last-child, tr.dep td:last-child, tr.grand td:last-child {
    text-align: right; font-family: ui-monospace, Menlo, monospace; }
      tr.dep td { color: #6a6357; font-size: 8.5pt; }
      tr.grand td { border-top: 2px solid #14110d !important; border-bottom: 3px double #14110d !important;
                font-weight: 700; font-size: 11pt; padding-top: 7px; padding-bottom: 7px; }

      .notes { border: 1px solid #cfc9bd; background: #faf9f6; padding: 8px 11px; font-size: 9pt; margin-bottom: 14px; }

      .terms { display: flex; gap: 18px; margin-bottom: 16px; }
      .tcol { flex: 1; }
      .tcol h3 { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.1em;
             border-bottom: 1px solid #14110d; padding-bottom: 3px; margin: 0 0 6px; }
      .tcol ol { margin: 0; padding-left: 15px; font-size: 8.5pt; line-height: 1.6; color: #3c3830; }
      .bank { font-family: ui-monospace, Menlo, monospace; font-size: 9pt; margin-bottom: 6px; }
      .bank span { font-family: inherit; font-size: 7.5pt; color: #6a6357; }

      .sigs { display: flex; gap: 24px; margin-top: 20px; }
      .sig { flex: 1; text-align: center; }
      .sigrole { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
      .sigline { border-bottom: 1px solid #14110d; height: 42px; margin: 7px 0 5px; }
      .signame { font-size: 8pt; color: #6a6357; }

      footer { margin-top: 14px; border-top: 1px solid #cfc9bd; padding-top: 6px;
           font-size: 7.5pt; color: #6a6357; display: flex; justify-content: space-between; }
      .noprint { text-align: center; margin: 14px 0; font-size: 9pt; color: #6a6357; }
      @media print { .noprint { display: none; } }
      @media screen { body { background: #efece6; padding: 20px 0; }
                  .sheet { background: #fff; padding: 13mm 12mm; box-shadow: 0 2px 16px rgba(0,0,0,.12);
                           margin-bottom: 20px; } }
    </style></head>
    <body>
      ${vendors.map(vendorPage).join("")}
      <div class="noprint">Tekan <b>Ctrl/Cmd + P</b> untuk mencetak. ${vendors.length > 1 ? `${vendors.length} vendor &mdash; satu halaman per vendor.` : ""}</div>
    </body></html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  },
  { mode: "redirect" },
);
