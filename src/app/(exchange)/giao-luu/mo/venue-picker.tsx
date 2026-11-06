"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MapPin, ChevronRight } from "lucide-react";
import { listVenuesNear } from "@/actions/venues";
import { formatDistance } from "@/lib/geo";
import { useIsMobile } from "@/lib/use-is-mobile";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { LocationFallback } from "@/components/venues/location-fallback";
import { useUserLocation } from "@/components/venues/use-user-location";

export type PickedVenue = { id: number; name: string };

const RADIUS_KM = 10;

/**
 * Chọn sân từ danh bạ quanh người dùng. Chỉ xin vị trí khi mở bảng chọn (không
 * hỏi ngay lúc vào form), và vị trí không lưu đi đâu ngoài request tìm sân.
 */
export function VenuePicker({
  value,
  onChange,
  invalid,
  errorId,
}: {
  value: PickedVenue | null;
  onChange: (v: PickedVenue) => void;
  invalid?: boolean;
  /** Id của dòng lỗi bên ngoài; `button` không hỗ trợ `aria-invalid`. */
  errorId?: string;
}) {
  const t = useTranslations("exchange.form");
  const locale = useLocale() as "vi" | "en" | "zh";
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const loc = useUserLocation();
  const { request } = loc;
  const pos = loc.position;

  const query = useQuery({
    queryKey: ["exchange-venue-pick", pos?.lat.toFixed(3), pos?.lng.toFixed(3)],
    queryFn: async () => {
      const r = await listVenuesNear({
        lat: pos!.lat,
        lng: pos!.lng,
        radiusKm: RADIUS_KM,
      });
      if ("error" in r) throw new Error(r.error);
      return r.venues;
    },
    enabled: open && loc.status === "ok" && pos !== null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  function handleOpen(next: boolean) {
    setOpen(next);
    if (next && loc.status === "idle") request();
  }

  const needsAddress = loc.status === "denied" || loc.status === "unsupported";
  const venues = query.data ?? [];

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpen(true)}
        aria-describedby={invalid ? errorId : undefined}
        className={cn(
          "bg-background flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left text-base",
          invalid && "border-destructive",
        )}
      >
        <MapPin className="text-primary h-5 w-5 shrink-0" aria-hidden />
        <span
          className={cn("flex-1 truncate", !value && "text-muted-foreground")}
        >
          {value ? value.name : t("venuePick")}
        </span>
        {value ? (
          <span className="text-primary shrink-0 text-sm font-medium">
            {t("venueChange")}
          </span>
        ) : (
          <ChevronRight className="text-muted-foreground h-5 w-5" aria-hidden />
        )}
      </button>

      <Sheet open={open} onOpenChange={handleOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className="max-h-[85dvh] sm:max-h-none"
        >
          <SheetHeader>
            <SheetTitle className="text-lg">{t("venueSheetTitle")}</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 overflow-y-auto px-4 pb-6">
            {needsAddress && (
              <LocationFallback
                onLocated={(p, label) => loc.setManual(p, label)}
                onRetryGps={request}
              />
            )}
            {!needsAddress && (loc.status === "asking" || query.isPending) && (
              <div className="space-y-2" aria-label={t("venueLocating")}>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
                ))}
              </div>
            )}
            {query.isError && (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <p className="text-base">{t("venueError")}</p>
                <Button className="min-h-11" onClick={() => query.refetch()}>
                  {t("venueRetry")}
                </Button>
              </div>
            )}
            {query.isSuccess && venues.length === 0 && (
              <p className="text-muted-foreground py-4 text-center text-base">
                {t("venueNone")}
              </p>
            )}
            {venues.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  onChange({ id: v.id, name: v.name });
                  setOpen(false);
                }}
                className="bg-card hover:bg-accent flex min-h-[72px] w-full items-center gap-3 rounded-xl border p-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold">{v.name}</p>
                  {(v.address || v.areaLabel) && (
                    <p className="text-muted-foreground line-clamp-2 text-sm">
                      {v.address || v.areaLabel}
                    </p>
                  )}
                </div>
                <span className="bg-accent shrink-0 rounded-full px-2.5 py-1 text-sm font-medium tabular-nums">
                  {formatDistance(v.distanceM, locale)}
                </span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
