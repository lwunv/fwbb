"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  CircleDot,
  TrendingUp,
  TrendingDown,
  Banknote,
  ArrowUpCircle,
  ArrowDownCircle,
  Package,
  Plus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/custom-select";
import { tubesToQua } from "@/lib/inventory-core";
import { NumberStepper } from "@/components/ui/number-stepper";
import { SearchInput } from "@/components/shared/search-input";
import { StatTile } from "@/components/shared/stat-tile";
import { BaseModal } from "@/components/shared/base-modal";
import { formatK, cn } from "@/lib/utils";
import { formatSessionDate } from "@/lib/date-format";
import { fireAction } from "@/lib/optimistic-action";
import { recordPurchase } from "@/actions/inventory";
import type {
  ShuttlecockFinanceSummary,
  PurchaseRow,
  UsageRow,
} from "@/actions/shuttlecock-finance";

interface BrandOpt {
  id: number;
  name: string;
  pricePerTube: number;
}

interface Props {
  summary: ShuttlecockFinanceSummary;
  purchases: PurchaseRow[];
  usages: UsageRow[];
  brands: BrandOpt[];
  /** Hãng cầu mặc định khi mở modal "Mua cầu" — lấy từ app_settings
   *  defaultBrandId (set ở /admin/dashboard). Fallback brands[0] nếu null. */
  defaultBrandId?: number | null;
}

type Tab = "purchase" | "usage";

