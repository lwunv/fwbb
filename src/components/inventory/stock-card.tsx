"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberStepper } from "@/components/ui/number-stepper";
import { formatK } from "@/lib/utils";
import { Package, Pencil, Check, X } from "lucide-react";
import { setStockQua } from "@/actions/inventory";
import { fireAction } from "@/lib/optimistic-action";
import { tubesToQua } from "@/lib/inventory-core";
import type { StockByBrand } from "@/actions/inventory";

interface StockCardProps {
  stock: StockByBrand;
}

export function StockCard({ stock }: StockCardProps) {
  const t = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [editOng, setEditOng] = useState(stock.ong);
  const [editQua, setEditQua] = useState(stock.qua);

  return (
    <Card size="sm">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Package className="text-muted-foreground h-4 w-4" />
            <div>
              <div className="text-sm font-medium">{stock.brandName}</div>
              <div className="text-muted-foreground text-sm">
                {formatK(stock.pricePerTube)}/{t("tube")}
              </div>
            </div>
          </div>
          {!stock.isActive ? (
            <Badge variant="secondary">{tCommon("inactive")}</Badge>
          ) : stock.isLowStock ? (
            <Badge variant="destructive">{t("lowStockWarning")}</Badge>
          ) : null}
        </div>

        {/* Stock display */}
        {editing ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <NumberStepper value={editOng} onChange={setEditOng} min={0} />
                <span className="text-muted-foreground text-sm">
                  {t("tube")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <NumberStepper
                  value={editQua}
                  onChange={(v) => setEditQua(Math.min(11, v))}
                  min={0}
                  max={11}
                />
                <span className="text-muted-foreground text-sm">
                  {t("piece")}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-11 flex-1"
                onClick={() => {
                  const prevOng = editOng;
                  const prevQua = editQua;
                  setEditing(false);
                  fireAction(
                    () =>
                      setStockQua(stock.brandId, tubesToQua(editOng) + editQua),
                    () => {
                      setEditOng(prevOng);
                      setEditQua(prevQua);
                      setEditing(true);
                    },
                  );
                }}
              >
                <Check className="mr-1 h-4 w-4" />
                {t("save")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-11 flex-1"
                onClick={() => {
                  setEditing(false);
                  setEditOng(stock.ong);
                  setEditQua(stock.qua);
                }}
              >
                <X className="mr-1 h-4 w-4" />
                {t("cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-primary text-2xl font-bold">
                {stock.ong}
              </span>
              <span className="text-muted-foreground text-sm">{t("tube")}</span>
              <span className="text-primary text-2xl font-bold">
                {stock.qua}
              </span>
              <span className="text-muted-foreground text-sm">
                {t("piece")}
              </span>
              <span className="text-muted-foreground text-xs">
                ({stock.currentStockQua} {t("piece")})
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto min-h-11"
              onClick={() => {
                setEditOng(stock.ong);
                setEditQua(stock.qua);
                setEditing(true);
              }}
            >
              <Pencil className="mr-1 h-3.5 w-3.5" />
              {t("edit")}
            </Button>
          </div>
        )}

        {/* Details: "Đã mua" = tổng mua thực (purchases×12), KHÔNG suy từ tồn
            đã clamp. Điều chỉnh tay hiển thị riêng nếu khác 0 để math reconcile. */}
        <div className="text-muted-foreground grid grid-cols-2 gap-x-4 border-t pt-2 text-sm">
          <span>{t("purchased")}</span>
          <span className="text-right">
            {stock.totalPurchasedQua} {t("piece")}
          </span>
          <span>{t("used")}</span>
          <span className="text-right">
            {stock.totalUsedQua} {t("piece")}
          </span>
          {stock.adjustQua !== 0 && (
            <>
              <span>{t("adjust")}</span>
              <span className="text-right">
                {stock.adjustQua > 0 ? "+" : ""}
                {stock.adjustQua} {t("piece")}
              </span>
            </>
          )}
          <span className="text-foreground font-medium">{t("onHand")}</span>
          <span className="text-foreground text-right font-medium">
            {stock.currentStockQua} {t("piece")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
