"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  addSessionShuttlecocks,
  removeSessionShuttlecock,
  setSessionShuttlecockPriceOverride,
} from "@/actions/sessions";
import { fireAction } from "@/lib/optimistic-action";
import { formatK } from "@/lib/utils";
import {
  calculateShuttlecockCost,
  computeShuttlecockTotal,
} from "@/lib/cost-calculator";
import { NumberStepper } from "@/components/ui/number-stepper";
import { ChevronDown, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { PriceOverrideSheet } from "@/components/sessions/price-override-sheet";
import type { InferSelectModel } from "drizzle-orm";
import type {
  shuttlecockBrands as brandsTable,
  sessionShuttlecocks as sessionShuttlecocksTable,
} from "@/db/schema";

type Brand = InferSelectModel<typeof brandsTable>;
type SessionShuttlecock = InferSelectModel<typeof sessionShuttlecocksTable> & {
  brand: Brand;
};

export function ShuttlecockSelector({
  sessionId,
  brands,
  currentShuttlecocks,
}: {
  sessionId: number;
  brands: Brand[];
  currentShuttlecocks: SessionShuttlecock[];
}) {
  const [items, setItems] = useState<SessionShuttlecock[]>(currentShuttlecocks);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [overrideTargetId, setOverrideTargetId] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const tOverride = useTranslations("priceOverride");
  const ts = useTranslations("adminShuttlecocks");
  // Counter cấp id âm cho optimistic entry (chưa server-confirmed). Dùng
  // ref counter thay `Date.now()` để tránh `react-hooks/purity` lint flag
  // (Date.now là impure trong scope render-tracked).
  const optimisticIdRef = useRef(-1);

  useEffect(() => {
    setItems(currentShuttlecocks);
  }, [currentShuttlecocks]);

  // Position dropdown over trigger when opened.
  useEffect(() => {
    if (!pickerOpen) return;
    function update() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [pickerOpen]);

  // Click outside closes the dropdown.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || dropdownRef.current?.contains(t)) {
        return;
      }
      setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  function handleQuantityChange(item: SessionShuttlecock, newQty: number) {
    const prevItems = items;
    setItems((prev) =>
      prev.map((s) => (s.id === item.id ? { ...s, quantityUsed: newQty } : s)),
    );
    fireAction(
      () => addSessionShuttlecocks(sessionId, item.brandId, newQty),
      () => {
        setItems(prevItems);
      },
    );
  }

  function handleRemove(item: SessionShuttlecock) {
    const prevItems = items;
    setItems((prev) => prev.filter((s) => s.id !== item.id));
    fireAction(
      () => removeSessionShuttlecock(item.id),
      () => {
        setItems(prevItems);
      },
    );
  }

  function handleAddBrand(brand: Brand) {
    const optimisticId = optimisticIdRef.current;
    optimisticIdRef.current -= 1;
    const optimisticEntry = {
      id: optimisticId,
      sessionId,
      brandId: brand.id,
      quantityUsed: 1,
      pricePerTube: brand.pricePerTube,
      brand,
    } as SessionShuttlecock;

    const prevItems = items;
    setItems((prev) => [...prev, optimisticEntry]);
    fireAction(
      () => addSessionShuttlecocks(sessionId, brand.id, 1),
      () => {
        setItems(prevItems);
      },
    );
  }

  function handleToggleBrand(brand: Brand) {
    const existing = items.find((s) => s.brandId === brand.id);
    if (existing) {
      handleRemove(existing);
    } else {
      handleAddBrand(brand);
    }
  }

  function handlePriceOverrideSave(rowId: number, newPrice: number) {
    const prevItems = items;
    setItems((prev) =>
      prev.map((s) => (s.id === rowId ? { ...s, pricePerTube: newPrice } : s)),
    );
    fireAction(
      () => setSessionShuttlecockPriceOverride(rowId, newPrice),
      () => {
        setItems(prevItems);
      },
    );
  }

  function handlePriceOverrideReset(rowId: number, brandDefaultPrice: number) {
    // Optimistic: hiển thị giá brand mặc định ngay; server sẽ snapshot lại từ
    // brand hiện tại — nếu giá brand đổi giữa lúc bấm reset và server ack thì
    // revalidate sẽ sync về số chính xác. Đủ tốt cho UX.
    const prevItems = items;
    setItems((prev) =>
      prev.map((s) =>
        s.id === rowId ? { ...s, pricePerTube: brandDefaultPrice } : s,
      ),
    );
    fireAction(
      () => setSessionShuttlecockPriceOverride(rowId, null),
      () => {
        setItems(prevItems);
      },
    );
  }

  if (brands.length === 0) {
    return <p className="text-muted-foreground text-sm">{ts("noBrands")}</p>;
  }

  // Tổng dùng `computeShuttlecockTotal` (round UP tổng) để khớp với debt
  // sau finalize. Per-brand line dưới vẫn dùng `calculateShuttlecockCost`
  // để hiển thị cost từng hãng riêng. Round UP semantics giữ nguyên — admin
  // không lỗ cầu.
  const totalCost = computeShuttlecockTotal(items);
  const selectedBrandIds = new Set(items.map((s) => s.brandId));

  return (
    <div className="space-y-2">
      {/* Tất cả info cầu (brands đã chọn + nút thêm + tổng) gom vào 1 card
          mờ chung — tránh "385k" lặp 2 dòng nhìn rời rạc; chỉ còn 1 tổng ở
          cuối card. Khi chưa chọn brand nào, card chỉ chứa nút trigger. */}
      <div className="border-primary/25 bg-primary/[0.04] space-y-1.5 rounded-xl border p-2">
        {/* Trigger thêm hãng + tổng tiền cầu cùng 1 hàng — alignment khớp
            với row Court ([trigger flex-1] [price min-w-20]) để 2 row thẳng
            cột số tiền. Bỏ row "Tổng cầu" footer riêng. */}
        <div className="flex items-center gap-2">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className={cn(
              "bg-card hover:border-primary/50 flex h-[42px] min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border-2 px-3 text-sm transition-colors",
              pickerOpen && "border-primary",
              items.length === 0 && "text-muted-foreground",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {items.length === 0 ? "Chọn hãng cầu..." : "+ Thêm hãng cầu..."}
            </span>
            <ChevronDown
              className={cn(
                "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
                pickerOpen && "rotate-180",
              )}
            />
          </button>
          <span className="text-primary inline-block min-w-20 shrink-0 text-right text-base font-bold tabular-nums">
            {totalCost > 0 ? formatK(totalCost) : ""}
          </span>
        </div>

        {items.map((sc) => {
          const cost = calculateShuttlecockCost(
            sc.quantityUsed,
            sc.pricePerTube,
          );
          const isOverridden = sc.pricePerTube !== sc.brand.pricePerTube;
          return (
            <div key={sc.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-base font-semibold">
                🏸 {sc.brand.name}
                {isOverridden && (
                  <span className="ml-1 text-xs font-normal text-amber-600 tabular-nums dark:text-amber-400">
                    ·{" "}
                    {tOverride("shuttleCustomSuffix", {
                      amount: formatK(sc.pricePerTube),
                    })}
                  </span>
                )}
              </span>
              <NumberStepper
                value={sc.quantityUsed}
                onChange={(v) => handleQuantityChange(sc, v)}
                min={1}
                max={99}
              />
              <button
                type="button"
                onClick={() => handleRemove(sc)}
                className="border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setOverrideTargetId(sc.id)}
                className={cn(
                  "group hover:bg-muted/60 inline-flex min-w-20 shrink-0 items-center justify-end gap-1 rounded-lg px-1 py-0.5 text-right text-base font-medium tabular-nums transition-colors",
                  isOverridden
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-primary",
                )}
                aria-label={tOverride("shuttleAria", { brand: sc.brand.name })}
              >
                <Pencil
                  className={cn(
                    "h-3 w-3 shrink-0 transition-opacity",
                    isOverridden
                      ? "opacity-90"
                      : "opacity-40 group-hover:opacity-90",
                  )}
                />
                <span>{formatK(cost)}</span>
              </button>
            </div>
          );
        })}
      </div>

      {(() => {
        const target = items.find((s) => s.id === overrideTargetId);
        if (!target) return null;
        const isOverridden = target.pricePerTube !== target.brand.pricePerTube;
        return (
          <PriceOverrideSheet
            open={overrideTargetId !== null}
            onOpenChange={(open) => {
              if (!open) setOverrideTargetId(null);
            }}
            title={tOverride("shuttleTitle", { brand: target.brand.name })}
            inputLabel={tOverride("shuttleInputLabel")}
            currentValue={target.pricePerTube}
            defaultValue={target.brand.pricePerTube}
            isOverridden={isOverridden}
            onSave={(value) => handlePriceOverrideSave(target.id, value)}
            onReset={() =>
              handlePriceOverrideReset(target.id, target.brand.pricePerTube)
            }
          />
        );
      })()}

      {pickerOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: pos.width,
            }}
            className="bg-popover animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 z-[9999] max-h-96 overflow-auto rounded-xl border shadow-lg"
          >
            {brands.map((b) => {
              const isSelected = selectedBrandIds.has(b.id);
              return (
                <label
                  key={b.id}
                  className={cn(
                    "hover:bg-muted/50 flex cursor-pointer items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0",
                    isSelected && "bg-primary/10",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleBrand(b)}
                    className="accent-primary h-5 w-5 shrink-0 rounded"
                  />
                  <span className="min-w-0 flex-1 truncate text-base font-medium">
                    {b.name}
                  </span>
                  <span className="text-primary shrink-0 text-sm font-medium tabular-nums">
                    {formatK(b.pricePerTube)}
                    {ts("perTube")}
                  </span>
                </label>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
