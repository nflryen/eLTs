import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { loadPayslipData } from "@/lib/pdf/load-payslip";
import { renderPayslipPdf } from "@/lib/pdf/payslip-document";
import {
  buildVerificationUrl,
  signSlipVerification,
  verifyPayslipDownloadToken,
} from "@/lib/pdf/payslip-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSecret(): string | null {
  const secret = process.env.INVOICE_PDF_SECRET;
  if (!secret || secret.length < 32) return null;
  return secret;
}

/**
 * Signed payslip PDF.
 *
 * Two ways in, both authenticated:
 *   1. `?token=` — a time-bound HMAC token (the download link).
 *   2. A live session belonging to the recipient or an ADMIN+.
 *
 * Rejections mirror the invoice engine:
 *   400 malformed id · 401 missing/forged/mismatched token · 503 no secret
 *   403 authenticated but not the recipient
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid payslip id." }, { status: 400 });
  }

  const secret = getSecret();
  if (!secret) {
    // Fail closed: without a signing secret no PDF may be produced.
    return NextResponse.json({ error: "PDF signing is not configured." }, { status: 503 });
  }

  const token = new URL(request.url).searchParams.get("token");
  const claim = verifyPayslipDownloadToken(token, secret);

  let authorised = false;

  if (claim) {
    // The token is bound to one slip; a valid token for another is useless.
    if (claim.slipId !== id) {
      return NextResponse.json({ error: "Link does not match this payslip." }, { status: 401 });
    }
    authorised = true;
  } else {
    /*
     * No token: fall back to a session. The recipient may download their own
     * slip; ADMIN+ may download any. Anything else is a 403, not a 401 — the
     * caller proved who they are, they simply may not see this document.
     */
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const data = await loadPayslipData(id);
    if (!data) return NextResponse.json({ error: "Payslip not found." }, { status: 404 });

    const rankRes = await supabase.rpc("get_caller_role");
    const rank = Number(
      (rankRes.data as Array<{ role_rank: number }> | null)?.[0]?.role_rank ?? 0,
    );

    let isRecipient = data.payeeUserId === user.id;

    /*
     * Ownership check: does this login own the crew row this slip is addressed
     * to? Matched on BOTH ids so neither column alone can grant access.
     *
     * Read through the service client, like the sibling admin page does.
     * `crew_members` is RLS-gated on `has_role_rank(80)`, so a FREELANCER
     * reading their own row with their own session gets nothing — which used to
     * make every freelancer's own slip a 403. Only the link columns are read;
     * no contact or bank data crosses this query, and the payout destination
     * itself comes from `v_crew_identity` via loadPayslipData.
     */
    if (!isRecipient && data.payeeCrewId) {
      const { data: crew } = await createServiceSupabase()
        .from("v_crew_identity")
        .select("crew_member_id")
        .eq("crew_member_id", data.payeeCrewId)
        .eq("auth_user_id", user.id)
        .maybeSingle();
      isRecipient = Boolean(crew);
    }

    if (!isRecipient && rank < 80) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    authorised = true;
  }

  if (!authorised) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const data = await loadPayslipData(id);
  if (!data) return NextResponse.json({ error: "Payslip not found." }, { status: 404 });

  // Re-sign from the stored figures so the QR always matches what is printed.
  const signature = signSlipVerification(
    data.id,
    data.slipNumber,
    data.totalNet,
    secret,
  );
  const origin = new URL(request.url).origin;
  const verificationUrl = buildVerificationUrl(origin, data.id, signature);

  let pdf: Buffer;
  try {
    pdf = await renderPayslipPdf(data, verificationUrl);
  } catch (err) {
    console.error("payslip render failed", err);
    return NextResponse.json({ error: "Unable to render this payslip." }, { status: 500 });
  }

  const filename = `payslip-${data.slipNumber.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(pdf.length),
    },
  });
}
