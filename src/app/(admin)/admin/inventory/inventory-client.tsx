"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StockCard } from "@/components/inventory/stock-card";
import { PurchaseForm } from "@/components/inventory/purchase-form";
import { formatVND } from "@/lib/utils";
import { Package, Calendar, ArrowDown, ArrowUp } from "lucide-react";
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
  const t = useTranslations("inventory");
  const tStats = useTranslations("stats");

  const lowStockCount = stock.filter((s) => s.isActive && s.isLowStock).length;

  return (
    <div className="space-y-4">
      {/* Low stock warning */}
      {lowStockCount > 0 && (
        <Card>
          <CardContent className="p-3 flex items-center gap-2 bg-destructive/5">
            <Badge variant="destructive">{lowStockCount}</Badge>
            <span className="text-sm">
              {t("lowStockWarning")}
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
            stock.map((s) => <StockCard key={s.brandId} stock={s} />)
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
              {purchases.map((p) => (
                <Card key={p.id} size="sm">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="flex items-center justify-center h-8 w-8 rounded-md bg-primary/10">
                      <ArrowDown className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        {p.brand.name} - {p.tubes} {t("tube")}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {formatDate(p.purchasedAt)}
                        {p.notes && <span> - {p.notes}</span>}
                      </div>
                    </div>
                    <div className="text-sm font-medium">
                      {formatVND(p.totalPrice)}
                    </div>
                  </CardContent>
                </Card>
              ))}
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
                    {formatVND(u.quantityUsed * (u.pricePerTube / 12))}
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
