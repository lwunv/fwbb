"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatVND } from "@/lib/utils";
import { AlertTriangle, Package } from "lucide-react";
import type { StockByBrand } from "@/actions/inventory";

interface StockCardProps {
  stock: StockByBrand;
}

export function StockCard({ stock }: StockCardProps) {
  const t = useTranslations("inventory");

  return (
    <Card size="sm">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">{stock.brandName}</div>
              <div className="text-xs text-muted-foreground">
                {formatVND(stock.pricePerTube)}/{t("tube")}
              </div>
            </div>
          </div>
          {stock.isLowStock && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {t("lowStockWarning")}
            </Badge>
          )}
          {!stock.isActive && (
            <Badge variant="secondary">Ngừng</Badge>
          )}
        </div>

        {/* Stock display */}
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-primary">
            {stock.ong}
          </span>
          <span className="text-sm text-muted-foreground">{t("tube")}</span>
          <span className="text-2xl font-bold text-primary">
            {stock.qua}
          </span>
          <span className="text-sm text-muted-foreground">{t("piece")}</span>
          <span className="text-xs text-muted-foreground ml-auto">
            ({stock.currentStockQua} {t("piece")})
          </span>
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground border-t pt-2">
          <span>Đã mua:</span>
          <span className="text-right">{stock.totalPurchasedTubes} {t("tube")} ({stock.totalPurchasedQua} {t("piece")})</span>
          <span>Đã dùng:</span>
          <span className="text-right">{stock.totalUsedQua} {t("piece")}</span>
        </div>
      </CardContent>
    </Card>
  );
}
