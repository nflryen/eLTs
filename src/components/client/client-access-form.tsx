"use client";

import { useActionState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyClientAccess } from "@/app/actions/client-access";

export function ClientAccessForm() {
  const [state, action, isPending] = useActionState(verifyClientAccess, null);

  return (
    <form action={action} className="mt-8 space-y-4">
      <div className="space-y-2">
        <label htmlFor="code" className="text-sm font-medium text-muted-foreground">
          Gallery Code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          required
          autoComplete="off"
          placeholder="e.g. ELTS-1234"
          className="w-full rounded-none border border-border bg-transparent px-4 py-3 text-sm focus:border-black focus:outline-none focus:ring-0"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="pin" className="text-sm font-medium text-muted-foreground">
          PIN
        </label>
        <input
          id="pin"
          name="pin"
          type="password"
          required
          placeholder="Enter 4-6 digit PIN"
          className="w-full rounded-none border border-border bg-transparent px-4 py-3 text-sm focus:border-black focus:outline-none focus:ring-0"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Verifying
          </>
        ) : (
          <>
            Access Gallery <ArrowRight className="ml-2 h-4 w-4" />
          </>
        )}
      </Button>
    </form>
  );
}
