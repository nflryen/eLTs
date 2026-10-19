import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div
      className="site-container py-16"
      aria-label="Loading page"
      role="status"
    >
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-8 h-44 w-3/4" />
      <Skeleton className="mt-8 h-96 w-full" />
      <span className="sr-only">Loading page</span>
    </div>
  );
}
