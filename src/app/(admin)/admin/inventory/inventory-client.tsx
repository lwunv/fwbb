"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StockCard } from "@/components/inventory/stock-card";
import { PurchaseForm } from "@/components/inventory/purchase-form";
import { TabSegment } from "@/components/shared/tab-segment";
import { EmptyState } from "@/components/shared/empty-state";
import { formatK } from "@/lib/utils";
import { calculateShuttlecockCost } from "@/lib/cost-calculator";
import { isLowStock, tubesToQua, splitOngQua } from "@/lib/inventory-core";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Calendar, ArrowDown, ArrowUp, Pencil, Check, X } from "lucide-react";
import { updatePurchaseTubes } from "@/actions/inventory";
import { fireAction } from "@/lib/optimistic-action";
import { usePolling } from "@/lib/use-polling";
import { useLocale } from "next-intl";
import { formatSessionDate } from "@/lib/date-format";
import type { AppLocale } from "@/lib/date-fns-locale";
import type { StockByBrand } from "@/actions/inventory";
import type { InferSelectModel } from "drizzle-orm";
import type {
  inventoryPurchases as purchasesTable,
  shuttlecockBrands as brandsTable,
  sessionShuttlecocks as sessionShuttlecocksTable,
  sessions as sessionsTable,
} from "@/db/schema";

type Purchase = InferSelectModel<typeof purchasesTable> & {
  brand: InferSelectModel<typeof brandsTable>;
};

type Usage = InferSelectModel<typeof sessionShuttlecocksTable> & {
  brand: InferSelectModel<typeof brandsTable>;
  session: InferSelectModel<typeof sessionsTable>;
};

type Brand = InferSelectModel<typeof brandsTable>;

interface InventoryClientProps {
  stock: StockByBrand[];
  purchases: Purchase[];
  usage: Usage[];
  brands: Brand[];
}

