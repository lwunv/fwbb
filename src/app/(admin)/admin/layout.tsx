import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminMobileNav } from "@/components/layout/admin-mobile-nav";
import { getAdminFromCookie } from "@/lib/auth";
import { getAppName } from "@/actions/settings";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminFromCookie();

  // If not authenticated (login page), render children without sidebar
  if (!admin) {
    return <>{children}</>;
  }

  const appName = await getAppName();

  return (
    <div className="min-h-screen">
      <AdminSidebar appName={appName} />
      <AdminMobileNav appName={appName} />
      <main className="lg:ml-60 p-4 md:p-6">
        {children}
      </main>
    </div>
  );
}
