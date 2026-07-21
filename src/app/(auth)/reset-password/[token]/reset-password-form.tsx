"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { resetPasswordWithToken } from "@/actions/password-reset";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("passwordReset");
  const tAuth = useTranslations("passwordAuth"); // reuse show/hide labels
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  // TOCTOU: the token can die (used/expired) between render and submit —
  // switch to the same expired screen the server renders, not just a toast.
  const [expired, setExpired] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw !== confirm) {
      setError(t("errMismatch"));
      return;
    }
    startTransition(async () => {
      const result = await resetPasswordWithToken({
        token,
        newPassword: pw,
      });
      if ("success" in result) {
        toast.success(t("successReset"));
        // Cookie already cleared server-side (member) — this always lands on
        // the login gate. Admin subject goes back to the admin login screen.
        router.push(result.subject === "admin" ? "/admin/login" : "/");
        return;
      }
      if ("tokenError" in result) {
        setExpired(true);
        return;
      }
      setError(result.passwordError);
    });
  }

  if (expired) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-lg font-bold">{t("expiredTitle")}</h2>
        <Link
          href="/forgot-password"
          className="text-primary inline-flex min-h-11 items-center justify-center text-sm underline underline-offset-2"
        >
          {t("btnRequestAgain")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder={t("newPassword")}
          maxLength={128}
          disabled={isPending}
          required
          className="pr-11"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="text-muted-foreground absolute inset-y-0 right-2 inline-flex h-full w-11 items-center justify-center"
          tabIndex={-1}
          aria-label={show ? tAuth("hidePassword") : tAuth("showPassword")}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <Input
        type={show ? "text" : "password"}
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={t("confirmPassword")}
        maxLength={128}
        disabled={isPending}
        required
      />
      {error && <p className="text-destructive text-center text-xs">{error}</p>}
      <Button type="submit" disabled={isPending} className="w-full" size="lg">
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("btnReset")}
      </Button>
    </form>
  );
}
