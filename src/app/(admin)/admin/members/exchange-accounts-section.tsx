"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { Lock, LockOpen, ChevronDown, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { fireAction } from "@/lib/optimistic-action";
import { formatSessionDate } from "@/lib/date-format";
import { toggleMemberActive } from "@/actions/members";

export interface ExchangeAccount {
  id: number;
  name: string;
  avatarKey: string | null;
  avatarUrl: string | null;
  createdAt: string | null;
  isActive: boolean;
  providers: string[];
}

const PROVIDER_LABEL: Record<string, string> = {
  google: "Google",
  facebook: "Facebook",
  zalo: "Zalo",
};

/**
 * Mục chỉ đọc cho tài khoản giao lưu (pending + exchange). Họ chưa xin vào
 * nhóm nên không nằm trong hàng chờ, danh sách thành viên hay quỹ; admin chỉ
 * cần biết họ tồn tại và có thể khoá khi cần. Thu gọn sẵn để không chiếm chỗ.
 */
export function ExchangeAccountsSection({
  accounts,
}: {
  accounts: ExchangeAccount[];
}) {
  const t = useTranslations("adminMembers");
  const [open, setOpen] = useState(false);
  // Ghi đè trạng thái hoạt động theo id để đổi ngay khi bấm; hỏng thì trả lại.
  const [override, setOverride] = useState<Record<number, boolean>>({});

  function handleToggle(a: ExchangeAccount) {
    const wasActive = override[a.id] ?? a.isActive;
    setOverride((prev) => ({ ...prev, [a.id]: !wasActive }));
    fireAction(
      () => toggleMemberActive(a.id),
      () => setOverride((prev) => ({ ...prev, [a.id]: wasActive })),
    );
  }

  return (
    <Card className="bg-card/80">
      <CardContent className="space-y-3 p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-11 w-full items-center gap-2 text-left"
        >
          <Users className="text-muted-foreground h-5 w-5 shrink-0" />
          <h2 className="font-semibold">{t("exchangeAccountsTitle")}</h2>
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-sm font-bold tabular-nums">
            {accounts.length}
          </span>
          <ChevronDown
            className={`text-muted-foreground ml-auto h-5 w-5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="body"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-2 overflow-hidden"
            >
              <p className="text-muted-foreground text-sm">
                {t("exchangeAccountsHint")}
              </p>
              {accounts.map((a) => {
                const active = override[a.id] ?? a.isActive;
                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 rounded-xl border p-3"
                  >
                    <MemberAvatar
                      memberId={a.id}
                      avatarKey={a.avatarKey}
                      avatarUrl={a.avatarUrl}
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold">
                        {a.name}
                      </p>
                      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="tabular-nums">
                          {a.createdAt
                            ? formatSessionDate(a.createdAt.slice(0, 10))
                            : ""}
                        </span>
                        {a.providers.map((p) => (
                          <span
                            key={p}
                            className="bg-muted rounded-full px-2 py-0.5"
                          >
                            {PROVIDER_LABEL[p] ?? p}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleToggle(a)}
                      className="min-h-11 min-w-11 shrink-0"
                    >
                      {active ? (
                        <Lock className="mr-1.5 h-4 w-4" />
                      ) : (
                        <LockOpen className="mr-1.5 h-4 w-4" />
                      )}
                      {active ? t("lock") : t("unlock")}
                    </Button>
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
