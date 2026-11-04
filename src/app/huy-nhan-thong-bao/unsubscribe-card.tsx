"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Loader2, MailX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "done";

export function UnsubscribeCard({ token }: { token: string }) {
  const t = useTranslations("notifications.unsubscribe");
  const [phase, setPhase] = useState<Phase>("idle");
  const [pending, setPending] = useState(false);

  async function unsubscribe() {
    if (pending) return;
    setPending(true);
    // Optimistic: hiện kết quả ngay, quay lại nút nếu máy chủ từ chối.
    setPhase("done");
    try {
      const res = await fetch(
        `/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setPhase("idle");
      toast.error(t("failed"));
    } finally {
      setPending(false);
    }
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
      {phase === "done" ? (
        <div className="space-y-4" role="status">
          <h1 className="text-xl font-semibold">{t("doneTitle")}</h1>
          <p className="text-muted-foreground text-base">{t("doneBody")}</p>
          <Link
            href="/me"
            className="text-primary inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-base font-medium underline-offset-4 hover:underline"
          >
            {t("reenable")}
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground text-base">{t("body")}</p>
          <Button
            size="lg"
            className="w-full"
            onClick={unsubscribe}
            disabled={pending || token === ""}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {t("button")}
          </Button>
        </div>
      )}
    </motion.section>
  );
}
