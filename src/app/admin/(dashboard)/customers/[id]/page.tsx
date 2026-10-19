import { notFound } from "next/navigation";
import { requireOps } from "@/lib/auth/roles";
import { EditCustomerForm } from "@/components/admin/edit-customer-form";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditCustomerPage({ params }: Props) {
  const { id } = await params;
  const { supabase } = await requireOps();

  const { data: customer } = await supabase
    .from("customers")
    .select("id, name, email, phone")
    .eq("id", id)
    .single();

  if (!customer) {
    notFound();
  }

  return (
    <main className="p-6 md:p-8">
      <EditCustomerForm customer={customer} />
    </main>
  );
}
