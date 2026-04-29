"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CircleDot,
  TrendingUp,
  TrendingDown,
  Banknote,
  ArrowUpCircle,
  ArrowDownCircle,
  Package,
  Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatTile } from "@/components/shared/stat-tile";
import { formatVND, formatK, cn } from "@/lib/utils";
import { formatSessionDate } from "@/lib/date-format";
import type {
  ShuttlecockFinanceSummary,
  PurchaseRow,
  UsageRow,
} from "@/actions/shuttlecock-finance";

interface Props {
  summary: ShuttlecockFinanceSummary;
  purchases: PurchaseRow[];
  usages: UsageRow[];
}

type Tab = "purchase" | "usage";

export function ShuttlecockFinanceClient({
  summary,
  purchases,
  usages,
}: Props) {
  const [tab, setTab] = useState<Tab>("usage");
  const [search, setSearch] = useState("");

  const filteredPurchases = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return purchases;
    return purchases.filter(
      (p) =>
        p.brandName.toLowerCase().includes(q) ||
        (p.notes ?? "").toLowerCase().includes(q),
    );
  }, [purchases, search]);

  const filteredUsages = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return usages;
    return usages.filter(
      (u) =>
        u.brandName.toLowerCase().includes(q) ||
        u.sessionDate.toLowerCase().includes(q),
    );
  }, [usages, search]);

  const profitTone =
    summary.netProfit > 0
      ? "green"
      : summary.netProfit < 0
        ? "red"
        : ("neutral" as const);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 rounded-xl p-2">
          <CircleDot className="text-primary h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Tiền cầu (Admin)</h1>
          <p className="text-muted-foreground text-sm">
            Admin tự bỏ tiền mua cầu và bán lại theo số quả thực dùng mỗi buổi
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          icon={TrendingDown}
          label="Đã chi (mua cầu)"
          value={formatVND(summary.totalSpent)}
          tone="orange"
        />
        <StatTile
          icon={TrendingUp}
          label="Đã thu (bán cầu)"
          value={formatVND(summary.totalRevenue)}
          tone="green"
        />
        <StatTile
          icon={Banknote}
          label={summary.netProfit >= 0 ? "Lãi" : "Lỗ"}
          value={formatVND(summary.netProfit)}
          tone={profitTone}
        />
        <StatTile
          icon={Package}
          label="Đã mua / Đã dùng"
          value={`${summary.totalQuaPurchased} / ${summary.totalQuaUsed} quả`}
          tone="primary"
        />
      </div>

      {/* Tabs */}
      <div className="bg-muted flex gap-1 rounded-xl p-1.5">
        <button
          type="button"
          onClick={() => setTab("usage")}
          className={cn(
            "min-h-11 flex-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
            tab === "usage"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Đã bán ({usages.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("purchase")}
          className={cn(
            "min-h-11 flex-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
            tab === "purchase"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Đã mua ({purchases.length})
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          placeholder={
            tab === "usage"
              ? "Tìm theo hãng / ngày..."
              : "Tìm theo hãng / ghi chú..."
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-background dark:bg-background pl-10"
        />
      </div>

      {/* Lists */}
      {tab === "usage" ? (
        filteredUsages.length === 0 ? (
          <EmptyState message="Chưa có giao dịch bán cầu" />
        ) : (
          <ul className="space-y-2">
            <AnimatePresence mode="popLayout">
              {filteredUsages.map((u) => (
                <motion.li
                  key={u.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                >
                  <Card size="sm">
                    <CardContent className="flex items-center gap-3 p-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-500/15">
                        <ArrowUpCircle className="h-5 w-5 text-green-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {u.brandName}{" "}
                          <span className="text-muted-foreground text-xs font-normal">
                            · {u.quantityUsed} quả × {formatK(u.pricePerTube)}
                            /ống
                          </span>
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          Buổi{" "}
                          {u.sessionDate
                            ? formatSessionDate(u.sessionDate, "long")
                            : `#${u.sessionId}`}
                        </p>
                      </div>
                      <span className="text-base font-bold text-green-600 tabular-nums dark:text-green-400">
                        +{formatK(u.exactRevenue)}
                      </span>
                    </CardContent>
                  </Card>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )
      ) : filteredPurchases.length === 0 ? (
        <EmptyState message="Chưa có giao dịch mua cầu" />
      ) : (
        <ul className="space-y-2">
          <AnimatePresence mode="popLayout">
            {filteredPurchases.map((p) => (
              <motion.li
                key={p.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
              >
                <Card size="sm">
                  <CardContent className="flex items-center gap-3 p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-500/15">
                      <ArrowDownCircle className="h-5 w-5 text-orange-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {p.brandName}{" "}
                        <span className="text-muted-foreground text-xs font-normal">
                          · {p.tubes} ống × {formatK(p.pricePerTube)}/ống
                        </span>
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {formatSessionDate(p.purchasedAt.slice(0, 10), "long")}
                        {p.notes && ` · ${p.notes}`}
                      </p>
                    </div>
                    <span className="text-base font-bold text-red-600 tabular-nums dark:text-red-400">
                      −{formatK(p.totalPrice)}
                    </span>
                  </CardContent>
                </Card>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm">
      <CircleDot className="h-8 w-8 opacity-40" />
      {message}
    </div>
  );
}
