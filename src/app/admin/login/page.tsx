import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminLoginForm } from "@/components/admin/admin-login-form";

export const metadata: Metadata = {
  title: "Admin Login",
  robots: { index: false, follow: false },
};

/**
 * `AdminLoginForm` reads `redirectedFrom` via `useSearchParams()`, which forces
 * the route out of static prerendering unless it sits behind a Suspense
 * boundary. Without this the production build fails to export `/admin/login`.
 */
export default function AdminLoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-[#fafafa] px-7 py-16">
      <Suspense
        fallback={
          <div className="w-full max-w-md border border-[#ececee] bg-white px-7 py-10 sm:p-12">
            <div className="h-6 w-40 animate-pulse rounded-full bg-[#fafafa]" />
            <div className="mt-6 h-10 w-56 animate-pulse rounded-full bg-[#fafafa]" />
          </div>
        }
      >
        <AdminLoginForm />
      </Suspense>
    </main>
  );
}
