import { useTranslations } from "next-intl";
import type { PublicPlayerProfile } from "@/lib/reputation/public-profile";
import { StatCard, StatRow } from "./reputation-stats";

/**
 * Lời khen của người chơi cùng (quyết định 8, 9). Chỉ là lời khen: dòng nào
 * bằng 0 hoặc null thì ẩn (không bấm khen không phải là chê), không có phần
 * trăm. Không còn dòng nào thì nói rõ là chưa đủ lượt chấm.
 */
export function PeerKudos({ peer }: { peer: PublicPlayerProfile["peer"] }) {
  const t = useTranslations("exchange.reputation");
  const rows: { key: string; label: string; count: number }[] = [];
  if (peer.playAgain !== null && peer.playAgain > 0) {
    rows.push({
      key: "play_again",
      label: t("kudosPlayAgain"),
      count: peer.playAgain,
    });
  }
  for (const { tag, count } of peer.tags) {
    if (count > 0) rows.push({ key: tag, label: t(`tags.${tag}`), count });
  }

  return (
    <StatCard title={t("kudosTitle")}>
      {rows.length === 0 ? (
        <p className="text-muted-foreground py-2 text-base">
          {t("kudosNotEnough")}
        </p>
      ) : (
        <>
          <dl className="divide-y">
            {rows.map((r) => (
              <StatRow
                key={r.key}
                label={r.label}
                value={t("kudosCount", { count: r.count })}
              />
            ))}
          </dl>
          {peer.raters !== null && (
            <p className="text-muted-foreground pt-2 text-sm">
              {t("kudosRaters", { count: peer.raters })}
            </p>
          )}
        </>
      )}
    </StatCard>
  );
}
