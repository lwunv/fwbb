import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getMyExchanges } from "@/actions/exchange-mine";
import { getSettings } from "@/actions/settings";
import { NotificationPrefsSection } from "@/components/notifications/notification-prefs-section";
import { getExchangeViewer } from "@/lib/member-auth";
import { ExchangeAccountCard } from "../account-card";
import { MyExchanges } from "./my-exchanges";

/**
 * "Giao lưu của tôi". Cờ tắt đã 404 ở layout /exchanges, nên trong trang này
 * cờ luôn bật: truyền thẳng `exchangeEnabled` cho cài đặt thông báo để người
 * ngoài nhóm tắt được nhóm tin giao lưu và xác minh email. Dữ liệu đọc một lần
 * ở server rồi truyền xuống; client không tự tải lại.
 */
export default async function MyExchangesPage() {
  const [t, viewer] = await Promise.all([
    getTranslations("exchange.mine"),
    getExchangeViewer(),
  ]);
  if (viewer.status === "anonymous") {
    redirect(`/exchanges/login?next=${encodeURIComponent("/exchanges/mine")}`);
  }
  if (viewer.status === "blocked") redirect("/exchanges");

  const [data, settings] = await Promise.all([getMyExchanges(), getSettings()]);
  const { member, isGroupMember } = viewer;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      {!isGroupMember && (
        <ExchangeAccountCard
          memberId={member.id}
          name={member.name}
          avatarUrl={member.avatarUrl}
          avatarKey={member.avatarKey}
          requested={member.signupIntent === "group"}
        />
      )}

      {"error" in data ? (
        <div className="space-y-3">
          <p role="alert" className="text-destructive text-base">
            {t("loadFailed")}
          </p>
          <Link
            href="/exchanges"
            className="bg-primary text-primary-foreground flex min-h-12 w-full items-center justify-center rounded-xl text-base font-medium sm:w-auto sm:px-6"
          >
            {t("browse")}
          </Link>
        </div>
      ) : (
        <MyExchanges
          registrations={data.registrations}
          hosting={data.hosting}
          blocks={data.blocks}
          myCode={data.myCode}
        />
      )}

      {settings.notificationsEnabled && (
        <NotificationPrefsSection scope="member" exchangeEnabled />
      )}
    </div>
  );
}
