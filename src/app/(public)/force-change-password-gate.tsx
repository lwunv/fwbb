"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Loader2 } from "lucide-react";
import { setPassword } from "@/actions/password-auth";

/**
 * Chặn toàn bộ site sau khi admin reset mật khẩu: member login bằng mật khẩu
 * tạm PHẢI đặt mật khẩu mới ngay tại đây mới vào được. setPassword ở chế độ
 * force-change không cần current password và tự clear cờ must_change_password.
 */
export function ForceChangePasswordGate() {
  const t = useTranslations("forceChangePassword");
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError(t("tooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("mismatch"));
      return;
    }
    setSaving(true);
    (async () => {
      const r = await setPassword({ newPassword });
      if (r && "error" in r && r.error) {
        setError(r.error);
        setSaving(false);
        return;
      }
      toast.success(t("success"));
      router.refresh();
    })();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="bg-primary/10 rounded-full p-3">
            <Lock className="text-primary h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("body")}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-2.5">
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t("newPlaceholder")}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            disabled={saving}
            required
            autoFocus
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
          {error && (
            <p className="text-destructive text-center text-xs">{error}</p>
          )}
          <Button type="submit" disabled={saving} className="w-full" size="lg">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
