import { getUserFromCookie } from "@/lib/user-identity";
import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Header } from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { FacebookLoginGate } from "./facebook-login-gate";
import { getAppName } from "@/actions/settings";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, appName] = await Promise.all([getUserFromCookie(), getAppName()]);

  // If user is not identified, show the Facebook login gate
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header appName={appName} />
        <main className="flex-1 flex items-center justify-center p-4">
          <FacebookLoginGate appName={appName} />
        </main>
      </div>
    );
  }

  // If user exists, check if their member is still active
  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
  });

  if (!member || !member.isActive) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header appName={appName} />
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="text-center max-w-sm space-y-4">
            <div className="text-4xl">🚫</div>
            <h2 className="text-xl font-bold">Tài khoản bị vô hiệu hóa</h2>
            <p className="text-muted-foreground">
              Tài khoản của bạn đã bị vô hiệu hóa. Liên hệ admin để được hỗ trợ.
            </p>
            <form action={async () => {
              "use server";
              const { clearUserCookie } = await import("@/lib/user-identity");
              await clearUserCookie();
            }}>
              <button
                type="submit"
                className="text-sm text-primary underline underline-offset-2"
              >
                Đăng nhập lại với tài khoản khác
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header appName={appName} />
      <main className="flex-1 pb-20 px-4 py-4">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
