import { NextResponse } from "next/server";
import { verifyInvoicePdfToken } from "@/lib/pdf/token";
import { loadInvoicePdfData } from "@/lib/pdf/load-invoice";
import { renderInvoicePdf } from "@/lib/pdf/invoice-document";

/**
 * Signed, time-limited invoice PDF download.
 *
 *   GET /api/invoices/[id]/pdf?token=...
 *
 * AUTHORISATION
 * -------------
 * This endpoint is reachable without a session because the delivery channels
 * that need it (email, WhatsApp) cannot present a cookie. Authority therefore
 * has to live in the URL: `token` is an HMAC over `{ invoiceId, expiry }`, so it
 * cannot be edited to point at another invoice and it stops working on its own.
 *
 * A stranger who guesses or scrapes an invoice id gets 401, not a document.
 * Employee-facing printing stays on `/api/admin/invoices/[id]/print`, which is
 * gated by `withAdmin`.
 *
 * The Node runtime is required: pdf-lib and node:crypto are both unavailable in
 * the edge runtime.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSecret(): string | null {
  const secret = process.env.INVOICE_PDF_SECRET;
  if (!secret || secret.length < 32) return null;
  return secret;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid invoice id." }, { status: 400 });
  }

  const secret = getSecret();
  if (!secret) {
    // Fail closed: without a signing secret no PDF may be produced.
    return NextResponse.json({ error: "PDF signing is not configured." }, { status: 503 });
  }

  const token = new URL(request.url).searchParams.get("token");
  const claim = verifyInvoicePdfToken(token, secret);
  // The token is bound to one invoice; a valid token for another invoice is
  // just as useless as a forged one.
  if (!claim || claim.invoiceId !== id) {
    return NextResponse.json({ error: "Link is invalid or has expired." }, { status: 401 });
  }

  const data = await loadInvoicePdfData(id);
  if (!data) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  let pdf: Buffer;
  try {
    pdf = await renderInvoicePdf(data);
  } catch {
    return NextResponse.json({ error: "Unable to render this invoice." }, { status: 500 });
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${data.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(pdf.length),
    },
  });
}
