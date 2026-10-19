"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";

/**
 * Debounce a fast-changing value (search text) so navigation is not fired on
 * every keystroke. 250ms is the spec: long enough to coalesce typing, short
 * enough to feel live.
 */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
}

export function ProjectsFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentQuery = searchParams.get("q") ?? "";
  const currentStatus = searchParams.get("status") ?? "all";

  const [query, setQuery] = useState(currentQuery);
  const debouncedQuery = useDebounce(query, 250);

  const buildQueryString = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [name, value] of Object.entries(updates)) {
        if (value && value !== "all") params.set(name, value);
        else params.delete(name);
      }
      return params.toString();
    },
    [searchParams]
  );

  const navigate = useCallback(
    (updates: Record<string, string>, replace = false) => {
      const qs = buildQueryString(updates);
      const nextUrl = qs ? `${pathname}?${qs}` : pathname;
      startTransition(() => (replace ? router.replace(nextUrl) : router.push(nextUrl)));
    },
    [buildQueryString, pathname, router]
  );

  // Live filtering: fires once the operator pauses, not on Enter.
  useEffect(() => {
    if (debouncedQuery !== currentQuery) navigate({ q: debouncedQuery.trim() }, true);
  }, [debouncedQuery, currentQuery, navigate]);

  const clear = () => {
    setQuery("");
    navigate({ q: "" }, true);
  };

  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ q: query.trim() }, true);
        }}
        className="relative flex-1 sm:max-w-sm"
        role="search"
        aria-busy={isPending}
      >
        <button
          type="submit"
          aria-label="Cari proyek"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          type="text"
          placeholder="Cari proyek…"
          aria-label="Cari proyek"
          className="contact-input bg-white pl-9 pr-10"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Hapus pencarian"
            className="absolute right-2 top-1/2 inline-flex min-h-8 min-w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#71717a] hover:bg-[#f4f4f5] hover:text-[#18181b]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        {isPending ? (
          <span className="absolute -bottom-5 left-0 text-[10px] text-[#a1a1aa]" role="status">
            Memfilter…
          </span>
        ) : null}
      </form>

      <select
        value={currentStatus}
        onChange={(e) => navigate({ status: e.target.value })}
        aria-label="Filter status proyek"
        className="contact-input appearance-none bg-white sm:w-[180px]"
      >
        <option value="all">Semua Status</option>
        <option value="draft">Draft</option>
        <option value="editing">Editing</option>
        <option value="ready">Ready</option>
        <option value="expired">Expired</option>
        <option value="archived">Archived</option>
      </select>
    </div>
  );
}
