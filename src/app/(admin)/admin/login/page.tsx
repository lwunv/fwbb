"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { login } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null);
  const [showPassword, setShowPassword] = useState(false);
  const t = useTranslations("auth");

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/fwbb.svg"
            alt="FWBB"
            className="mx-auto mb-2 h-16 w-auto"
          />
          <CardTitle className="text-center text-2xl">FWBB Admin</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t("username")}</Label>
              <Input id="username" name="username" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("password")}</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={
                    showPassword ? t("hidePassword") : t("showPassword")
                  }
                  className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex h-full w-11 items-center justify-center transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="size-5" />
                  ) : (
                    <Eye className="size-5" />
                  )}
                </button>
              </div>
            </div>
            {state?.error && (
              <p className="text-destructive text-sm">{state.error}</p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? t("loggingIn") : t("login")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
