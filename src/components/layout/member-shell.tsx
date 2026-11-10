import { getUserFromCookie } from "@/lib/user-identity";
import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/header";
import { PendingApprovalGate } from "@/app/(public)/pending-approval-gate";
import { ForceChangePasswordGate } from "@/app/(public)/force-change-password-gate";
import { ExchangeAccountNotice } from "@/app/(public)/exchange-account-notice";
import { getAppName, getSettings } from "@/actions/settings";
import { isExchangeEnabled } from "@/lib/exchange-flag";

/**
 * Cờ tắt thì KHÔNG truyền prop nào cho Header: cây render y hệt trước N1.
 */
const bellProps = (on: boolean) => (on ? { showBell: true } : {});

/**
 * Khung chung cho layout của member: chọn màn theo người xem (khách, bị khoá,
 * chờ duyệt, phải đổi mật khẩu, đã duyệt). `mode="group"` bọc trang của nhóm
 * ((public)), `mode="exchange"` bọc vùng giao lưu ((exchange), gồm /venues).
 *
 * Khi cờ giao lưu tắt, hai mode cho ra cùng một màn cho mọi người xem, nên
 * /venues chạy y như lúc còn nằm trong (public). Cờ chỉ được đọc khi nó có thể
 * đổi kết quả (khách ở mode exchange, member đang chờ duyệt), để member đã
 * duyệt không tốn thêm lần đọc settings.
 */
export async function MemberShell({
  mode,
  children,
}: {
  mode: "group" | "exchange";
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
    // Vùng giao lưu có trang đăng nhập riêng (Zalo/Google) khi cờ bật.
    const exchangeLogin = mode === "exchange" && (await isExchangeEnabled());
    return (
      <div className="flex min-h-screen flex-col">
        {exchangeLogin ? (
          <Header appName={appName} showLogin loginHref="/exchanges/login" />
        ) : (
          <Header appName={appName} showLogin />
        )}
        <main className="flex flex-1 flex-col px-3 py-4 sm:px-4">
          {children}
        </main>
      </div>
    );
  }

  // If user exists, check if their member is still active
  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
  });

  if (!member || !member.isActive || member.approvalStatus === "rejected") {
    // Member bị từ chối vẫn xem được tin tài khoản (lý do từ chối); tài khoản
    // bị khoá thì không có chuông.
    const rejectedBell =
      !!member?.isActive && (await getSettings()).notificationsEnabled;
    return (
      <div className="flex min-h-screen flex-col">
        <Header appName={appName} {...bellProps(rejectedBell)} />
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
                className="text-primary inline-flex min-h-11 items-center justify-center px-3 text-sm underline underline-offset-2"
              >
                {tPub("loginAgainOther")}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  const isPending = member.approvalStatus === "pending";
  const exchangeOn = isPending && (await isExchangeEnabled());

  // Chờ duyệt — show profile-collection form, gate everything else. Cờ tắt thì
  // mọi member chờ duyệt vào đây như trước g2a (kể cả khi phải đổi mật khẩu).
  // Cờ bật thì chỉ người xin vào nhóm, đang ở trang của nhóm.
  if (
    isPending &&
    (!exchangeOn || (member.signupIntent === "group" && mode === "group"))
  ) {
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

  // Tới đây member chờ duyệt chắc chắn có cờ bật.
  if (isPending) {
    if (mode === "group") {
      // Chỉ còn tài khoản giao lưu (intent "exchange") mở trang của nhóm.
      return (
        <div className="flex min-h-screen flex-col">
          <Header appName={appName} />
          <main className="flex flex-1 items-center justify-center p-4">
            <ExchangeAccountNotice memberName={member.name} />
          </main>
        </div>
      );
    }
    const showBell = (await getSettings()).notificationsEnabled;
    return (
      <div className="flex min-h-screen flex-col">
        <Header
          appName={appName}
          showMenu
          navItems="exchange"
          homeHref="/exchanges"
          {...bellProps(showBell)}
        />
        <main className="flex-1 px-3 py-4 pb-6 sm:px-4">{children}</main>
      </div>
    );
  }

  // Chỉ cờ bật/tắt, KHÔNG đếm chưa đọc ở server: trang chủ có AutoRefresh 30s
  // làm render lại layout, đếm ở đây sẽ thành truy vấn định kỳ.
  // `getSettings` dedup trong request nên đọc cờ giao lưu ở đây không thêm truy vấn.
  const settings = await getSettings();
  const showBell = settings.notificationsEnabled;
  return (
    <div className="flex min-h-screen flex-col">
      <Header
        appName={appName}
        showMenu
        {...bellProps(showBell)}
        {...(settings.exchangeEnabled ? { exchangeEnabled: true } : {})}
      />
      <main className="flex-1 px-3 py-4 pb-6 sm:px-4">{children}</main>
    </div>
  );
}
