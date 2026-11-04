"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
// Chỉ lấy kiểu: import giá trị từ map-view sẽ kéo maplibre-gl vào bundle trang.
import type { MapViewProps } from "./map-view";

const DynamicMapView = dynamic<MapViewProps>(
  () => import("./map-view").then((m) => m.MapView),
  {
    ssr: false,
    loading: () => <Skeleton className="absolute inset-0 rounded-none" />,
  },
);

/**
 * `MapView` nạp lười: `maplibre-gl` chỉ tải khi component này được render.
 * Khung ngoài giữ đúng kích thước (`className` của màn cha) cho cả skeleton
 * lẫn bản đồ, nên trang không nhảy khi thư viện nạp xong.
 */
export function LazyMapView({ className, ...props }: MapViewProps) {
  return (
    <div
      className={cn(
        "relative h-[60dvh] w-full overflow-hidden rounded-2xl border",
        className,
      )}
    >
      <DynamicMapView
        {...props}
        className="absolute inset-0 h-auto rounded-none border-0"
      />
    </div>
  );
}
