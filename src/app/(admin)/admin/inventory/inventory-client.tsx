"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StockCard } from "@/components/inventory/stock-card";
import { PurchaseForm } from "@/components/inventory/purchase-form";
import { formatK } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Package, Calendar, ArrowDown, ArrowUp, Pencil, Check, X } from "lucide-react";
import { updatePurchaseTubes } from "@/actions/inventory";
import { usePolling } from "@/lib/use-polling";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
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

function formatDate(dateStr: string) {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return format(date, "dd/MM/yyyy", { locale: vi });
  } catch {
    return dateStr;
  }
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
  usePolling();

  const totalQua = stock.filter((s) => s.isActive).reduce((sum, s) => sum + s.currentStockQua, 0);
  const isLowStock = totalQua < 12;

  return (
    <div className="space-y-4">
      {/* Low stock warning — only when TOTAL across all brands < 12 */}
      {isLowStock && (
        <Card>
          <CardContent className="p-3 flex items-center gap-2 bg-destructive/5">
            <Badge variant="destructive">!</Badge>
            <span className="text-sm">
              {t("lowStockWarning")} — {t("totalStock")}: {totalQua} {t("piece")}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          onClick={() => setActiveTab("stock")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "stock"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("inventory")}
        </button>
        <button
          onClick={() => setActiveTab("purchases")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "purchases"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("purchase")}
        </button>
        <button
          onClick={() => setActiveTab("usage")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
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
            <div className="text-center py-8 text-muted-foreground text-sm">
              {tStats("noData")}
            </div>
          ) : (
            <>
              {/* Table header */}
              <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                <span>Hãng cầu</span>
                <span className="text-right w-32">Tồn kho</span>
                <span className="text-right w-20">Trạng thái</span>
              </div>
              {stock.map((s) => <StockCard key={s.brandId} stock={s} />)}
            </>
          )}
        </div>
      )}

      {/* Purchases tab */}
      {activeTab === "purchases" && (
        <div className="space-y-4">
          <PurchaseForm brands={brands} />

          <h3 className="font-semibold text-sm">{t("purchaseHistory")}</h3>
          {purchases.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {t("noPurchases")}
            </div>
          ) : (
            <div className="space-y-2">
              {purchases.map((p) => {
                const isEditing = editingId === p.id;
                return (
                  <Card key={p.id} size="sm">
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="flex items-center justify-center h-8 w-8 rounded-md bg-primary/10 shrink-0">
                        <ArrowDown className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium flex items-center gap-1.5">
                          {p.brand.name} -{" "}
                          {isEditing ? (
                            <span className="inline-flex items-center gap-1">
                              <Input
                                type="number"
                                value={editTubes}
                                onChange={(e) => setEditTubes(Number(e.target.value) || 1)}
                                min={1}
                                className="h-6 w-16 text-xs px-1.5"
                                autoFocus
                              />
                              <span className="text-xs">{t("tube")}</span>
                              <button
                                type="button"
                                onClick={async () => {
                                  await updatePurchaseTubes(p.id, editTubes);
                                  setEditingId(null);
                                }}
                                className="text-green-600 hover:text-green-700"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              {p.tubes} {t("tube")}
                              <button
                                type="button"
                                onClick={() => { setEditingId(p.id); setEditTubes(p.tubes); }}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {formatDate(p.purchasedAt)}
                          {p.notes && <span> - {p.notes}</span>}
                        </div>
                      </div>
                      <div className="text-sm font-medium">
                        {isEditing ? formatK(editTubes * p.pricePerTube) : formatK(p.totalPrice)}
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
          <h3 className="font-semibold text-sm">{t("usageHistory")}</h3>
          {usage.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {t("noUsage")}
            </div>
          ) : (
            usage.map((u) => (
              <Card key={u.id} size="sm">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-md bg-destructive/10">
                    <ArrowUp className="h-4 w-4 text-destructive" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {u.brand.name} - {u.quantityUsed} {t("piece")}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {formatDate(u.session.date)}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
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
