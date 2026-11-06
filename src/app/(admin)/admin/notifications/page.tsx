import { getLocale, getTranslations } from "next-intl/server";
import { getAdminDebtNotifications } from "@/actions/admin-notifications";
import { Card, CardContent } from "@/components/ui/card";
import { formatVND } from "@/lib/utils";

/**
 * `created_at` lưu kiểu SQLite "YYYY-MM-DD HH:MM:SS" theo UTC. Hiện theo giờ VN
 * cố định, không phụ thuộc múi giờ của server.
 */
function fmtLedgerTime(at: string, locale: string): string {
  if (!at) return "";
  const d = new Date(`${at.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString(locale === "en" ? "en-GB" : locale, {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Trang thông báo admin (yêu cầu user 6/11/2026): ai đang âm quỹ, và lịch sử
 * những lần một member chuyển từ ≥ 0 xuống âm, tính lại từ sổ cái.
 */
export default async function AdminNotificationsPage() {
  const [t, locale, data] = await Promise.all([
    getTranslations("adminNotifications"),
    getLocale(),
    getAdminDebtNotifications(),
  ]);

  if ("error" in data) {
    return (
      <p className="text-destructive py-8 text-center text-base">
        {t("loadError")}
      </p>
    );
  }

  const { owing, history, voteBlockDebtThreshold } = data;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>

      <section className="space-y-3" aria-labelledby="owing-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="owing-title" className="text-lg font-semibold">
            {t("owingTitle")}
          </h2>
          <span className="text-muted-foreground text-sm">
            {t("owingCount", { count: owing.length })}
          </span>
        </div>
        <p className="text-muted-foreground text-sm">
          {t("limitNote", { limit: formatVND(voteBlockDebtThreshold) })}
        </p>
        <Card className="bg-card/80 backdrop-blur">
          <CardContent className="p-2">
            {owing.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-base">
                {t("empty")}
              </p>
            ) : (
              <ul className="divide-border/60 divide-y">
                {owing.map((o) => (
                  <li
                    key={o.memberId}
                    className="flex min-h-11 items-center justify-between gap-3 px-2 py-2"
                  >
                    <span className="min-w-0 truncate text-base" title={o.name}>
                      {o.name}
                      {o.nickname && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({o.nickname})
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {o.overLimit && (
                        <span className="border-destructive/40 bg-destructive/10 text-destructive rounded border px-1.5 text-sm font-semibold">
                          {t("overLimit")}
                        </span>
                      )}
                      <span className="text-destructive text-base font-semibold tabular-nums">
                        {formatVND(o.balance)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3" aria-labelledby="history-title">
        <h2 id="history-title" className="text-lg font-semibold">
          {t("historyTitle")}
        </h2>
        <Card className="bg-card/80 backdrop-blur">
          <CardContent className="p-2">
            {history.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-base">
                {t("historyEmpty")}
              </p>
            ) : (
              <ul className="divide-border/60 divide-y">
                {history.map((h) => (
                  <li
                    key={`${h.memberId}-${h.txId}`}
                    className="space-y-0.5 px-2 py-2.5"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className="min-w-0 truncate text-base font-medium"
                        title={h.name}
                      >
                        {h.name}
                      </span>
                      <time className="text-muted-foreground shrink-0 text-sm tabular-nums">
                        {fmtLedgerTime(h.at, locale)}
                      </time>
                    </div>
                    <p className="text-sm tabular-nums">
                      {t("historyItem", {
                        before: formatVND(h.balanceBefore),
                        after: formatVND(h.balanceAfter),
                      })}
                    </p>
                    {h.description && (
                      <p
                        className="text-muted-foreground truncate text-sm"
                        title={h.description}
                      >
                        {h.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
