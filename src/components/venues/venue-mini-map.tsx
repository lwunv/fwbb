"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LazyMapView } from "@/components/map/lazy-map-view";
import { venuesToPoints } from "@/lib/map/map-points";
import { directionsUrl } from "@/lib/maps-link";
import type { PublicVenue } from "@/lib/public-venue";

/**
 * Bản đồ nhỏ ở trang chi tiết sân. Không kéo/zoom được để không cướp cuộn
 * trang; cả khung là một link mở chỉ đường. Máy không có WebGL thì ẩn hẳn
 * (nút "Chỉ đường" của trang vẫn dùng được), không để khung trống.
 */
export function VenueMiniMap({
  venue,
}: {
  venue: Pick<PublicVenue, "id" | "name" | "lat" | "lng">;
}) {
  const t = useTranslations("venues");
  const [unsupported, setUnsupported] = useState(false);
  if (unsupported) return null;

  return (
    <div className="relative">
      <LazyMapView
        points={venuesToPoints([venue])}
        center={{ lat: venue.lat, lng: venue.lng }}
        interactive={false}
        className="aspect-[16/9] h-auto rounded-xl"
        onUnsupported={() => setUnsupported(true)}
      />
      {/* Lớp phủ nằm trên ghim nên nhận cú chạm; ghim bị vô hiệu ở chế độ
          không tương tác (xem MapView) nên chỉ còn một link để Tab tới. */}
      <a
        href={directionsUrl(venue)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("directionsTo", { name: venue.name })}
        className="focus-visible:outline-ring absolute inset-0 z-10 rounded-xl focus-visible:outline-2"
      />
    </div>
  );
}
