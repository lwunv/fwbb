import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentAdmin } from "@/actions/auth";
import { PasswordChangeForm } from "../dashboard/password-change-form";
import { AdminProfileForm } from "./admin-profile-form";
import { AdminGoogleLink } from "./admin-google-link";
import { NotificationPrefsSection } from "@/components/notifications/notification-prefs-section";
import { getSettings } from "@/actions/settings";

export default async function AdminAccountPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  const t = await getTranslations("adminAccount");
  const notificationsEnabled = (await getSettings()).notificationsEnabled;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
      <AdminProfileForm
        username={admin.username}
        email={admin.email ?? ""}
        phoneNumber={admin.phoneNumber ?? ""}
      />
      {notificationsEnabled && <NotificationPrefsSection scope="admin" />}
      <PasswordChangeForm />
      <AdminGoogleLink hasGoogle={!!admin.googleId} />
    </div>
  );
}
