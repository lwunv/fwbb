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
import type { StockByBrand } from "@/actions/inventory";

interface StockCardProps {
  stock: StockByBrand;
}

export function StockCard({ stock }: StockCardProps) {
  const t = useTranslations("inventory");
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
              <div className="text-muted-foreground text-xs">
                {formatK(stock.pricePerTube)}/{t("tube")}
              </div>
            </div>
          </div>
          {!stock.isActive && <Badge variant="secondary">Ngừng</Badge>}
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
                className="h-9 flex-1"
                onClick={() => {
                  const prevOng = editOng;
                  const prevQua = editQua;
                  setEditing(false);
                  fireAction(
                    () => setStockQua(stock.brandId, editOng * 12 + editQua),
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
                className="h-9 flex-1"
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
              className="ml-auto"
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

        {/* Details: Đã mua includes adjustment so math always works */}
        <div className="text-muted-foreground grid grid-cols-2 gap-x-4 border-t pt-2 text-xs">
          <span>Đã mua:</span>
          <span className="text-right">
            {stock.currentStockQua + stock.totalUsedQua} {t("piece")}
          </span>
          <span>Đã dùng:</span>
          <span className="text-right">
            {stock.totalUsedQua} {t("piece")}
          </span>
          <span className="text-foreground font-medium">Tồn kho:</span>
          <span className="text-foreground text-right font-medium">
            {stock.currentStockQua} {t("piece")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
