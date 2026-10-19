"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminLogin } from "@/app/actions/admin-auth";
import Link from "next/link";

export function AdminLoginForm() {
  const [state, action, isPending] = useActionState(adminLogin, null);
  // Carried through from the proxy so a gated print page returns to itself.
  const redirectedFrom = useSearchParams().get("redirectedFrom") ?? "";

  return (
    <div className="w-full max-w-md border border-border bg-white px-7 py-10 sm:p-12">
      <div className="flex items-center gap-2 eyebrow mb-5">
        <LockKeyhole size={14} /> Secure Area
      </div>
      <h1 className="font-serif text-4xl mb-6">
        Admin <span className="italic">Login</span>
      </h1>
      
      <form action={action} className="space-y-4">
        <input type="hidden" name="redirectedFrom" value={redirectedFrom} />
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-muted-foreground">
            Email Address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="admin@elts.com"
            className="w-full rounded-none border border-border bg-transparent px-4 py-3 text-sm focus:border-black focus:outline-none focus:ring-0"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-muted-foreground">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            className="w-full rounded-none border border-border bg-transparent px-4 py-3 text-sm focus:border-black focus:outline-none focus:ring-0"
          />
        </div>

        {state?.error && (
          <p className="text-sm text-[#c2410c]">{state.error}</p>
        )}

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Signing in...
            </>
          ) : (
            <>
              Sign In <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </form>
      
      <Link
        href="/"
        className="mt-6 block text-center text-sm text-muted-foreground underline underline-offset-4"
      >
        Return to public site
      </Link>
    </div>
  );
}