export function InventoryClient({
  stock,
  purchases,
  usage,
  brands,
}: InventoryClientProps) {
  const [activeTab, setActiveTab] = useState<"stock" | "purchases" | "usage">(
    "stock",
  );
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTubes, setEditTubes] = useState(0);
  const t = useTranslations("inventory");
  const tStats = useTranslations("stats");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const formatDate = (d: string) => formatSessionDate(d, "long", locale);
  usePolling();

  // Optimistic mirrors: render the purchase history + stock from local copies
  // so a new purchase row, an edited tube count, and the moved stock number
  // appear on submit instead of waiting for router.refresh(). Re-sync when the
  // props change (post-refresh + polling + rollback) per the prop-sync rule.
  const [localPurchases, setLocalPurchases] = useState(purchases);
  useEffect(() => {
    setLocalPurchases(purchases);
  }, [purchases]);
  const [localStock, setLocalStock] = useState(stock);
  useEffect(() => {
    setLocalStock(stock);
  }, [stock]);

  const totalQua = localStock
    .filter((s) => s.isActive)
    .reduce((sum, s) => sum + s.currentStockQua, 0);
  const lowStock = isLowStock(totalQua);

  // Recompute a brand's stock row for an optimistic purchase (adds tubes to
  // purchased + stock). Mirrors getStockByBrand's server math so the display
  // number does not drift before it reconciles on refresh.
  function bumpStock(s: StockByBrand, tubesDelta: number): StockByBrand {
    const quaDelta = tubesToQua(tubesDelta);
    const rawStockQua = s.rawStockQua + quaDelta;
    const currentStockQua = Math.max(0, rawStockQua);
    const { ong, qua } = splitOngQua(currentStockQua);
    return {
      ...s,
      totalPurchasedTubes: s.totalPurchasedTubes + tubesDelta,
      totalPurchasedQua: s.totalPurchasedQua + quaDelta,
      rawStockQua,
      currentStockQua,
      ong,
      qua,
      isLowStock: isLowStock(rawStockQua),
    };
  }

  function applyOptimisticPurchase(
    ghost: Purchase,
    brandId: number,
    tubesDelta: number,
  ) {
    setLocalPurchases((rows) => [ghost, ...rows]);
    setLocalStock((st) =>
      st.map((s) => (s.brandId === brandId ? bumpStock(s, tubesDelta) : s)),
    );
  }

  function rollbackOptimisticPurchase(
    ghostId: number,
    brandId: number,
    tubesDelta: number,
  ) {
    setLocalPurchases((rows) => rows.filter((r) => r.id !== ghostId));
    setLocalStock((st) =>
      st.map((s) => (s.brandId === brandId ? bumpStock(s, -tubesDelta) : s)),
    );
  }

  return (
    <div className="space-y-4">
      {/* Low stock warning — only when TOTAL across all brands < 1 tube */}
      {lowStock && (
        <Card>
          <CardContent className="bg-destructive/5 flex items-center gap-2 p-4">
            <Badge variant="destructive">!</Badge>
            <span className="text-base">
              {t("lowStockWarning")} — {t("totalStock")}: {totalQua}{" "}
              {t("piece")}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Tab switcher */}
      <TabSegment
        variant="rounded"
        value={activeTab}
        onChange={(v) => setActiveTab(v)}
        ariaLabel={t("inventory")}
        options={[
          { value: "stock", label: t("inventory") },
          { value: "purchases", label: t("purchase") },
          { value: "usage", label: t("usage") },
        ]}
      />

      {/* Stock tab */}
      {activeTab === "stock" && (
        <div className="space-y-3">
          {localStock.length === 0 ? (
            <EmptyState variant="inline" title={tStats("noData")} />
          ) : (
            <>
              {localStock.map((s) => (
                <StockCard key={s.brandId} stock={s} />
              ))}
            </>
          )}
        </div>
      )}

      {/* Purchases tab */}
      {activeTab === "purchases" && (
        <div className="space-y-4">
          <PurchaseForm
            brands={brands}
            onOptimisticAdd={applyOptimisticPurchase}
            onRollbackAdd={rollbackOptimisticPurchase}
          />

          <h3 className="text-base font-semibold">{t("purchaseHistory")}</h3>
          {localPurchases.length === 0 ? (
            <EmptyState variant="inline" title={t("noPurchases")} />
          ) : (
            <div className="space-y-2">
              {localPurchases.map((p) => {
                const isEditing = editingId === p.id;
                return (
                  <Card key={p.id} size="sm">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="bg-primary/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                        <ArrowDown className="text-primary h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-base font-medium">
                          {p.brand.name} -{" "}
                          {isEditing ? (
                            <span className="flex w-full flex-wrap items-center gap-1.5">
                              <NumberStepper
                                value={editTubes}
                                onChange={setEditTubes}
                                min={1}
                                max={99}
                                className="min-w-0 flex-1 rounded-lg"
                              />
                              <span className="text-sm">{t("tube")}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const prevTubes = p.tubes;
                                  const prevTotalPrice = p.totalPrice;
                                  const nextTubes = editTubes;
                                  // Optimistic: count + thành tiền của dòng nhảy
                                  // ngay khi bấm Lưu, không chờ round-trip.
                                  setLocalPurchases((rows) =>
                                    rows.map((r) =>
                                      r.id === p.id
                                        ? {
                                            ...r,
                                            tubes: nextTubes,
                                            totalPrice:
                                              nextTubes * r.pricePerTube,
                                          }
                                        : r,
                                    ),
                                  );
                                  setEditingId(null);
                                  fireAction(
                                    () =>
                                      updatePurchaseTubes(
                                        p.id,
                                        nextTubes,
                                        crypto.randomUUID(),
                                      ),
                                    () => {
                                      setLocalPurchases((rows) =>
                                        rows.map((r) =>
                                          r.id === p.id
                                            ? {
                                                ...r,
                                                tubes: prevTubes,
                                                totalPrice: prevTotalPrice,
                                              }
                                            : r,
                                        ),
                                      );
                                      setEditingId(p.id);
                                      setEditTubes(prevTubes);
                                    },
                                    // Refresh ngay để tồn kho cập nhật tức thì.
                                    { onSuccess: () => router.refresh() },
                                  );
                                }}
                                className="inline-flex size-11 items-center justify-center rounded-lg text-green-600 hover:text-green-700"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="text-muted-foreground hover:text-foreground inline-flex size-11 items-center justify-center rounded-lg"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              {p.tubes} {t("tube")}
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(p.id);
                                  setEditTubes(p.tubes);
                                }}
                                className="text-muted-foreground hover:text-foreground -m-2.5 inline-flex size-11 items-center justify-center"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground flex items-center gap-2 text-sm">
                          <Calendar className="h-4 w-4" />
                          {formatDate(p.purchasedAt)}
                          {p.notes && <span> - {p.notes}</span>}
                        </div>
                      </div>
                      <div className="text-base font-medium">
                        {isEditing
                          ? formatK(editTubes * p.pricePerTube)
                          : formatK(p.totalPrice)}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Usage tab */}
      {activeTab === "usage" && (
        <div className="space-y-2">
          <h3 className="text-base font-semibold">{t("usageHistory")}</h3>
          {usage.length === 0 ? (
            <EmptyState variant="inline" title={t("noUsage")} />
          ) : (
            usage.map((u) => (
              <Card key={u.id} size="sm">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="bg-destructive/10 flex h-10 w-10 items-center justify-center rounded-xl">
                    <ArrowUp className="text-destructive h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-medium">
                      {u.brand.name} - {u.quantityUsed} {t("piece")}
                    </div>
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4" />
                      {formatDate(u.session.date)}
                    </div>
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {formatK(
                      calculateShuttlecockCost(u.quantityUsed, u.pricePerTube),
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
