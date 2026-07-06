import { getUserFromCookie } from "@/lib/user-identity";
import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { PendingApprovalGate } from "./pending-approval-gate";
import { ForceChangePasswordGate } from "./force-change-password-gate";
import { ProductTourLauncher } from "@/components/tour/product-tour-launcher";
import { getAppName } from "@/actions/settings";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, appName, tPub] = await Promise.all([
    getUserFromCookie(),
    getAppName(),
    getTranslations("publicLayout"),
  ]);

  // Khách chưa đăng nhập: KHÔNG chặn cứng nữa — render shell + children để
  // trang chủ (lịch + số vote) xem được công khai. Các trang cá nhân
  // (/history, /stats, /me, /my-fund) tự redirect("/login") khi thiếu user;
  // form login nằm ở /login. Header hiện nút "Đăng nhập". Không bottom nav
  // cho khách (chưa có gì cá nhân để điều hướng).
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header appName={appName} showLogin />
        <main className="flex flex-1 flex-col px-4 py-4">{children}</main>
      </div>
    );
  }

  // If user exists, check if their member is still active
  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
  });

  if (!member || !member.isActive || member.approvalStatus === "rejected") {
    return (
      <div className="flex min-h-screen flex-col">
        <Header appName={appName} />
        <main className="flex flex-1 items-center justify-center p-4">
          <div className="max-w-sm space-y-4 text-center">
            <div className="text-4xl">🚫</div>
            <h2 className="text-xl font-bold">
              {tPub("accountDisabledTitle")}
            </h2>
            <p className="text-muted-foreground">
              {tPub("accountDisabledBody")}
            </p>
            <form
              action={async () => {
                "use server";
                const { clearUserCookie } = await import("@/lib/user-identity");
                await clearUserCookie();
              }}
            >
              <button
                type="submit"
                className="text-primary text-sm underline underline-offset-2"
              >
                {tPub("loginAgainOther")}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // Pending approval — show profile-collection form, gate everything else.
  if (member.approvalStatus === "pending") {
    return (
      <div className="flex min-h-screen flex-col">
        <Header appName={appName} />
        <main className="flex flex-1 items-center justify-center p-4">
          <PendingApprovalGate
            memberName={member.name}
            nickname={member.nickname}
            phoneNumber={member.phoneNumber}
            bankAccountNo={member.bankAccountNo}
          />
        </main>
      </div>
    );
  }

  // Admin vừa reset mật khẩu → bắt member đặt mật khẩu mới trước khi vào site.
  if (member.mustChangePassword) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header appName={appName} />
        <main className="flex flex-1 items-center justify-center p-4">
          <ForceChangePasswordGate />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header appName={appName} />
      <main className="flex-1 px-4 py-4 pb-20">{children}</main>
      <BottomNav />
      <ProductTourLauncher />
    </div>
  );
}