export function ShuttlecockFinanceClient({
  summary,
  purchases,
  usages,
  brands,
  defaultBrandId = null,
}: Props) {
  const t = useTranslations("adminShuttlecockFinance");
  const tCommon = useTranslations("common");
  const [tab, setTab] = useState<Tab>("usage");
  const [search, setSearch] = useState("");
  const [localSummary, setLocalSummary] = useState(summary);
  const [localPurchases, setLocalPurchases] = useState(purchases);

  // Sync server props back to local optimistic state when parent re-renders
  // (e.g., after revalidatePath triggers a refetch).
  const [prevSummary, setPrevSummary] = useState(summary);
  const [prevPurchases, setPrevPurchases] = useState(purchases);
  if (summary !== prevSummary || purchases !== prevPurchases) {
    setPrevSummary(summary);
    setPrevPurchases(purchases);
    setLocalSummary(summary);
    setLocalPurchases(purchases);
  }

  // Mua-cầu form state — hãng mặc định lấy từ app_settings.defaultBrandId,
  // fallback brands[0] nếu setting chưa có hoặc brand đã inactive. Khi user
  // sửa hãng mặc định ở /admin/dashboard và quay lại tab này (Server Component
  // re-render qua revalidatePath), defaultBrandId prop sẽ refresh theo.
  function pickDefaultBrand(): BrandOpt | undefined {
    if (defaultBrandId != null) {
      const found = brands.find((b) => b.id === defaultBrandId);
      if (found) return found;
    }
    return brands[0];
  }
  const initialBrand = pickDefaultBrand();
  const [showBuy, setShowBuy] = useState(false);
  const [bsBrandId, setBsBrandId] = useState<number | null>(
    initialBrand?.id ?? null,
  );
  const [bsTubes, setBsTubes] = useState(1);
  const [bsPricePerTube, setBsPricePerTube] = useState<number>(
    initialBrand?.pricePerTube ?? 0,
  );
  const [bsPurchasedAt, setBsPurchasedAt] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [bsNote, setBsNote] = useState("");

  const bsTotal = bsTubes * bsPricePerTube;

  function handleBuy() {
    if (!bsBrandId) return;
    if (!Number.isFinite(bsTubes) || bsTubes < 1) {
      toast.error(t("toastInvalidTubes"));
      return;
    }
    if (!Number.isFinite(bsPricePerTube) || bsPricePerTube <= 0) {
      toast.error(t("toastInvalidPrice"));
      return;
    }
    const total = bsTubes * bsPricePerTube;
    const brand = brands.find((b) => b.id === bsBrandId);
    if (!brand) return;

    const prevSum = { ...localSummary };
    const prevList = localPurchases;

    // Optimistic: thêm 1 dòng "đã mua" tạm vào đầu list (id âm — sẽ được
    // server thay sau revalidatePath). Cập nhật summary tile trùng với
    // tăng totalSpent / tubes / qua. Profit giảm vì revenue chưa đổi.
    const optimisticRow: PurchaseRow = {
      id: -Date.now(),
      brandId: bsBrandId,
      brandName: brand.name,
      tubes: bsTubes,
      pricePerTube: bsPricePerTube,
      totalPrice: total,
      purchasedAt: `${bsPurchasedAt}T00:00:00.000Z`,
      notes: bsNote.trim() || null,
    };
    setLocalPurchases((rows) => [optimisticRow, ...rows]);
    setLocalSummary((s) => ({
      ...s,
      totalSpent: s.totalSpent + total,
      totalTubesPurchased: s.totalTubesPurchased + bsTubes,
      totalQuaPurchased: s.totalQuaPurchased + tubesToQua(bsTubes),
      // Mới mua, chưa dùng → toàn bộ giá nhập đổ vào tồn kho.
      // netProfit = revenue + inventoryValue - totalSpent → KHÔNG đổi
      // (cả totalSpent lẫn inventoryValue cùng +total).
      inventoryValue: s.inventoryValue + total,
      totalQuaRemaining: s.totalQuaRemaining + tubesToQua(bsTubes),
    }));

    const idemKey =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? `buy-shuttle-sf-${crypto.randomUUID()}`
        : `buy-shuttle-sf-${bsBrandId}-${bsTubes}-${bsPricePerTube}-${Date.now()}`;
    const fd = new FormData();
    fd.append("brandId", String(bsBrandId));
    fd.append("tubes", String(bsTubes));
    fd.append("pricePerTube", String(bsPricePerTube));
    fd.append("purchasedAt", bsPurchasedAt);
    if (bsNote.trim()) fd.append("notes", bsNote.trim());
    fd.append("idempotencyKey", idemKey);
    fireAction(
      () => recordPurchase(fd),
      () => {
        setLocalSummary(prevSum);
        setLocalPurchases(prevList);
      },
      { successMsg: t("toastBuySuccess", { amount: formatK(total) }) },
    );
    setShowBuy(false);
    setBsTubes(1);
    setBsNote("");
  }

  const filteredPurchases = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return localPurchases;
    return localPurchases.filter(
      (p) =>
        p.brandName.toLowerCase().includes(q) ||
        (p.notes ?? "").toLowerCase().includes(q),
    );
  }, [localPurchases, search]);

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
    localSummary.netProfit > 0
      ? "green"
      : localSummary.netProfit < 0
        ? "red"
        : ("neutral" as const);

  return (
    <div className="space-y-4 pb-24 md:pb-28">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 rounded-xl p-2">
          <CircleDot className="text-primary h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          icon={TrendingDown}
          label={t("statSpent")}
          value={formatK(localSummary.totalSpent)}
          tone="orange"
        />
        <StatTile
          icon={TrendingUp}
          label={t("statRevenue")}
          value={formatK(localSummary.totalRevenue)}
          tone="green"
        />
        <StatTile
          icon={Banknote}
          label={localSummary.netProfit >= 0 ? t("statProfit") : t("statLoss")}
          value={formatK(localSummary.netProfit)}
          tone={profitTone}
        />
        <StatTile
          icon={Package}
          label={t("statStockLabel")}
          tone="primary"
          value={
            <div className="flex flex-col gap-0.5">
              <span>{formatK(localSummary.inventoryValue)}</span>
              <span className="text-muted-foreground text-xs font-normal">
                {t("statStockValue", {
                  purchased: localSummary.totalQuaPurchased,
                  used: localSummary.totalQuaUsed,
                })}
              </span>
            </div>
          }
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
          {t("tabSold", { count: usages.length })}
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
          {t("tabBought", { count: localPurchases.length })}
        </button>
      </div>

      {/* Search */}
      <SearchInput
        placeholder={
          tab === "usage"
            ? t("searchSoldPlaceholder")
            : t("searchBoughtPlaceholder")
        }
        value={search}
        onChange={setSearch}
      />

      {/* Lists */}
      {tab === "usage" ? (
        filteredUsages.length === 0 ? (
          <EmptyState message={t("emptySold")} />
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
                            · {u.quantityUsed} {t("unitQua")} ×{" "}
                            {formatK(u.pricePerTube)}
                            {t("perTube")}
                          </span>
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {t("sessionLabel")}{" "}
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
        <EmptyState message={t("emptyBought")} />
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
                          · {p.tubes} {t("unitTube")} ×{" "}
                          {formatK(p.pricePerTube)}
                          {t("perTube")}
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

      {/* Fixed bottom CTA — full-width bar bám sát đáy (bottom = 0). Khi
          modal mở thì ẩn hẳn để tránh đè lên overlay. */}
      {!showBuy && (
        <motion.button
          type="button"
          onClick={() => setShowBuy(true)}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.98 }}
          className="bg-primary text-primary-foreground fixed right-0 bottom-0 left-0 z-30 inline-flex h-14 items-center justify-center gap-2 text-base font-semibold shadow-lg transition-opacity hover:opacity-90 lg:left-60"
        >
          <Plus className="h-5 w-5" />
          {t("buyButton")}
        </motion.button>
      )}

      {/* Mua cầu — chi quỹ chung; tăng stock + ghi ledger inventory_purchase. */}
      <BaseModal open={showBuy} onClose={() => setShowBuy(false)}>
        <h3 className="mb-1 text-lg font-bold">{t("modalBuyTitle")}</h3>
        <p className="text-muted-foreground mb-4 text-xs">
          {t("modalBuyHint")}
        </p>
        {brands.length === 0 ? (
          <div className="text-muted-foreground py-6 text-center text-sm">
            {t("noBrandsAvailable")}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("brandLabel")}
              </label>
              <CustomSelect
                value={bsBrandId ? String(bsBrandId) : ""}
                onChange={(v) => {
                  const id = v ? Number(v) : null;
                  setBsBrandId(id);
                  const b = brands.find((x) => x.id === id);
                  if (b) setBsPricePerTube(b.pricePerTube);
                }}
                placeholder={t("brandPlaceholder")}
                options={brands.map((b) => ({
                  value: String(b.id),
                  label: `${b.name} (${formatK(b.pricePerTube)}${t("perTube")})`,
                }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("tubesLabel")}
                </label>
                <NumberStepper
                  value={bsTubes}
                  onChange={setBsTubes}
                  min={1}
                  max={1000}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("pricePerTubeLabel")}
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={
                    bsPricePerTube ? bsPricePerTube.toLocaleString("vi-VN") : ""
                  }
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setBsPricePerTube(digits ? Number(digits) : 0);
                  }}
                  placeholder="100000"
                  className="tabular-nums"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("purchasedAtLabel")}
              </label>
              <Input
                type="date"
                value={bsPurchasedAt}
                onChange={(e) => setBsPurchasedAt(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("noteFieldLabel")}
              </label>
              <Input
                type="text"
                value={bsNote}
                onChange={(e) => setBsNote(e.target.value)}
                placeholder={t("notePlaceholder")}
              />
            </div>
            <div className="bg-muted flex items-center justify-between rounded-xl px-4 py-3">
              <span className="text-sm font-medium">{t("totalLabel")}</span>
              <span className="text-base font-bold tabular-nums">
                {formatK(bsTotal)}
              </span>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowBuy(false)}
                className="hover:bg-accent flex-1 rounded-xl border py-3 font-medium transition-colors"
              >
                {tCommon("cancel")}
              </button>
              <button
                onClick={handleBuy}
                disabled={!bsBrandId || bsTubes < 1 || bsPricePerTube <= 0}
                className="bg-primary text-primary-foreground flex-1 rounded-xl py-3 font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {tCommon("confirm")}
              </button>
            </div>
          </div>
        )}
      </BaseModal>
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
