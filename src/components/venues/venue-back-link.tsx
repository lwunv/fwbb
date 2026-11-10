"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { readListReturn } from "@/lib/venues/directory-state";

const noopSubscribe = () => () => {};
const LIST = "/venues";

/**
 * Nút "Danh sách sân" của trang chi tiết. Mở từ thẻ xem nhanh thì quay về đúng
 * trang danh sách đã rời (bán kính, bộ lọc, khu vực), không phải `/venues`
 * trống. Server và lần hydrate luôn là `/venues` (sessionStorage chỉ có ở
 * máy), ngay sau hydrate mới đổi.
 */
export function VenueBackLink({
  venueId,
  label,
}: {
  venueId: number;
  label: string;
}) {
  const href = useSyncExternalStore(
    noopSubscribe,
    () => readListReturn(venueId) ?? LIST,
    () => LIST,
  );
  return (
    <Link
      href={href}
      className="text-muted-foreground inline-flex min-h-11 items-center gap-1 text-sm"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}
