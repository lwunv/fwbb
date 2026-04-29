import { getUserFromCookie } from "@/lib/user-identity";
import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { FacebookLoginGate } from "./facebook-login-gate";
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

  // If user is not identified, show the Facebook login gate
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header appName={appName} />
        <main className="flex flex-1 items-center justify-center p-4">
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

  return (
    <div className="flex min-h-screen flex-col">
      <Header appName={appName} />
      <main className="flex-1 px-4 py-4 pb-20">{children}</main>
      <BottomNav />
    </div>
  );
}
