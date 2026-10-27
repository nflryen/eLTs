import { requirePageOps } from "@/lib/auth/roles";
import { CreateCustomerForm } from "@/components/admin/create-customer-form";

export default async function NewCustomerPage() {
  await requirePageOps();
  return (
    <main className="p-6 md:p-8">
      <CreateCustomerForm />
    </main>
  );
}
