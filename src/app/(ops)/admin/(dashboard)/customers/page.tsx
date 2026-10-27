import Link from "next/link";
import { requirePageOps } from "@/lib/auth/roles";
import { Plus, Users, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CustomerRow } from "@/types/database";

export default async function CustomersPage() {
  const { supabase } = await requirePageOps();

  const { data: customersData } = await supabase
    .from("customers")
    .select("id, name, email, phone, created_at, archived_at")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  const customers = customersData as CustomerRow[] | null;

  return (
    <div className="max-w-5xl">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="eyebrow mb-2">Management</p>
          <h1 className="font-serif text-3xl font-bold">Customers</h1>
        </div>
        <Button asChild size="sm">
          <Link href="/admin/customers/new">
            <Plus size={16} /> Add Customer
          </Link>
        </Button>
      </div>

      {/* Stats card */}
      <div className="bg-white border border-border rounded-lg p-6 mb-6 inline-flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-[#fafafa] flex items-center justify-center">
          <Users size={18} className="text-muted-foreground" />
        </div>
        <div>
          <p className="text-2xl font-semibold">{customers?.length ?? 0}</p>
          <p className="text-sm text-muted-foreground">Active Customers</p>
        </div>
      </div>

      {/* Customers Table */}
      <div className="bg-white border border-border rounded-lg overflow-hidden shadow-sm">
        {customers && customers.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-[#fafafa]">
                <th className="text-left font-medium text-muted-foreground px-6 py-3">Name</th>
                <th className="text-left font-medium text-muted-foreground px-6 py-3 hidden sm:table-cell">Email</th>
                <th className="text-left font-medium text-muted-foreground px-6 py-3 hidden md:table-cell">Phone</th>
                <th className="text-left font-medium text-muted-foreground px-6 py-3 hidden lg:table-cell">Added</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-[#fafafa] transition-colors">
                  <td className="px-6 py-4">
                    <Link href={`/admin/customers/${c.id}`} className="block group">
                      <p className="font-medium group-hover:underline underline-offset-4">{c.name}</p>
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground hidden sm:table-cell">
                    {c.email ?? <span className="text-border">—</span>}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground hidden md:table-cell">
                    {c.phone ?? <span className="text-border">—</span>}
                  </td>
                  <td className="px-6 py-4 text-muted-foreground hidden lg:table-cell">
                    {new Date(c.created_at).toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link href={`/admin/customers/${c.id}`} className="inline-flex p-2 -mr-2 text-muted-foreground hover:text-foreground rounded-[12px] hover:bg-[#fafafa] transition-colors">
                      <ChevronRight size={16} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-6 py-16 text-center">
            <Users size={32} className="text-border mx-auto mb-3" />
            <p className="font-medium mb-1">No customers yet</p>
            <p className="text-sm text-muted-foreground mb-6">
              Add your first customer to get started.
            </p>
            <Button asChild size="sm">
              <Link href="/admin/customers/new">
                <Plus size={16} /> Add Customer
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
