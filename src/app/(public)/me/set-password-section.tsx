"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fireAction } from "@/lib/optimistic-action";
import { setPassword } from "@/actions/password-auth";

interface Props {
  hasPassword: boolean;
  hasEmail: boolean;
}

/**
 * Card cho user (đăng nhập qua OAuth) đặt mật khẩu để có thể login email/password
 * lần sau. Khi đã có password, hiển thị form đổi mật khẩu.
 *
 * Yêu cầu user có email — OAuth Facebook scope `public_profile` không cho email
 * nên một số FB user không có; họ cần cập nhật email trước.
 */
export function SetPasswordSection({ hasPassword, hasEmail }: Props) {
  const t = useTranslations("me.setPassword");
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasEmail && !email.trim()) {
      toast.error(t("emailRequired"));
      return;
    }
    if (newPassword.length < 8) {
      toast.error(t("tooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("mismatch"));
      return;
    }
    setSaving(true);
    fireAction(
      () =>
        setPassword({
          currentPassword: hasPassword ? currentPassword : undefined,
          newPassword,
          email: !hasEmail ? email.trim() : undefined,
        }),
      () => setSaving(false),
      {
        successMsg: hasPassword ? t("successChange") : t("successSet"),
        onSuccess: () => {
          setSaving(false);
          setExpanded(false);
          setEmail("");
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
      },
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="hover:bg-muted/30 -m-2 flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors"
        >
          <div className="bg-primary/10 rounded-lg p-2">
            <Lock className="text-primary h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {hasPassword ? t("titleChange") : t("titleSet")}
            </p>
            <p className="text-muted-foreground text-sm">
              {hasPassword ? t("descChange") : t("descSet")}
            </p>
          </div>
        </button>

        {expanded && (
          <form onSubmit={handleSubmit} className="mt-4 space-y-2.5">
            {!hasEmail && (
              <Input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                maxLength={200}
                autoComplete="email"
                disabled={saving}
                required
              />
            )}
            {hasPassword && (
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t("currentPlaceholder")}
                autoComplete="current-password"
                disabled={saving}
                required
              />
            )}
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={
                hasPassword ? t("newPlaceholderChange") : t("newPlaceholderSet")
              }
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              disabled={saving}
              required
            />
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("confirmPlaceholder")}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              disabled={saving}
              required
            />
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setExpanded(false)}
                disabled={saving}
                className="flex-1"
                size="sm"
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="flex-1"
                size="sm"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {hasPassword ? t("submitChange") : t("submitSet")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
