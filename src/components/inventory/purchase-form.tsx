"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { NumberStepper } from "@/components/ui/number-stepper";
import { CustomSelect } from "@/components/ui/custom-select";
import { recordPurchase } from "@/actions/inventory";
import { fireAction } from "@/lib/optimistic-action";
import { formatK } from "@/lib/utils";
import { ymdInVN } from "@/lib/date-format";
import { Plus, Loader2 } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type {
  shuttlecockBrands as brandsTable,
  inventoryPurchases as purchasesTable,
} from "@/db/schema";

type Brand = InferSelectModel<typeof brandsTable>;
type Purchase = InferSelectModel<typeof purchasesTable> & { brand: Brand };

interface PurchaseFormProps {
  brands: Brand[];
  /** Optimistically insert the new purchase row + bump the brand's stock in
   * the parent (InventoryClient owns both lists). Called before the server
   * write so the new row + moved stock number appear on submit. */
  onOptimisticAdd?: (ghost: Purchase, brandId: number, tubes: number) => void;
  /** Reverse the optimistic insert if the server write fails. */
  onRollbackAdd?: (ghostId: number, brandId: number, tubes: number) => void;
}

export function PurchaseForm({
  brands,
  onOptimisticAdd,
  onRollbackAdd,
}: PurchaseFormProps) {
  const t = useTranslations("inventory");
  const router = useRouter();
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);
  const [selectedBrandId, setSelectedBrandId] = useState<string>(
    brands.length > 0 ? String(brands[0].id) : "",
  );
  const [tubes, setTubes] = useState(1);
  const [pricePerTube, setPricePerTube] = useState<number>(
    brands.length > 0 ? brands[0].pricePerTube : 0,
  );
  // Ngày mặc định theo giờ VN, KHÔNG dùng toISOString() (UTC) — nếu không, mở
  // form lúc 00:00-07:00 VN sẽ mặc định về hôm qua.
  const [purchasedAt, setPurchasedAt] = useState(ymdInVN());
  const [notes, setNotes] = useState("");

  function handleBrandChange(val: string) {
    setSelectedBrandId(val);
    const brand = brands.find((b) => b.id === Number(val));
    if (brand) {
      setPricePerTube(brand.pricePerTube);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBrandId || selectedBrandId === "") return;

    // idempotencyKey per submit — DB UNIQUE chặn double-write nếu admin
    // double-click form (form đã reset → trông như submit lại được).
    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `purchase-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const formData = new FormData();
    formData.set("brandId", String(selectedBrandId));
    formData.set("tubes", String(tubes));
    formData.set("pricePerTube", String(pricePerTube));
    formData.set("purchasedAt", purchasedAt);
    formData.set("notes", notes);
    formData.set("idempotencyKey", idempotencyKey);

    // Optimistic: chèn ngay dòng mua mới + cộng tồn kho ở parent (ghost row với
    // id âm) để user thấy kết quả tức thì; router.refresh() bên dưới sẽ thay
    // ghost bằng dòng thật. Money math server-side không đổi.
    const brand = brands.find((b) => b.id === Number(selectedBrandId));
    const ghostId = -Date.now();
    const capturedTubes = tubes;
    const capturedBrandId = Number(selectedBrandId);
    if (brand) {
      const ghost: Purchase = {
        id: ghostId,
        brandId: brand.id,
        tubes: capturedTubes,
        pricePerTube,
        totalPrice: capturedTubes * pricePerTube,
        purchasedAt,
        notes: notes || null,
        createdAt: new Date().toISOString(),
        brand,
      };
      onOptimisticAdd?.(ghost, capturedBrandId, capturedTubes);
    }

    // Loading-first: hiện spinner trong lúc ghi (user cần thấy feedback), rồi
    // reset form + refresh khi thành công. Refresh ngay để tồn kho + lịch sử
    // mua cập nhật tức thì thay vì chờ lượt polling 5s (đây là lý do trước
    // đây "nhập mua mà tồn kho không đổi").
    setPending(true);
    fireAction(
      () => recordPurchase(formData),
      // Rollback: gỡ ghost row + trừ lại tồn kho khi ghi thất bại.
      brand
        ? () => onRollbackAdd?.(ghostId, capturedBrandId, capturedTubes)
        : undefined,
      {
        onSuccess: () => {
          setPending(false);
          setTubes(1);
          setNotes("");
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3000);
          router.refresh();
        },
        onError: () => setPending(false),
      },
    );
  }

  const totalPrice = tubes * pricePerTube;

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-3 font-semibold">{t("purchaseShuttle")}</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Brand */}
          <div>
            <Label>{t("brandField")}</Label>
            <CustomSelect
              value={selectedBrandId}
              onChange={handleBrandChange}
              placeholder={t("selectBrand")}
              options={brands.map((b) => ({
                value: String(b.id),
                label: `${b.name} (${formatK(b.pricePerTube)}/${t("tube")})`,
              }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Tubes */}
            <div className="space-y-1">
              <Label>{t("tubesCount")}</Label>
              <NumberStepper
                value={tubes}
                onChange={setTubes}
                min={1}
                max={99}
              />
            </div>

            {/* Price per tube */}
            <div className="space-y-1">
              <Label>{t("pricePerTubeShort")}</Label>
              <NumberStepper
                value={pricePerTube}
                onChange={setPricePerTube}
                min={0}
                step={5000}
                displayFormat="vnd"
              />
            </div>
          </div>

          {/* Date */}
          <div>
            <Label>{t("purchaseDate")}</Label>
            <Input
              type="date"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div>
            <Label>{t("notesLabel")}</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("notesOptional")}
            />
          </div>

          {/* Total */}
          {totalPrice > 0 && (
            <div className="text-muted-foreground text-sm">
              {t("totalWithAmount", { amount: formatK(totalPrice) })}
            </div>
          )}

          <Button
            type="submit"
            disabled={!selectedBrandId || pending}
            className="w-full"
          >
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {pending ? t("saving") : t("recordPurchase")}
          </Button>

          {success && <p className="text-primary text-sm">{t("savedOk")}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
