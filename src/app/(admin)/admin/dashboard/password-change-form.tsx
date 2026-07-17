"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { changePassword } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock, Eye, EyeOff, Check } from "lucide-react";

export function PasswordChangeForm() {
  const [state, formAction, isPending] = useActionState(changePassword, null);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const t = useTranslations("passwordChange");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {state?.success ? (
          <div className="flex items-center gap-2 py-2 text-sm text-blue-600">
            <Check className="h-4 w-4" />
            {t("success")}
          </div>
        ) : (
          <form action={formAction} className="space-y-3">
            {state?.error && (
              <div className="text-destructive bg-destructive/10 rounded-md p-2 text-sm">
                {state.error}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">{t("currentPassword")}</Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  name="currentPassword"
                  type={showCurrent ? "text" : "password"}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center"
                >
                  {showCurrent ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="newPassword">{t("newPassword")}</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  name="newPassword"
                  type={showNew ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center"
                >
                  {showNew ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            <Button
              type="submit"
              disabled={isPending}
              size="lg"
              className="w-full"
            >
              {isPending ? t("processing") : t("submit")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
