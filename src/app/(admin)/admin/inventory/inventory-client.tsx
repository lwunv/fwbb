"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StockCard } from "@/components/inventory/stock-card";
import { PurchaseForm } from "@/components/inventory/purchase-form";
import { formatK } from "@/lib/utils";
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
  const formatDate = (d: string) => formatSessionDate(d, "long", locale);
  usePolling();

  const totalQua = stock
    .filter((s) => s.isActive)
    .reduce((sum, s) => sum + s.currentStockQua, 0);
  const isLowStock = totalQua < 12;

  return (
    <div className="space-y-4">
      {/* Low stock warning — only when TOTAL across all brands < 12 */}
      {isLowStock && (
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
      <div className="bg-muted flex gap-1 rounded-xl p-1.5">
        <button
          onClick={() => setActiveTab("stock")}
          className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "stock"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("inventory")}
        </button>
        <button
          onClick={() => setActiveTab("purchases")}
          className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "purchases"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("purchase")}
        </button>
        <button
          onClick={() => setActiveTab("usage")}
          className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "usage"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("usage")}
        </button>
      </div>

      {/* Stock tab */}
      {activeTab === "stock" && (
        <div className="space-y-3">
          {stock.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-base">
              {tStats("noData")}
            </div>
          ) : (
            <>
              {stock.map((s) => (
                <StockCard key={s.brandId} stock={s} />
              ))}
            </>
          )}
        </div>
      )}

      {/* Purchases tab */}
      {activeTab === "purchases" && (
        <div className="space-y-4">
          <PurchaseForm brands={brands} />

          <h3 className="text-base font-semibold">{t("purchaseHistory")}</h3>
          {purchases.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-base">
              {t("noPurchases")}
            </div>
          ) : (
            <div className="space-y-2">
              {purchases.map((p) => {
                const isEditing = editingId === p.id;
                return (
                  <Card key={p.id} size="sm">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="bg-primary/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                        <ArrowDown className="text-primary h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-base font-medium">
                          {p.brand.name} -{" "}
                          {isEditing ? (
                            <span className="inline-flex items-center gap-1.5">
                              <NumberStepper
                                value={editTubes}
                                onChange={setEditTubes}
                                min={1}
                                max={99}
                                className="rounded-lg"
                              />
                              <span className="text-sm">{t("tube")}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const prevTubes = p.tubes;
                                  setEditingId(null);
                                  fireAction(
                                    () => updatePurchaseTubes(p.id, editTubes),
                                    () => {
                                      setEditingId(p.id);
                                      setEditTubes(prevTubes);
                                    },
                                  );
                                }}
                                className="text-green-600 hover:text-green-700"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="text-muted-foreground hover:text-foreground"
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
                                className="text-muted-foreground hover:text-foreground"
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
            <div className="text-muted-foreground py-8 text-center text-base">
              {t("noUsage")}
            </div>
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
                    {formatK(u.quantityUsed * (u.pricePerTube / 12))}
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
