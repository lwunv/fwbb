import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminMobileNav } from "@/components/layout/admin-mobile-nav";
import { AdminDefaultTheme } from "@/components/shared/admin-default-theme";
import { getAdminFromCookie } from "@/lib/auth";
import { getAppName } from "@/actions/settings";
import { countPendingGroupMembers } from "./members/pending-queue";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth-gate cho mọi /admin/* (trừ /admin/login) đã thực thi ở
  // `src/proxy.ts` (Next 16 middleware) — verify JWT HS256 + role==='admin',
  // fail-closed (thiếu JWT_SECRET → throw lúc load), cover cả RSC data path
  // (/_next/data/.../admin...). Request không có cookie hợp lệ bị redirect 302
  // về /admin/login TRƯỚC khi tới layout/page. Layout này chỉ chạy cho
  // authenticated admin; login page render riêng (children) không sidebar.
  const admin = await getAdminFromCookie();

  if (!admin) {
    // Login page (middleware skip /admin/login) — render plain children.
    return <>{children}</>;
  }

  // Chỉ đếm người đã xin vào nhóm; tài khoản giao lưu không làm nhảy số.
  const [appName, pendingMemberCount] = await Promise.all([
    getAppName(),
    countPendingGroupMembers(),
  ]);

  return (
    <div className="min-h-screen overflow-x-hidden">
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
