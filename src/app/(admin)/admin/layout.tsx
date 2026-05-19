import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminMobileNav } from "@/components/layout/admin-mobile-nav";
import { AdminDefaultTheme } from "@/components/shared/admin-default-theme";
import { getAdminFromCookie } from "@/lib/auth";
import { getAppName } from "@/actions/settings";
import { db } from "@/db";
import { members as membersTable } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth-gate cho mọi /admin/* (trừ /admin/login) đã thực thi ở
  // `src/middleware.ts` — request không có cookie hợp lệ bị redirect 302 về
  // /admin/login TRƯỚC khi tới layout/page. Layout này chỉ chạy cho
  // authenticated admin; login page render riêng (children) không sidebar.
  const admin = await getAdminFromCookie();

  if (!admin) {
    // Login page (middleware skip /admin/login) — render plain children.
    return <>{children}</>;
  }

  const [appName, pendingCountRows] = await Promise.all([
    getAppName(),
    db
      .select({ c: sql<number>`count(*)` })
      .from(membersTable)
      .where(eq(membersTable.approvalStatus, "pending")),
  ]);
  const pendingMemberCount = Number(pendingCountRows[0]?.c ?? 0);

  return (
    <div className="min-h-screen">
      <AdminDefaultTheme />
      <AdminSidebar appName={appName} pendingMemberCount={pendingMemberCount} />
      <AdminMobileNav
        appName={appName}
        pendingMemberCount={pendingMemberCount}
      />
      <main className="p-4 pb-24 md:p-6 lg:ml-60">{children}</main>
    </div>
  );
}
