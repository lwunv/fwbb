import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Chip "Mới" cho tài khoản mới (hồ sơ người chơi, danh sách đăng ký). */
export function NewBadge({ className }: { className?: string }) {
  const t = useTranslations("exchange.reputation");
  return (
    <span
      className={cn(
        "bg-primary/10 text-primary inline-flex min-h-7 items-center rounded-full px-2.5 text-sm font-semibold",
        className,
      )}
    >
      {t("newBadge")}
    </span>
  );
}
