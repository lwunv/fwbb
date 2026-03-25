"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatK } from "@/lib/utils";
import { Package, Pencil, Check, X, Minus, Plus } from "lucide-react";
import { setStockQua } from "@/actions/inventory";
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
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">{stock.brandName}</div>
              <div className="text-xs text-muted-foreground">
                {formatK(stock.pricePerTube)}/{t("tube")}
              </div>
            </div>
          </div>
          {!stock.isActive && (
            <Badge variant="secondary">Ngừng</Badge>
          )}
        </div>

        {/* Stock display */}
        {editing ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center">
                <Button variant="outline" size="icon" className="h-10 w-10 rounded-r-none border-r-0 shrink-0" onClick={() => setEditOng(Math.max(0, editOng - 1))}>
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  value={editOng}
                  onChange={(e) => setEditOng(Math.max(0, Number(e.target.value) || 0))}
                  min={0}
                  className="h-10 w-12 text-base text-center rounded-none border-x-0"
                  autoFocus
                />
                <Button variant="outline" size="icon" className="h-10 w-10 rounded-l-none border-l-0 shrink-0" onClick={() => setEditOng(editOng + 1)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <span className="text-sm text-muted-foreground">{t("tube")}</span>
              <div className="flex items-center">
                <Button variant="outline" size="icon" className="h-10 w-10 rounded-r-none border-r-0 shrink-0" onClick={() => setEditQua(Math.max(0, editQua - 1))}>
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  value={editQua}
                  onChange={(e) => setEditQua(Math.min(11, Math.max(0, Number(e.target.value) || 0)))}
                  min={0}
                  max={11}
                  className="h-10 w-12 text-base text-center rounded-none border-x-0"
                />
                <Button variant="outline" size="icon" className="h-10 w-10 rounded-l-none border-l-0 shrink-0" onClick={() => setEditQua(Math.min(11, editQua + 1))}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <span className="text-sm text-muted-foreground">{t("piece")}</span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 h-9"
                onClick={async () => {
                  await setStockQua(stock.brandId, editOng * 12 + editQua);
                  setEditing(false);
                }}
              >
                <Check className="h-4 w-4 mr-1" />
                {t("save")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-9"
                onClick={() => { setEditing(false); setEditOng(stock.ong); setEditQua(stock.qua); }}
              >
                <X className="h-4 w-4 mr-1" />
                {t("cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-primary">
                {stock.ong}
              </span>
              <span className="text-sm text-muted-foreground">{t("tube")}</span>
              <span className="text-2xl font-bold text-primary">
                {stock.qua}
              </span>
              <span className="text-sm text-muted-foreground">{t("piece")}</span>
              <span className="text-xs text-muted-foreground">
                ({stock.currentStockQua} {t("piece")})
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 ml-auto"
              onClick={() => { setEditOng(stock.ong); setEditQua(stock.qua); setEditing(true); }}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              {t("edit")}
            </Button>
          </div>
        )}

        {/* Details: Đã mua includes adjustment so math always works */}
        <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground border-t pt-2">
          <span>Đã mua:</span>
          <span className="text-right">{stock.currentStockQua + stock.totalUsedQua} {t("piece")}</span>
          <span>Đã dùng:</span>
          <span className="text-right">{stock.totalUsedQua} {t("piece")}</span>
          <span className="font-medium text-foreground">Tồn kho:</span>
          <span className="text-right font-medium text-foreground">{stock.currentStockQua} {t("piece")}</span>
        </div>
      </CardContent>
    </Card>
  );
}
