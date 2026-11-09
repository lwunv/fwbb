"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { MailX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fireAction } from "@/lib/optimistic-action";

type Phase = "idle" | "done";

const profileLinkClass =
  "text-primary inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-base font-medium underline-offset-4 hover:underline";

export function UnsubscribeCard({ token }: { token: string }) {
  const t = useTranslations("notifications.unsubscribe");
  const [phase, setPhase] = useState<Phase>("idle");

  function unsubscribe() {
    // Optimistic: hiện kết quả ngay (nút biến mất nên không bấm lặp được).
    // fireAction thử lại một lần khi lỗi mạng thoáng qua, hết lượt thì quay
    // lại nút và báo lỗi. POST lặp lại an toàn (chỉ đặt cờ về false).
    setPhase("done");
    fireAction(
      async () => {
        try {
          const res = await fetch(
            `/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`,
            { method: "POST" },
          );
          return res.ok ? undefined : { error: t("failed") };
        } catch {
          return { error: t("failed") };
        }
      },
      () => setPhase("idle"),
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card/80 w-full space-y-5 rounded-2xl border p-6 text-center shadow-sm backdrop-blur"
    >
      <div className="bg-primary/10 text-primary mx-auto flex size-14 items-center justify-center rounded-full">
        <MailX className="size-7" aria-hidden />
      </div>
      {token === "" ? (
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">{t("invalidTitle")}</h1>
          <p className="text-muted-foreground text-base">{t("invalidBody")}</p>
          <Link href="/me" className={profileLinkClass}>
            {t("openProfile")}
          </Link>
        </div>
      ) : phase === "done" ? (
        <div className="space-y-4" role="status">
          <h1 className="text-xl font-semibold">{t("doneTitle")}</h1>
          <p className="text-muted-foreground text-base">{t("doneBody")}</p>
          <Link href="/me" className={profileLinkClass}>
            {t("reenable")}
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground text-base">{t("body")}</p>
          <Button size="lg" className="w-full" onClick={unsubscribe}>
            {t("button")}
          </Button>
        </div>
      )}
    </motion.section>
  );
}
