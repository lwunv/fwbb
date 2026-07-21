import { getTranslations } from "next-intl/server";
import { AdminForgotPasswordForm } from "./admin-forgot-password-form";

export default async function AdminForgotPasswordPage() {
  const t = await getTranslations("passwordReset");
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">{t("forgotTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("forgotIntro")}</p>
      </div>
      <AdminForgotPasswordForm />
    </div>
  );
}
