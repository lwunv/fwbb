"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { requestPasswordReset } from "@/actions/password-auth";

export function ForgotPasswordForm() {
  const t = useTranslations("passwordReset");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      await requestPasswordReset({ email });
      setSent(true); // neutral — always show the same confirmation
    });
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <p className="text-sm">{t("neutralSent")}</p>
        <p className="text-muted-foreground text-xs">{t("noEmailHint")}</p>
        <Link
          href="/"
          className="text-primary text-sm underline underline-offset-2"
        >
          {t("backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("emailPlaceholder")}
        maxLength={200}
        disabled={isPending}
        required
      />
      <Button type="submit" disabled={isPending} className="w-full" size="lg">
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("btnSend")}
      </Button>
      <Link
        href="/"
        className="text-muted-foreground block text-center text-sm underline underline-offset-2"
      >
        {t("backToLogin")}
      </Link>
    </form>
  );
}
