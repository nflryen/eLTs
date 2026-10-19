import { requireOps } from "@/lib/auth/roles";
import { ProjectCreationWizard } from "@/components/admin/projects/wizard/project-creation-wizard";

export default async function NewProjectPage() {
  const { supabase } = await requireOps();

  const { data: customers } = await supabase
    .from("customers")
    .select("id, name, email, phone, archived_at, created_at, updated_at")
    .is("archived_at", null)
    .order("name");

  return (
    <main className="p-4 sm:p-6 md:p-8">
      <ProjectCreationWizard customers={customers ?? []} />
    </main>
  );
}
