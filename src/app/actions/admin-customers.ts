"use server";

import { redirect } from "next/navigation";
import { requireOps } from "@/lib/auth/roles";
import { z } from "zod";

const createCustomerSchema = z.object({
  name: z.string().min(1).max(160),
  email: z.email().max(254).optional().or(z.literal("")),
  phone: z.string().max(32).optional().or(z.literal("")),
});

export async function createCustomer(state: unknown, formData: FormData) {
  const { supabase } = await requireOps();

  const raw = {
    name: formData.get("name")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    phone: formData.get("phone")?.toString() ?? "",
  };

  const parsed = createCustomerSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Invalid form data. Please check your inputs." };
  }

  const { name, email, phone } = parsed.data;
  const { error } = await supabase.from("customers").insert({
    name,
    email: email || null,
    phone: phone || null,
  });

  if (error) {
    return { error: `Failed to create customer: ${error.message}` };
  }

  redirect("/admin/customers");
}

export async function updateCustomer(state: unknown, formData: FormData) {
  const { supabase } = await requireOps();

  const id = formData.get("id")?.toString();
  if (!id) return { error: "Customer ID is required." };

  const raw = {
    name: formData.get("name")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    phone: formData.get("phone")?.toString() ?? "",
  };

  const parsed = createCustomerSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Invalid form data. Please check your inputs." };
  }

  const { name, email, phone } = parsed.data;
  const { error } = await supabase
    .from("customers")
    .update({
      name,
      email: email || null,
      phone: phone || null,
    })
    .eq("id", id);

  if (error) {
    return { error: `Failed to update customer: ${error.message}` };
  }

  redirect("/admin/customers");
}

export async function archiveCustomer(id: string) {
  const { supabase } = await requireOps();
  const { error } = await supabase
    .from("customers")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return { error: `Failed to archive customer: ${error.message}` };
  }

  redirect("/admin/customers");
}
