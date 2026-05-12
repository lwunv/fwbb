"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { selectCourt, setSessionCourtPriceOverride } from "@/actions/sessions";
import { fireAction } from "@/lib/optimistic-action";
import { formatK } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { computeCourtTotal } from "@/lib/cost-calculator";
import { ChevronDown, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { PriceOverrideSheet } from "@/components/sessions/price-override-sheet";
import type { InferSelectModel } from "drizzle-orm";
import type { courts as courtsTable } from "@/db/schema";

type Court = InferSelectModel<typeof courtsTable>;

export function CourtSelector({
  sessionId,
  courts,
  currentCourtId,
  currentCourtQuantity = 1,
  currentCourtPrice = null,
  isCourtPriceOverridden = false,
  sessionDate,
  defaultCourtId = null,
}: {
  sessionId: number;
  courts: Court[];
  currentCourtId: number | null;
  currentCourtQuantity?: number;
  /** Tiền sân hiện tại lưu trên session (có thể là override hoặc auto). */
  currentCourtPrice?: number | null;
  /** True nếu admin đã override giá sân thủ công cho buổi này. */
  isCourtPriceOverridden?: boolean;
  /** YYYY-MM-DD — cần để tính buổi mặc định/lẻ. Nếu thiếu, fallback giá tháng. */
  sessionDate?: string;
  /** Default court id từ app-settings — quyết định buổi mặc định. */
  defaultCourtId?: number | null;
}) {
  const [localCourtId, setLocalCourtId] = useState(currentCourtId);
  const [quantity, setQuantity] = useState(currentCourtQuantity);
  const [open, setOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  // Mirror price overridden state ở client để price column update optimistic
  // ngay khi admin lưu / reset, tránh "nhấp nháy" chờ revalidate.
  const [overriddenLocal, setOverriddenLocal] = useState(
    isCourtPriceOverridden,
  );
  const [overridePriceLocal, setOverridePriceLocal] = useState<number | null>(
    isCourtPriceOverridden ? (currentCourtPrice ?? null) : null,
  );
  const tOverride = useTranslations("priceOverride");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    setLocalCourtId(currentCourtId);
  }, [currentCourtId]);
  useEffect(() => {
    setQuantity(currentCourtQuantity);
  }, [currentCourtQuantity]);
  // Resync override state khi server prop đổi (sau revalidate, hoặc khi
  // selectCourt() reset cờ về false ở server).
  useEffect(() => {
    setOverriddenLocal(isCourtPriceOverridden);
    setOverridePriceLocal(
      isCourtPriceOverridden ? (currentCourtPrice ?? null) : null,
    );
  }, [isCourtPriceOverridden, currentCourtPrice]);

  useEffect(() => {
    if (!open) return;
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      )
        return;
      setOpen(false);
    }
    function handleScroll() {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  function handleSelect(courtId: number) {
    const prevCourtId = localCourtId;
    const prevOverridden = overriddenLocal;
    const prevOverridePrice = overridePriceLocal;
    setLocalCourtId(courtId);
    setOpen(false);
    // Đổi sân = intent auto formula → clear override local ngay để price
    // column hiển thị giá auto cho sân mới (server side `selectCourt` cũng
    // reset cờ).
    setOverriddenLocal(false);
    setOverridePriceLocal(null);
    fireAction(
      () => selectCourt(sessionId, courtId, quantity),
      () => {
        setLocalCourtId(prevCourtId);
        setOverriddenLocal(prevOverridden);
        setOverridePriceLocal(prevOverridePrice);
      },
    );
  }

  function handleToggleDouble(checked: boolean) {
    const newQty = checked ? 2 : 1;
    const prevQty = quantity;
    const prevOverridden = overriddenLocal;
    const prevOverridePrice = overridePriceLocal;
    setQuantity(newQty);
    setOverriddenLocal(false);
    setOverridePriceLocal(null);
    if (localCourtId) {
      fireAction(
        () => selectCourt(sessionId, localCourtId, newQty),
        () => {
          setQuantity(prevQty);
          setOverriddenLocal(prevOverridden);
          setOverridePriceLocal(prevOverridePrice);
        },
      );
    }
  }

  function handleOverrideSave(value: number) {
    const prevOverridden = overriddenLocal;
    const prevOverridePrice = overridePriceLocal;
    setOverriddenLocal(true);
    setOverridePriceLocal(value);
    fireAction(
      () => setSessionCourtPriceOverride(sessionId, value),
      () => {
        setOverriddenLocal(prevOverridden);
        setOverridePriceLocal(prevOverridePrice);
      },
    );
  }

  function handleOverrideReset() {
    const prevOverridden = overriddenLocal;
    const prevOverridePrice = overridePriceLocal;
    setOverriddenLocal(false);
    setOverridePriceLocal(null);
    fireAction(
      () => setSessionCourtPriceOverride(sessionId, null),
      () => {
        setOverriddenLocal(prevOverridden);
        setOverridePriceLocal(prevOverridePrice);
      },
    );
  }

  if (courts.length === 0) {
    return <p className="text-muted-foreground text-sm">Chưa có sân nào.</p>;
  }

  // Khớp với server-side `selectCourt` (dùng cùng `computeCourtTotal`):
  //  - Buổi mặc định (default court + ngày T2/T4/T6): sân #1 giá tháng,
  //    sân #2..N giá lẻ.
  //  - Buổi lẻ: TẤT CẢ sân giá lẻ.
  // Nếu thiếu sessionDate (legacy caller), fallback regular formula để không
  // underprice — admin chỉ thấy lệch 1 buổi đầu cho đến khi prop được truyền.
  function totalForCourt(court: Court, qty: number) {
    if (!sessionDate) {
      const monthly = court.pricePerSession;
      const retail = court.pricePerSessionRetail ?? monthly;
      const q = Math.max(1, qty);
      return monthly + retail * (q - 1);
    }
    return computeCourtTotal({
      monthlyPrice: court.pricePerSession,
      retailPrice: court.pricePerSessionRetail,
      courtQuantity: qty,
      sessionDate,
      selectedCourtId: court.id,
      defaultCourtId,
    });
  }

  const selectedCourt = courts.find((c) => c.id === localCourtId);
  const autoPrice = selectedCourt ? totalForCourt(selectedCourt, quantity) : 0;
  // Hiển thị giá override nếu có, ngược lại fallback auto. Truyền `autoPrice`
  // làm "Mặc định" trong sheet để admin biết giá nào sẽ áp dụng khi Reset.
  const displayPrice =
    overriddenLocal && overridePriceLocal !== null
      ? overridePriceLocal
      : autoPrice;

  return (
    <div>
      {/* Trigger + total — same row, total OUTSIDE button (đồng bộ với layout
          shuttle picker total). */}
      <div className="flex items-center gap-2">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(!open)}
          className={cn(
            "bg-card hover:border-primary/50 flex h-12 min-w-0 flex-1 items-center gap-2 rounded-xl border-2 px-4 text-base transition-colors",
            open && "border-primary",
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              !selectedCourt && "text-muted-foreground",
            )}
          >
            {selectedCourt
              ? `${selectedCourt.name}${quantity > 1 ? ` · ${quantity} sân` : ""}`
              : "Chọn sân..."}
          </span>
          <ChevronDown
            className={cn(
              "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        {/* Min-w cố định để price column luôn cùng kích thước → trigger button
            cùng width dù giá khác nhau (court vs shuttle vs other rows).
            Icon ✏️ inline để admin override giá sân thủ công cho buổi này. */}
        <button
          type="button"
          onClick={() => selectedCourt && setOverrideOpen(true)}
          disabled={!selectedCourt}
          className={cn(
            "group inline-flex min-w-20 shrink-0 items-center justify-end gap-1 rounded-lg px-1 py-0.5 text-right text-base font-bold tabular-nums transition-colors",
            overriddenLocal
              ? "text-amber-600 dark:text-amber-400"
              : "text-primary",
            selectedCourt && "hover:bg-muted/60",
            !selectedCourt && "cursor-not-allowed opacity-50",
          )}
          aria-label={tOverride("courtAria")}
        >
          {selectedCourt && (
            <Pencil
              className={cn(
                "h-3 w-3 shrink-0 transition-opacity",
                overriddenLocal
                  ? "opacity-90"
                  : "opacity-40 group-hover:opacity-90",
              )}
            />
          )}
          <span>{selectedCourt ? formatK(displayPrice) : ""}</span>
        </button>
      </div>
      {overriddenLocal && selectedCourt && (
        <p className="mt-1 text-right text-xs text-amber-600 dark:text-amber-400">
          {tOverride("courtCustomCaption", { amount: formatK(autoPrice) })}
        </p>
      )}

      <PriceOverrideSheet
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        title={tOverride("courtTitle")}
        inputLabel={tOverride("courtInputLabel")}
        currentValue={displayPrice}
        defaultValue={autoPrice}
        isOverridden={overriddenLocal}
        onSave={handleOverrideSave}
        onReset={handleOverrideReset}
      />

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: pos.width,
            }}
            className="bg-popover animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 z-[9999] overflow-hidden rounded-xl border shadow-lg"
          >
            {/* Double court checkbox */}
            <label className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 border-b px-4 py-3 transition-colors">
              <input
                type="checkbox"
                checked={quantity >= 2}
                onChange={(e) => handleToggleDouble(e.target.checked)}
                className="accent-primary h-5 w-5 rounded"
              />
              <span className="text-base">Thuê 2 sân</span>
            </label>

            {/* Court list */}
            <div className="max-h-96 overflow-auto py-1">
              {courts.map((court) => {
                const isSelected = court.id === localCourtId;
                const courtTotal = totalForCourt(court, quantity);
                return (
                  <button
                    key={court.id}
                    type="button"
                    onClick={() => handleSelect(court.id)}
                    className={cn(
                      "mx-1 flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-base transition-colors first:mt-1 last:mb-1",
                      isSelected
                        ? "bg-primary/15 font-medium"
                        : "hover:bg-muted/50",
                    )}
                    style={{ width: "calc(100% - 0.5rem)" }}
                  >
                    <span className="truncate">{court.name}</span>
                    <span className="text-primary shrink-0 text-sm font-medium">
                      {formatK(courtTotal)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
