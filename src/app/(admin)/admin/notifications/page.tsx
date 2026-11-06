import { getTranslations } from "next-intl/server";
import { getAdminDebtNotifications } from "@/actions/admin-notifications";
import { NotificationsClient } from "./notifications-client";

/**
 * Trang thông báo admin (yêu cầu user 6/11/2026). Dữ liệu tính từ sổ cái ở
 * server mỗi lần mở trang; lọc / tìm / phân trang làm ở client.
 */
export default async function AdminNotificationsPage() {
  const [t, data] = await Promise.all([
    getTranslations("adminNotifications"),
    getAdminDebtNotifications(),
  ]);

  if ("error" in data) {
    return (
      <p className="text-destructive py-8 text-center text-base">
        {t("loadError")}
      </p>
    );
  }

  return <NotificationsClient {...data} />;
}
