"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Navigation } from "lucide-react";
import { LazyMapView } from "@/components/map/lazy-map-view";
import { venuesToPoints } from "@/lib/map/map-points";
import { hasWebGL2 } from "@/lib/map/webgl";
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
  // Kiểm ngay lúc render đầu để máy không có WebGL không thấy khung xương
  // rồi biến mất. Lazy init chỉ chạy ở client, còn server luôn coi là hỗ trợ.
  const [unsupported, setUnsupported] = useState(() => !hasWebGL2());
  if (unsupported) return null;

  return (
    // Ô attribution của maplibre phải nổi trên lớp link để còn chạm được. Cần
    // `!`: maplibre-gl.css (`z-index: 2`) không nằm trong layer nào nên thắng
    // mọi utility trong `@layer utilities` của Tailwind.
    <div className="relative [&_.maplibregl-ctrl-bottom-right]:z-20!">
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
      >
        {/* Chỉ để nhìn: cả khung là link nên nút này không cần nhận chạm riêng. */}
        <span
          aria-hidden
          className="bg-card/80 absolute bottom-2 left-2 inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium backdrop-blur"
        >
          <Navigation className="size-4" />
          {t("directions")}
        </span>
      </a>
    </div>
  );
}
