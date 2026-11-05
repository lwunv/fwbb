"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MapPin, Search } from "lucide-react";
import type { LatLng } from "@/lib/geo";
import type { PublicVenue } from "@/lib/public-venue";
import type { MapPoint } from "@/lib/map/map-points";
import { useIsMobile } from "@/lib/use-is-mobile";
import { LazyMapView } from "@/components/map/lazy-map-view";
import { VenueCard } from "@/components/venues/venue-card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

type Venue = PublicVenue & { distanceM?: number };

type Props = {
  points: MapPoint[];
  center: LatLng;
  radiusKm: number;
  userPosition: LatLng | null;
  /** Sân đang chọn (đã tra từ danh sách hiện tại), null nếu chưa chọn. */
  selectedVenue: Venue | null;
  selectedId: number | null;
  locale: "vi" | "en" | "zh";
  showSearchHere: boolean;
  /** Đang tải lại sân (đổi khu vực/bán kính): ghim cũ vẫn hiện. */
  loading?: boolean;
  /** Lỗi tải hoặc không có sân: hiện đè lên bản đồ để không bị đẩy ra ngoài màn hình. */
  notice?: ReactNode;
  onSelect: (id: number | null) => void;
  onMoveEnd: (center: LatLng) => void;
  onSearchHere: () => void;
  onUnsupported: () => void;
};

/**
 * Bản đồ + thẻ sân đang chọn. Điện thoại: bottom sheet. Từ `sm:`: panel cạnh
 * bản đồ. Component này không tự gọi server: mọi thay đổi tâm tìm kiếm đi qua
 * `onSearchHere` để màn cha giữ một nguồn sự thật cho queryKey.
 */
export function VenueMapPanel({
  points,
  center,
  radiusKm,
  userPosition,
  selectedVenue,
  selectedId,
  locale,
  showSearchHere,
  loading = false,
  notice = null,
  onSelect,
  onMoveEnd,
  onSearchHere,
  onUnsupported,
}: Props) {
  const t = useTranslations("venues");
  const isMobile = useIsMobile();

  return (
    <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_20rem] sm:items-start sm:gap-4">
      <div className="relative">
        <LazyMapView
          points={points}
          center={center}
          radiusKm={radiusKm}
          userPosition={userPosition}
          selectedId={selectedId}
          onPointClick={(p) => onSelect(p.id)}
          onMoveEnd={onMoveEnd}
          cooperativeGestures={isMobile}
          onUnsupported={onUnsupported}
        />
        <AnimatePresence>
          {showSearchHere && (
            <motion.button
              key="search-here"
              type="button"
              onClick={onSearchHere}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-primary text-primary-foreground absolute top-3 left-1/2 z-10 inline-flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full px-5 text-base font-medium shadow-lg"
            >
              <Search className="h-4 w-4" />
              {t("searchThisArea")}
            </motion.button>
          )}
          {loading && (
            <motion.div
              key="loading"
              role="status"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-card/80 absolute top-3 left-1/2 z-10 inline-flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full border px-5 text-base font-medium shadow-lg backdrop-blur"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("loadingVenues")}
            </motion.div>
          )}
        </AnimatePresence>
        {/* bottom-16 chừa chỗ cho ô attribution (bắt buộc nhìn thấy, 44px). */}
        {notice && (
          <div className="bg-card/90 absolute inset-x-3 bottom-16 z-10 rounded-2xl border p-4 shadow-lg backdrop-blur">
            {notice}
          </div>
        )}
      </div>

      {!isMobile && (
        <aside className="hidden sm:block">
          <AnimatePresence mode="wait" initial={false}>
            {selectedVenue ? (
              <motion.div
                key={selectedVenue.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <VenueCard venue={selectedVenue} locale={locale} />
              </motion.div>
            ) : (
              <motion.div
                key="hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="bg-card/80 text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center backdrop-blur"
              >
                <MapPin className="size-8" aria-hidden />
                <p className="text-base">{t("pinHint")}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      )}

      {isMobile && (
        <Sheet
          open={selectedVenue !== null}
          onOpenChange={(open) => {
            if (!open) onSelect(null);
          }}
        >
          <SheetContent side="bottom" className="gap-0 p-4 pt-12">
            <SheetTitle className="sr-only">
              {selectedVenue?.name ?? t("showMap")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {selectedVenue?.address ?? ""}
            </SheetDescription>
            {selectedVenue && (
              <VenueCard venue={selectedVenue} locale={locale} />
            )}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
