"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Check, LogOut } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { fireAction } from "@/lib/optimistic-action";
import { pendingLogout } from "@/actions/member-approval";
import { JoinGroupButton } from "./join-group-button";

/**
 * Thẻ tài khoản của người đang chờ duyệt ở trang /exchanges. Tài khoản giao
 * lưu có nút xin vào nhóm; người đã xin (signupIntent "group") chỉ thấy nhãn
 * cố định, không có nút xin lại.
 */
export function ExchangeAccountCard({
  memberId,
  name,
  avatarUrl,
  avatarKey,
  requested,
}: {
  memberId: number;
  name: string;
  avatarUrl: string | null;
  avatarKey: string | null;
  requested: boolean;
}) {
  const t = useTranslations("exchange");
  const router = useRouter();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card className="bg-card/80 backdrop-blur">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <MemberAvatar
              memberId={memberId}
              avatarUrl={avatarUrl}
              avatarKey={avatarKey}
              size={48}
              className="shrink-0"
            />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">
                {t("accountTitle", { name })}
              </h2>
              <p className="text-muted-foreground text-base">
                {t("accountBody")}
              </p>
            </div>
          </div>

          {requested ? (
            <p
              role="status"
              className="bg-muted text-muted-foreground flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-medium"
            >
              <Check className="h-5 w-5" aria-hidden />
              {t("joinGroupSent")}
            </p>
          ) : (
            <JoinGroupButton />
          )}

          <button
            type="button"
            onClick={() =>
              fireAction(() => pendingLogout(), undefined, {
                successMsg: t("loggedOut"),
                onSuccess: () => router.refresh(),
              })
            }
            className="text-muted-foreground hover:text-foreground mx-auto flex min-h-11 items-center justify-center gap-2 px-3 text-base"
          >
            <LogOut className="h-5 w-5" aria-hidden />
            {t("logout")}
          </button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
