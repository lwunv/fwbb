"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { loginWithPassword, signupWithPassword } from "@/actions/password-auth";

type Mode = "login" | "signup";

/**
 * Email/password form — login + signup tabs. Hiển thị dưới OAuth buttons
 * trong FacebookLoginGate. Sau khi submit thành công, layout sẽ re-render
 * (revalidatePath) và route user theo approvalStatus.
 */
export function PasswordAuthForm() {
  const t = useTranslations("passwordAuth");
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [bankAccountNo, setBankAccountNo] = useState("");
  const [withPartner, setWithPartner] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError(
        mode === "login" ? t("errMissingIdentifier") : t("errMissingFields"),
      );
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError(t("errMissingName"));
      return;
    }

    startTransition(async () => {
      const result =
        mode === "login"
          ? await loginWithPassword({ identifier: email, password })
          : await signupWithPassword({
              email,
              password,
              name: name.trim(),
              nickname: nickname.trim() || undefined,
              phoneNumber: phoneNumber.trim() || undefined,
              bankAccountNo: bankAccountNo.trim() || undefined,
              defaultWithPartner: withPartner,
            });
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      // Success → cookie đã set server-side. revalidatePath chỉ xoá cache
      // server, KHÔNG tự re-render (public) layout phía client → user kẹt
      // ở form login, không thấy màn "chờ duyệt". router.refresh() ép full
      // route re-render với cookie mới: pending → PendingApprovalGate,
      // approved → app. (Cùng pattern usePolling trong pending gate.)
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {/* Tab switcher */}
      <div className="bg-muted inline-flex w-full rounded-lg p-0.5">
        <button
          type="button"
          onClick={() => {
            setMode("login");
            setError("");
          }}
          disabled={isPending}
          className={`min-h-11 flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "login"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground"
          }`}
        >
          {t("tabLogin")}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("signup");
            setError("");
          }}
          disabled={isPending}
          className={`min-h-11 flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "signup"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground"
          }`}
        >
          {t("tabSignup")}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2.5">
        {mode === "signup" && (
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("placeholderName")}
            maxLength={100}
            autoComplete="name"
            disabled={isPending}
            required
          />
        )}

        {/* Login: 1 ô định danh đa kênh (username/sđt/email). Signup: email. */}
        <Input
          type={mode === "login" ? "text" : "email"}
          inputMode={mode === "login" ? "text" : "email"}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={
            mode === "login"
              ? t("placeholderIdentifier")
              : t("placeholderEmail")
          }
          maxLength={200}
          autoComplete={mode === "login" ? "username" : "email"}
          disabled={isPending}
          required
        />

        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("placeholderPassword")}
            maxLength={128}
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            disabled={isPending}
            required
            className="pr-11"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="text-muted-foreground absolute inset-y-0 right-2 inline-flex h-full w-11 items-center justify-center"
            aria-label={showPassword ? t("hidePassword") : t("showPassword")}
            tabIndex={-1}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>

        {mode === "signup" && (
          <>
            <Input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t("placeholderNickname")}
              maxLength={64}
              disabled={isPending}
            />
            <Input
              type="tel"
              inputMode="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder={t("placeholderPhone")}
              maxLength={20}
              disabled={isPending}
            />
            <Input
              type="text"
              inputMode="numeric"
              value={bankAccountNo}
              onChange={(e) =>
                setBankAccountNo(e.target.value.replace(/[^\d]/g, ""))
              }
              placeholder={t("placeholderBank")}
              maxLength={32}
              disabled={isPending}
            />
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={withPartner}
                onChange={(e) => setWithPartner(e.target.checked)}
                disabled={isPending}
                className="accent-primary h-5 w-5 rounded"
              />
              {t("signupWithPartner")}
            </label>
          </>
        )}

        {error && (
          <p className="text-destructive text-center text-sm">{error}</p>
        )}

        <Button type="submit" disabled={isPending} className="w-full" size="lg">
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "login" ? t("btnLogin") : t("btnSignup")}
        </Button>
      </form>
    </div>
  );
}
