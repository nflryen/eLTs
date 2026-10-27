"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Admin-scoped error boundary.
 *
 * Without this, a `ForbiddenError` thrown by a page (a WORKER opening a surface
 * above their rank, or `requirePermission` refusing a grant) bubbled to
 * `src/app/error.tsx` and rendered as a 500. A refusal is not a crash: it is the
 * system working. This boundary gives it a deliberate response.
 *
 * Next.js errors carry a `digest` rather than a type across the server/client
 * boundary, so classification uses the message the role helpers emit. Anything
 * unrecognised still renders the generic state — nothing is swallowed.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin route error:", error);
  }, [error]);

  const forbidden = /tidak memiliki akses|Forbidden/i.test(error.message ?? "");

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-[18px] border border-[#ececee] bg-white p-8 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#71717a]">
          {forbidden ? "Akses dibatasi" : "Terjadi kesalahan"}
        </p>
        <h1 className="mt-2 font-serif text-2xl font-bold tracking-tight text-[#09090b]">
          {forbidden ? "Peran Anda tidak membuka halaman ini" : "Halaman gagal dimuat"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#71717a]">
          {forbidden
            ? error.message
            : "Ada gangguan saat memuat data. Coba muat ulang; bila berulang, laporkan ke Studio Head."}
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/admin"
            className="inline-flex min-h-11 items-center justify-center rounded-[10000px] bg-[#09090b] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Kembali ke Hari Ini
          </Link>
          {!forbidden ? (
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-11 items-center justify-center rounded-[10000px] border border-[#ececee] bg-[#fafafa] px-5 text-sm font-semibold text-[#18181b] transition-colors hover:bg-[#f4f4f5]"
            >
              Muat ulang
            </button>
          ) : null}
        </div>

        {error.digest ? (
          <p className="mt-4 font-mono text-[10px] text-[#a1a1aa]">Ref: {error.digest}</p>
        ) : null}
      </div>
    </div>
  );
}
