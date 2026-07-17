"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updateAdminProfile } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserCog, Check } from "lucide-react";

export function AdminProfileForm({
  username,
  email,
  phoneNumber,
}: {
  username: string;
  email: string;
  phoneNumber: string;
}) {
  const [state, formAction, isPending] = useActionState(
    updateAdminProfile,
    null,
  );
  const t = useTranslations("adminAccount");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCog className="h-5 w-5" />
          {t("profileCardTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-3">
          {state?.error && (
            <div className="text-destructive bg-destructive/10 rounded-md p-2 text-sm">
              {state.error}
            </div>
          )}
          {state?.success && (
            <div className="flex items-center gap-2 py-1 text-sm text-blue-600">
              <Check className="h-4 w-4" />
              {t("saved")}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="username">{t("usernameLabel")}</Label>
            <Input
              id="username"
              name="username"
              defaultValue={username}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">{t("emailLabel")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              defaultValue={email}
              placeholder={t("emailPlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phoneNumber">{t("phoneLabel")}</Label>
            <Input
              id="phoneNumber"
              name="phoneNumber"
              type="tel"
              inputMode="tel"
              defaultValue={phoneNumber}
              placeholder={t("phonePlaceholder")}
            />
          </div>

          <Button
            type="submit"
            disabled={isPending}
            size="lg"
            className="w-full"
          >
            {isPending ? t("saving") : t("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
