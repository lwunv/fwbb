import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Lock } from "lucide-react";
import { getExchangeViewer } from "@/lib/member-auth";
import { getMyLastPayout } from "@/actions/exchange-events";
import { EmptyState } from "@/components/shared/empty-state";
import { EventForm } from "./event-form";

/**
 * Mở buổi giao lưu. Cờ tắt đã 404 ở layout /exchanges. Khách đi đăng nhập rồi
 * quay lại; tài khoản chưa vào nhóm chỉ thấy lời giải thích (server action vẫn
 * tự kiểm quyền, trang này chỉ để người dùng khỏi điền form vô ích).
 */
export default async function OpenEventPage() {
  const [t, viewer] = await Promise.all([
    getTranslations("exchange.form"),
    getExchangeViewer(),
  ]);

  if (viewer.status === "anonymous") {
    redirect(`/exchanges/login?next=${encodeURIComponent("/exchanges/new")}`);
  }
  if (viewer.status === "blocked") redirect("/exchanges");

  const back = (
    <Link
      href="/exchanges"
      className="text-muted-foreground inline-flex min-h-11 items-center gap-1 text-base"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t("back")}
    </Link>
  );

  if (!viewer.isGroupMember) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {back}
        <EmptyState
          icon={Lock}
          title={t("notApprovedTitle")}
          description={t("notApprovedBody")}
          action={
            <Link
              href="/exchanges"
              className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-base font-medium"
            >
              {t("back")}
            </Link>
          }
        />
      </div>
    );
  }

  const payout = await getMyLastPayout();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-36 sm:pb-0">
      {back}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>
        <p className="text-muted-foreground text-base">{t("pageIntro")}</p>
      </div>
      <EventForm initialPayout={payout} />
    </div>
  );
}
