import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminMobileNav } from "@/components/layout/admin-mobile-nav";
import { getAdminFromCookie } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminFromCookie();

  // If not authenticated (login page), render children without sidebar
  if (!admin) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen">
      <AdminSidebar />
      <AdminMobileNav />
      <main className="lg:ml-60 p-4 md:p-6">
        {children}
      </main>
    </div>
  );
}
