import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { InvoiceMilestone, InvoiceStatus } from "@/types/database";

export const runtime = "nodejs";

const uuidSchema = z.string().uuid();


function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    return new Intl.DateTimeFormat("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
    return dateStr;
  }
}

function getMilestoneDetails(milestone: InvoiceMilestone): { title: string; desc: string } {
  switch (milestone) {
    case "DP_50":
      return {
        title: "Down Payment (DP 50%)",
        desc: "Pembayaran termin awal penguncian jadwal produksi & persiapan operasional.",
      };
    case "FINAL_BALANCE":
      return {
        title: "Pelunasan Akhir (Final Balance 50%)",
        desc: "Pelunasan penuh proyek sebelum pelepasan akses unduhan aset beresolusi tinggi.",
      };
    case "ADDON":
      return {
        title: "Biaya Tambahan / Add-on",
        desc: "Layanan tambahan, penambahan jam (overtime), atau revisi di luar paket standar.",
      };
    default:
      return {
        title: milestone,
        desc: "Pembayaran termin layanan produksi.",
      };
  }
}

function getStatusBadge(status: InvoiceStatus, paidAt: string | null): string {
  switch (status) {
    case "PAID":
      return `
        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
          <span class="w-2 h-2 rounded-full bg-emerald-600"></span>
          LUNAS / PAID ${paidAt ? `(${formatDate(paidAt)})` : ""}
        </div>
      `;
    case "PENDING":
      return `
        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
          <span class="w-2 h-2 rounded-full bg-amber-500"></span>
          MENUNGGU PEMBAYARAN
        </div>
      `;
    case "DRAFT":
      return `
        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-700 border border-zinc-300">
          <span class="w-2 h-2 rounded-full bg-zinc-400"></span>
          DRAFT
        </div>
      `;
    case "CANCELLED":
      return `
        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300">
          <span class="w-2 h-2 rounded-full bg-rose-600"></span>
          DIBATALKAN
        </div>
      `;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const isUuid = uuidSchema.safeParse(id).success;
  const supabase = createServiceSupabase();

  // 1. Fetch invoice by UUID or invoice_number
  let query = supabase.from("invoices").select("*");
  if (isUuid) {
    query = query.eq("id", id);
  } else {
    query = query.eq("invoice_number", id);
  }
  const { data: invoice, error: invoiceErr } = await query.maybeSingle();

  if (invoiceErr || !invoice) {
    // Check if it's in consolidated project_invoices
    const { data: projInv } = await supabase
      .from("project_invoices")
      .select("id")
      .or(isUuid ? `id.eq.${id}` : `invoice_number.eq.${id}`)
      .maybeSingle();

    if (projInv) {
      return NextResponse.redirect(new URL(`/api/admin/invoices/${projInv.id}/print`, _request.url));
    }

    return new Response(
      `<!DOCTYPE html><html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h2>Invoice Tidak Ditemukan</h2>
        <p>Invoice dengan ID tersebut tidak tersedia atau telah dihapus.</p>
      </body></html>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  // 2. Fetch project
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", invoice.project_id)
    .maybeSingle();

  // 3. Fetch customer
  const { data: customer } = project?.customer_id
    ? await supabase
        .from("customers")
        .select("*")
        .eq("id", project.customer_id)
        .maybeSingle()
    : { data: null };

  const milestoneInfo = getMilestoneDetails(invoice.milestone as InvoiceMilestone);
  const statusBadge = getStatusBadge(invoice.status as InvoiceStatus, invoice.paid_at);
  const isPaid = invoice.status === "PAID";
  const formattedAmount = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(invoice.amount);

  const customerName = customer?.name || "Klien Terhormat";
  const customerEmail = customer?.email || "-";
  const customerPhone = customer?.phone || "-";
  const projectName = project?.name || "Layanan Produksi";
  const servicePillar = project?.service_pillar || project?.photography_type || "VISUAL_CREATIVE";

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice #${invoice.invoice_number} - ELTs. Studio</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @media print {
      .no-print {
        display: none !important;
      }
      body {
        background: white !important;
        padding: 0 !important;
      }
      .page-container {
        border: none !important;
        box-shadow: none !important;
        max-width: 100% !important;
        padding: 0 !important;
      }
    }
  </style>
</head>
<body class="bg-zinc-100 text-zinc-900 font-sans antialiased p-4 sm:p-8">

  <!-- Action Bar (Hidden on Print) -->
  <div class="max-w-4xl mx-auto mb-6 flex items-center justify-between no-print">
    <div class="flex items-center gap-3">
      <span class="text-sm text-zinc-500">Pratinjau Dokumen Tagihan</span>
    </div>
    <div class="flex items-center gap-3">
      <button onclick="window.print()" class="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded-lg transition-colors shadow-sm flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
        </svg>
        Cetak / Simpan PDF
      </button>
    </div>
  </div>

  <!-- Printable Invoice Sheet -->
  <div class="page-container max-w-4xl mx-auto bg-white rounded-xl shadow-lg border border-zinc-200 p-8 sm:p-12 relative overflow-hidden">
    
    <!-- Paid Watermark Stamp -->
    ${
      isPaid
        ? `
      <div class="absolute right-10 top-24 pointer-events-none opacity-20 transform rotate-12 border-4 border-emerald-600 text-emerald-700 font-black text-4xl sm:text-5xl px-6 py-2 rounded-lg tracking-widest uppercase">
        LUNAS / PAID
      </div>
    `
        : ""
    }

    <!-- Header Section -->
    <div class="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-zinc-200 pb-8">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <h1 class="text-2xl font-bold tracking-tight text-zinc-950">ELTs. Studio</h1>
          <span class="text-xs px-2 py-0.5 bg-zinc-900 text-zinc-100 rounded font-mono">LAB</span>
        </div>
        <p class="text-xs text-zinc-500 font-medium">Visual Creative, Live Streaming & Production Engine</p>
        <p class="text-xs text-zinc-500 mt-2">Jl. Dr. Angka No. 42, Purwokerto, Jawa Tengah</p>
        <p class="text-xs text-zinc-500">WhatsApp: +62 822-3459-0719 | hello@elts.studio</p>
      </div>
      <div class="text-left sm:text-right">
        <h2 class="text-xl font-bold text-zinc-900 uppercase tracking-wide">FAKTUR TAGIHAN</h2>
        <p class="text-sm font-mono text-zinc-600 mt-1"># ${invoice.invoice_number}</p>
        <div class="mt-3">
          ${statusBadge}
        </div>
      </div>
    </div>

    <!-- Metadata Grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-8 my-8 text-sm">
      <div>
        <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2">Ditagihkan Kepada:</span>
        <h3 class="text-base font-bold text-zinc-900">${customerName}</h3>
        <p class="text-zinc-600 text-xs mt-1">Proyek: <span class="font-medium text-zinc-800">${projectName}</span></p>
        <p class="text-zinc-600 text-xs">Pillar Layanan: <span class="font-medium text-zinc-800">${servicePillar}</span></p>
        <p class="text-zinc-600 text-xs mt-1">Kontak: ${customerPhone} | ${customerEmail}</p>
      </div>
      <div class="sm:text-right">
        <span class="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2">Rincian Tanggal:</span>
        <p class="text-zinc-600 text-xs">Tanggal Diterbitkan: <span class="font-medium text-zinc-900">${formatDate(invoice.created_at)}</span></p>
        <p class="text-zinc-600 text-xs mt-1">Jatuh Tempo: <span class="font-medium text-zinc-900">${formatDate(invoice.due_date)}</span></p>
        ${
          invoice.paid_at
            ? `<p class="text-emerald-700 text-xs font-semibold mt-1">Tanggal Pembayaran: ${formatDate(invoice.paid_at)}</p>`
            : ""
        }
      </div>
    </div>

    <!-- Line Item Breakdown Table -->
    <div class="overflow-x-auto my-8">
      <table class="w-full text-left border-collapse text-sm">
        <thead>
          <tr class="border-y border-zinc-200 bg-zinc-50/50">
            <th class="py-3 px-4 font-semibold text-zinc-700">Deskripsi Layanan / Termin</th>
            <th class="py-3 px-4 font-semibold text-zinc-700 text-center">Milestone</th>
            <th class="py-3 px-4 font-semibold text-zinc-700 text-right">Jumlah</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-200">
          <tr>
            <td class="py-4 px-4">
              <div class="font-bold text-zinc-950">${milestoneInfo.title}</div>
              <div class="text-xs text-zinc-500 mt-1">${milestoneInfo.desc}</div>
              <div class="text-xs text-zinc-600 font-mono mt-1">Ref Proyek: ${projectName}</div>
            </td>
            <td class="py-4 px-4 text-center">
              <span class="inline-block px-2.5 py-0.5 text-xs font-mono font-medium bg-zinc-100 text-zinc-800 rounded">
                ${invoice.milestone}
              </span>
            </td>
            <td class="py-4 px-4 text-right font-mono font-bold text-zinc-900">
              ${formattedAmount}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Total Summary Section -->
    <div class="flex justify-end my-6">
      <div class="w-full sm:w-1/2 border-t border-zinc-200 pt-4 space-y-2 text-sm">
        <div class="flex justify-between text-zinc-600 text-xs">
          <span>Subtotal Termin</span>
          <span class="font-mono">${formattedAmount}</span>
        </div>
        <div class="flex justify-between text-zinc-600 text-xs">
          <span>Pajak / Potongan</span>
          <span class="font-mono">Rp 0</span>
        </div>
        <div class="flex justify-between items-center text-base font-bold text-zinc-950 border-t border-zinc-300 pt-2">
          <span>Total Tagihan</span>
          <span class="font-mono text-lg text-zinc-950">${formattedAmount}</span>
        </div>
      </div>
    </div>

    <!-- Payment Instructions & Banking Section -->
    <div class="mt-10 p-6 bg-zinc-50 rounded-xl border border-zinc-200">
      <h3 class="text-xs font-bold text-zinc-900 uppercase tracking-wider mb-4 flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
        Petunjuk Pembayaran Transfer Bank
      </h3>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Bank BCA -->
        <div class="bg-white p-4 rounded-lg border border-zinc-200">
          <span class="text-xs font-bold text-blue-700 tracking-wide block">BANK BCA</span>
          <div class="mt-2 text-sm">
            <p class="font-mono font-bold text-zinc-900 text-base">0461938291</p>
            <p class="text-xs text-zinc-500 mt-0.5">a/n ELTs Studio Creative</p>
          </div>
        </div>

        <!-- Bank Mandiri -->
        <div class="bg-white p-4 rounded-lg border border-zinc-200">
          <span class="text-xs font-bold text-amber-700 tracking-wide block">BANK MANDIRI</span>
          <div class="mt-2 text-sm">
            <p class="font-mono font-bold text-zinc-900 text-base">1390028471928</p>
            <p class="text-xs text-zinc-500 mt-0.5">a/n ELTs Studio Creative</p>
          </div>
        </div>
      </div>

      <div class="mt-4 text-xs text-zinc-600 space-y-1">
        <p>• Cantumkan nomor invoice <b>#${invoice.invoice_number}</b> pada keterangan transfer.</p>
        <p>• Setelah melakukan transfer, harap kirim bukti pembayaran via WhatsApp resmi: <b>+62 822-3459-0719</b>.</p>
      </div>
    </div>

    <!-- Terms & Operational Note -->
    <div class="mt-8 border-t border-zinc-200 pt-6 text-xs text-zinc-500 leading-relaxed">
      <h4 class="font-semibold text-zinc-700 mb-1">Ketentuan Layanan:</h4>
      <p>1. Pembayaran uang muka (DP 50%) mengunci jadwal tanggal pelaksanaan secara resmi dan tidak dapat dialihkan tanpa konfirmasi minimal H-7.</p>
      <p>2. Hak unduh file master resolusi penuh dibuka setelah seluruh invoice pelunasan (100%) terverifikasi lunas oleh sistem studio.</p>
    </div>

    <!-- Footer Seal -->
    <div class="mt-8 text-center text-xs text-zinc-400 font-mono">
      Dokumen ini diterbitkan secara sah dan otomatis oleh sistem komersial ELTs. Studio.
    </div>
  </div>

</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    },
  });
}
