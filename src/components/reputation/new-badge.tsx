import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Chip "Mới" cho tài khoản mới (hồ sơ người chơi, danh sách đăng ký). `label`
 * cho biến thể cùng kiểu như "Host mới", để mọi chip "mới" nhìn giống nhau.
 */
export function NewBadge({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  const t = useTranslations("exchange.reputation");
  return (
    <span
      className={cn(
        "bg-primary/10 text-primary inline-flex min-h-7 items-center rounded-full px-2.5 text-sm font-semibold",
        className,
      )}
    >
      {label ?? t("newBadge")}
    </span>
  );
}
