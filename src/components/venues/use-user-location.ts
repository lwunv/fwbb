"use client";

import { useCallback, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo";

export type LocationStatus =
  | "idle"
  | "asking"
  | "ok"
  | "denied"
  | "unsupported";

/**
 * Hết giờ chờ của riêng mình: trình duyệt nhúng của Zalo/Messenger đôi khi
 * không bao giờ gọi callback (không xin quyền, không báo lỗi). Không có hẹn
 * giờ này thì trang quay mãi thay vì hiện ô nhập địa chỉ.
 */
const SAFETY_TIMEOUT_MS = 12_000;

/**
 * Vị trí người dùng cho trang "quanh đây". Chỉ giữ trong bộ nhớ của trang,
 * không gửi đi đâu ngoài request tìm sân.
 */
export function useUserLocation() {
  const [status, setStatus] = useState<LocationStatus>("idle");
  const [position, setPosition] = useState<LatLng | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const settled = useRef(false);

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      return;
    }
    settled.current = false;
    setStatus("asking");
    const safety = setTimeout(() => {
      if (settled.current) return;
      settled.current = true;
      setStatus("denied");
    }, SAFETY_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled.current) return;
        settled.current = true;
        clearTimeout(safety);
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLabel(null);
        setStatus("ok");
      },
      () => {
        if (settled.current) return;
        settled.current = true;
        clearTimeout(safety);
        setStatus("denied");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, []);

  const setManual = useCallback((p: LatLng, placeLabel: string) => {
    settled.current = true;
    setPosition(p);
    setLabel(placeLabel);
    setStatus("ok");
  }, []);

  return { status, position, label, request, setManual };
}
