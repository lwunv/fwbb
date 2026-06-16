import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { validateResetToken } from "@/actions/password-auth";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params; // Next 16: params is a Promise
  const t = await getTranslations("passwordReset");
  const { status } = await validateResetToken({ token });

  if (status !== "valid") {
    return (
      <div className="space-y-4 text-center">
        <div className="text-4xl">⏰</div>
        <h1 className="text-lg font-bold">{t("expiredTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("expiredBody")}</p>
        <Link
          href="/forgot-password"
          className="text-primary inline-block text-sm underline underline-offset-2"
        >
          {t("btnRequestAgain")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t("resetTitle")}</h1>
      <ResetPasswordForm token={token} />
    </div>
  );
}
