"use client";

import { useState } from "react";
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
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasEmail && !email.trim()) {
      toast.error("Vui lòng nhập email");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Mật khẩu phải từ 8 ký tự trở lên");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Mật khẩu xác nhận không khớp");
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
        successMsg: hasPassword
          ? "Đã đổi mật khẩu"
          : "Đã đặt mật khẩu. Lần sau có thể login bằng email + mật khẩu.",
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
              {hasPassword ? "Đổi mật khẩu" : "Đặt mật khẩu"}
            </p>
            <p className="text-muted-foreground text-xs">
              {hasPassword
                ? "Đổi mật khẩu hiện tại"
                : "Cho phép login bằng email + mật khẩu"}
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
                placeholder="Email"
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
                placeholder="Mật khẩu hiện tại"
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
                hasPassword
                  ? "Mật khẩu mới (≥ 8 ký tự)"
                  : "Mật khẩu (≥ 8 ký tự)"
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
              placeholder="Xác nhận mật khẩu"
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
                Hủy
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="flex-1"
                size="sm"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {hasPassword ? "Đổi" : "Đặt mật khẩu"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
