"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition, useEffect } from "react";
import { Search } from "lucide-react";
// Add a simple useDebounce here instead of importing
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export function ProjectsFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentQuery = searchParams.get("q") ?? "";
  const currentStatus = searchParams.get("status") ?? "all";

  const [query, setQuery] = useState(currentQuery);
  const debouncedQuery = useDebounce(query, 300);

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== "all") {
        params.set(name, value);
      } else {
        params.delete(name);
      }
      return params.toString();
    },
    [searchParams]
  );

  const navigateWithQuery = useCallback(
    (value: string) => {
      const queryString = createQueryString("q", value.trim());
      const nextUrl = queryString ? `${pathname}?${queryString}` : pathname;
      startTransition(() => router.replace(nextUrl));
    },
    [createQueryString, pathname, router]
  );

  useEffect(() => {
    if (debouncedQuery !== currentQuery) {
      navigateWithQuery(debouncedQuery);
    }
  }, [debouncedQuery, currentQuery, navigateWithQuery]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigateWithQuery(query);
  };

  const handleStatusChange = (value: string) => {
    startTransition(() => {
      router.push(`${pathname}?${createQueryString("status", value)}`);
    });
  };

  return (
    <div className="flex flex-col sm:flex-row gap-3 mb-6">
      <form onSubmit={handleSubmit} className="relative flex-1 max-w-sm" aria-busy={isPending}>
        <button
          type="submit"
          aria-label="Search projects"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <Search className="h-4 w-4" />
        </button>
        <input
          type="text"
          placeholder="Search projects..."
          className="contact-input pl-9 pr-3 bg-white"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        />
      </form>
      <select 
        value={currentStatus} 
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleStatusChange(e.target.value)}
        className="contact-input sm:w-[180px] bg-white appearance-none"
      >
        <option value="all">All Statuses</option>
        <option value="draft">Draft</option>
        <option value="editing">Editing</option>
        <option value="ready">Ready</option>
        <option value="expired">Expired</option>
        <option value="archived">Archived</option>
      </select>
    </div>
  );
}
