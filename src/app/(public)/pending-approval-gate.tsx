"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fireAction } from "@/lib/optimistic-action";
import { updatePendingProfile, pendingLogout } from "@/actions/member-approval";
import { usePolling } from "@/lib/use-polling";

interface Props {
  memberName: string;
  nickname: string | null;
  phoneNumber: string | null;
  bankAccountNo: string | null;
}

/**
 * Hiển thị cho user vừa OAuth signup nhưng admin chưa duyệt. Cho phép họ
 * nhập optional fields (nickname / phone / bank) để admin matching dễ hơn.
 * Block toàn bộ app cho đến khi approved.
 */
export function PendingApprovalGate({
  memberName,
  nickname: initialNickname,
  phoneNumber: initialPhone,
  bankAccountNo: initialBank,
}: Props) {
  const t = useTranslations("pendingApproval");
  const [nickname, setNickname] = useState(initialNickname ?? "");
  const [phoneNumber, setPhoneNumber] = useState(initialPhone ?? "");
  const [bankAccountNo, setBankAccountNo] = useState(initialBank ?? "");
  const [saving, setSaving] = useState(false);

  // Tự phát hiện khi admin duyệt: poll router.refresh() mỗi 5s → (public)
  // layout re-run; khi approvalStatus thành 'approved' nó render thẳng app →
  // user vào nhóm KHÔNG cần F5. Form state (useState) được giữ qua soft-refresh.
  usePolling();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    fireAction(
      () =>
        updatePendingProfile({
          nickname: nickname.trim() || null,
          phoneNumber: phoneNumber.trim() || null,
          bankAccountNo: bankAccountNo.trim() || null,
        }),
      () => setSaving(false),
      {
        successMsg: t("toastSaved"),
        onSuccess: () => setSaving(false),
      },
    );
  }

  function handleLogout() {
    fireAction(() => pendingLogout(), undefined, {
      successMsg: t("toastLoggedOut"),
    });
  }

  return (
    <Card className="w-full max-w-md">
      <CardContent className="space-y-5 p-6">
        <div className="space-y-3 text-center">
          <div className="bg-primary/10 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
            <Clock className="text-primary h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("subtitle", { name: memberName })}
          </p>
          <p className="text-muted-foreground text-xs">{t("body")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-foreground/80 mb-1 block text-sm font-medium">
              {t("labelNickname")}{" "}
              <span className="text-muted-foreground">{t("optional")}</span>
            </label>
            <Input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t("placeholderNickname")}
              maxLength={64}
              disabled={saving}
            />
          </div>
          <div>
            <label className="text-foreground/80 mb-1 block text-sm font-medium">
              {t("labelPhone")}{" "}
              <span className="text-muted-foreground">{t("optional")}</span>
            </label>
            <Input
              type="tel"
              inputMode="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="0901 234 567"
              maxLength={20}
              disabled={saving}
            />
          </div>
          <div>
            <label className="text-foreground/80 mb-1 block text-sm font-medium">
              {t("labelBank")}{" "}
              <span className="text-muted-foreground">{t("optional")}</span>
            </label>
            <Input
              type="text"
              inputMode="numeric"
              value={bankAccountNo}
              onChange={(e) =>
                setBankAccountNo(e.target.value.replace(/[^\d]/g, ""))
              }
              placeholder={t("placeholderBank")}
              maxLength={32}
              disabled={saving}
            />
            <p className="text-muted-foreground mt-1 text-xs">
              {t("bankHint")}
            </p>
          </div>

          <Button
            type="submit"
            disabled={saving}
            className="w-full py-3 text-base"
            size="lg"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("btnSave")}
          </Button>
        </form>

        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={handleLogout}
            disabled={saving}
            className="text-muted-foreground inline-flex min-h-11 items-center px-2 text-sm underline underline-offset-2 disabled:opacity-50"
          >
            {t("logoutAndUseOtherAccount")}
          </button>
        </div>

        <p className="text-muted-foreground/80 border-t pt-3 text-center text-xs">
          {t("waitingNotice")}
        </p>
      </CardContent>
    </Card>
  );
}

// Toast import — sonner is already configured globally via Toaster.
// (Kept import-free to avoid unused-import lint; fireAction uses toast internally.)
void toast;
