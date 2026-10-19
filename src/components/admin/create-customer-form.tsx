"use client";

import { useActionState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createCustomer } from "@/app/actions/admin-customers";

export function CreateCustomerForm() {
  const [state, action, isPending] = useActionState(createCustomer, null);

  return (
    <div className="max-w-xl">
      <Link
        href="/admin/customers"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        <ArrowLeft size={14} /> Back to Customers
      </Link>

      <p className="eyebrow mb-2">Customers</p>
      <h1 className="font-serif text-3xl font-bold mb-8">Add New Customer</h1>

      <div className="bg-white border border-border rounded-[12px] p-8 shadow-sm">
        <form action={action} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="name" className="text-sm font-medium">
              Full Name <span className="text-[#ff5a00]">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="e.g. John & Jane Doe"
              className="contact-input"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="john@example.com"
              className="contact-input"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="phone" className="text-sm font-medium">
              Phone / WhatsApp
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              placeholder="+62 812 xxxx xxxx"
              className="contact-input"
            />
          </div>

          {state?.error && (
            <div className="p-3 bg-[#ff5a00]/10 border border-[#ff5a00]/40 rounded-[12px]">
              <p className="text-sm text-[#c2410c]">{state.error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <><Loader2 size={16} className="animate-spin" /> Saving...</>
              ) : (
                "Save Customer"
              )}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin/customers">Cancel</Link>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
