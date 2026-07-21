"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { requestPasswordReset } from "@/actions/password-reset";

export function AdminForgotPasswordForm() {
  const t = useTranslations("passwordReset");
  const [email, setEmail] = useState("");
  // Message comes straight from the server action — it ALWAYS resolves to
  // the same neutral copy regardless of whether the email exists, so there
  // is no error branch to handle here (that would defeat the
  // anti-enumeration guarantee in requestPasswordReset).
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await requestPasswordReset({ email, scope: "admin" });
      setMessage(result.message);
    });
  }

  if (message) {
    return (
      <div className="space-y-4">
        <p className="text-sm">{message}</p>
        <Link
          href="/admin/login"
          className="text-primary inline-block text-sm underline underline-offset-2"
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
        href="/admin/login"
        className="text-muted-foreground block text-center text-sm underline underline-offset-2"
      >
        {t("backToLogin")}
      </Link>
    </form>
  );
}
