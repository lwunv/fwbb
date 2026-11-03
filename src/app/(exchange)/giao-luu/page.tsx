import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarClock, MapPinned } from "lucide-react";
import { getExchangeViewer } from "@/lib/member-auth";
import { EmptyState } from "@/components/shared/empty-state";
import { ExchangeAccountCard } from "./account-card";

/**
 * Trang chủ vùng giao lưu. Cờ tắt đã 404 ở layout. Khách thấy nút đăng nhập
 * dính đáy; tài khoản chờ duyệt thấy thẻ tài khoản; thành viên đã duyệt chỉ
 * thấy phần giới thiệu.
 */
export default async function ExchangePage() {
  const [t, viewer] = await Promise.all([
    getTranslations("exchange"),
    getExchangeViewer(),
  ]);

  const pendingMember =
    viewer.status === "ok" && !viewer.isGroupMember ? viewer.member : null;
  const isGuest = viewer.status === "anonymous";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 pb-24 sm:pb-0">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground text-base">{t("intro")}</p>
      </div>

      {pendingMember && (
        <ExchangeAccountCard
          memberId={pendingMember.id}
          name={pendingMember.name}
          avatarUrl={pendingMember.avatarUrl}
          avatarKey={pendingMember.avatarKey}
          requested={pendingMember.signupIntent === "group"}
        />
      )}

      <EmptyState
        icon={CalendarClock}
        title={t("emptyTitle")}
        description={t("emptyBody")}
        action={
          <Link
            href="/san"
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-base font-medium"
          >
            <MapPinned className="h-5 w-5" aria-hidden />
            {t("viewVenues")}
          </Link>
        }
      />

      {isGuest && (
        <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
          <Link
            href={`/giao-luu/dang-nhap?next=${encodeURIComponent("/giao-luu")}`}
            className="bg-primary text-primary-foreground flex min-h-12 w-full items-center justify-center rounded-xl text-base font-medium sm:w-auto sm:px-6"
          >
            {t("loginCta")}
          </Link>
        </div>
      )}
    </div>
  );
}
