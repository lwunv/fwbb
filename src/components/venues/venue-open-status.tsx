"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  openStatus,
  parseOpenHours,
  type OpenStatus,
} from "@/lib/venues/open-hours";

const STATUS_KEY = {
  open: "openNow",
  closed: "closedNow",
  unknown: "hoursUnknown",
} as const satisfies Record<OpenStatus, string>;

// Chấm màu chỉ giúp nhìn nhanh; chữ "Đang mở/Đã đóng" mới là thông tin.
const STATUS_DOT: Record<OpenStatus, string | null> = {
  open: "bg-accent",
  closed: "bg-destructive",
  unknown: null,
};

/** Trễ một chút sau mốc phút để chắc phút mới đã sang khi tính lại. */
const MINUTE_SLACK_MS = 250;

function msToNextMinute(): number {
  return 60_000 - (Date.now() % 60_000) + MINUTE_SLACK_MS;
}

/**
 * Trạng thái mở cửa ở trang chi tiết sân. Lần vẽ đầu dùng đúng trạng thái
 * server đã tính nên không lệch hydrate. Sau đó tự tính lại ở máy: ngay khi gắn
 * (trang lấy từ cache có thể đã cũ), khi tab hiện lại (Zalo/Messenger khôi phục
 * tab sau nhiều giờ) và mỗi mốc phút khi tab đang hiện. Không gọi server; tab
 * ẩn thì không giữ hẹn giờ nào.
 */
export function VenueOpenStatus({
  hours,
  initialStatus,
}: {
  hours: string;
  initialStatus: OpenStatus;
}) {
  const t = useTranslations("venues");
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    // Giờ không đọc được thì trạng thái không bao giờ đổi, khỏi hẹn giờ.
    if (parseOpenHours(hours) === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const tick = () => {
      setStatus(openStatus(hours, new Date()));
      timer = setTimeout(tick, msToNextMinute());
    };
    const onVisibilityChange = () => {
      stop();
      if (document.visibilityState === "visible") tick();
    };
    if (document.visibilityState === "visible") timer = setTimeout(tick, 0);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hours]);

  const dot = STATUS_DOT[status];
  return (
    <span>
      {dot && (
        <span
          aria-hidden
          className={`mr-2 inline-block size-2 rounded-full align-middle ${dot}`}
        />
      )}
      {t("openStatusWithHours", { status: t(STATUS_KEY[status]), hours })}
    </span>
  );
}
