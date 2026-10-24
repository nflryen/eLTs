import { requirePageOps } from "@/lib/auth/roles";
import { getPricelist } from "@/lib/pricelist";
import { ProjectCreationWizard } from "@/components/admin/projects/wizard/project-creation-wizard";

export default async function NewProjectPage() {
  const { supabase } = await requirePageOps();

  const [{ data: customers }, pricelist] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, email, phone, archived_at, created_at, updated_at")
      .is("archived_at", null)
      .order("name"),
    getPricelist(),
  ]);

  return (
    <main className="p-4 sm:p-6 md:p-8">
      <ProjectCreationWizard
        customers={customers ?? []}
        pricelist={pricelist}
      />
    </main>
  );
}
