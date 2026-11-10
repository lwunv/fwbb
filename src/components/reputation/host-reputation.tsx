import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, ShieldCheck } from "lucide-react";
import type { HostLine } from "@/lib/reputation/host-line";
import { NewBadge } from "./new-badge";

/**
 * Dòng uy tín ngắn của host trên trang buổi; cả khối là một link 44px tới hồ
 * sơ. Phần trăm chỉ hiện khi server trả số (null = chưa đủ người chấm, không
 * phải 0%). Host chưa tổ chức buổi nào thì chỉ có chip "Host mới".
 */
export function HostReputation({ line }: { line: HostLine }) {
  const t = useTranslations("exchange.reputation");
  const stat = "text-muted-foreground text-base";
  return (
    <Link
      href={`/players/${line.code}`}
      className="bg-muted/60 hover:bg-accent flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 transition-colors"
    >
      <ShieldCheck className="text-primary h-5 w-5 shrink-0" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {line.organized === 0 ? (
          <NewBadge label={t("hostNew")} />
        ) : (
          <span className="text-base font-medium">
            {t("hostOrganized", { count: line.organized })}
          </span>
        )}
        {line.asDescribedPct !== null && (
          <span className={stat}>
            {t("hostAsDescribed", { pct: line.asDescribedPct })}
          </span>
        )}
        {line.feeAsPromisedPct !== null && (
          <span className={stat}>
            {t("hostFeeAsPromised", { pct: line.feeAsPromisedPct })}
          </span>
        )}
      </span>
      <ChevronRight
        className="text-muted-foreground h-4 w-4 shrink-0"
        aria-hidden
      />
    </Link>
  );
}
