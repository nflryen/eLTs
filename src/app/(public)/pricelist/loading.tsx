import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level skeleton for /pricelist.
 *
 * It mirrors the real layout — header block, tab strip, package grid, and the
 * order sidebar — rather than showing one centred spinner. The visitor keeps
 * seeing the shape of the page while three selects resolve, so the arrival of
 * data is a fill-in, not a re-layout that moves everything they were reading.
 */
export default function Loading() {
  return (
    <div
      className="site-container py-16"
      aria-label="Memuat pricelist"
      role="status"
    >
      <Skeleton className="h-3 w-56" />
      <Skeleton className="mt-5 h-14 w-72" />
      <Skeleton className="mt-6 h-4 w-full max-w-md" />

      <div className="mt-12 flex flex-wrap gap-2 border-b border-[#ececee] pb-6">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton
            key={index}
            className="h-10 w-36 rounded-[var(--radius-badges)]"
            // Widths vary so the strip reads as five category tabs, not one
            // repeated placeholder.
            style={{ width: `${132 + (index % 3) * 24}px` }}
          />
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:items-start">
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-8">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="rounded-[var(--radius-cards)] border border-[var(--color-cloud)] bg-[var(--color-snow)] p-[var(--card-padding)]"
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-3 h-6 w-28" />
              <Skeleton className="mt-2 h-3 w-40" />
              <div className="mt-4 space-y-2">
                {Array.from({ length: 4 }).map((__, line) => (
                  <Skeleton
                    key={line}
                    className="h-3"
                    style={{ width: `${88 - line * 9}%` }}
                  />
                ))}
              </div>
              <Skeleton className="mt-4 h-10 w-full rounded-[var(--radius-buttons)]" />
            </div>
          ))}
        </div>

        <div className="lg:col-span-4">
          <div className="rounded-[var(--radius-cards)] border border-[var(--color-cloud)] bg-[var(--color-snow)] p-[var(--card-padding)]">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-4 h-16 w-full rounded-[var(--radius-badges)]" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
            <Skeleton className="mt-4 h-12 w-full rounded-[var(--radius-buttons)]" />
          </div>
        </div>
      </div>

      <span className="sr-only">Memuat pricelist</span>
    </div>
  );
}
