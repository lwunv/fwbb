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
  // `manual`: người dùng đã tự gõ địa chỉ → GPS đến sau không được ghi đè.
  // `gen`: số thứ tự lần hỏi. Callback và hẹn giờ của lần hỏi CŨ không được
  // đụng vào trạng thái của lần hỏi mới (trừ một trường hợp, xem dưới).
  // `hasFix`: đã có vị trí GPS thật → lỗi đến sau không hạ về "denied".
  const manual = useRef(false);
  const gen = useRef(0);
  const hasFix = useRef(false);

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      return;
    }
    const myGen = ++gen.current;
    let answered = false;
    manual.current = false;
    setStatus("asking");
    const safety = setTimeout(() => {
      if (myGen === gen.current && !answered && !manual.current) {
        // Đã có vị trí từ lần trước thì giữ nó, không đẩy về ô nhập địa chỉ.
        setStatus(hasFix.current ? "ok" : "denied");
      }
    }, SAFETY_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        answered = true;
        clearTimeout(safety);
        // Nhận cả vị trí đến muộn (sau hẹn giờ an toàn, hoặc của lần hỏi cũ):
        // người dùng có thể đọc hộp xin quyền lâu rồi mới bấm "Cho phép". Vị
        // trí thật luôn tốt hơn ô nhập địa chỉ, trừ khi họ đã tự gõ địa chỉ.
        if (manual.current) return;
        hasFix.current = true;
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLabel(null);
        setStatus("ok");
      },
      () => {
        answered = true;
        clearTimeout(safety);
        if (myGen !== gen.current || manual.current) return;
        setStatus(hasFix.current ? "ok" : "denied");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, []);

  const setManual = useCallback((p: LatLng, placeLabel: string) => {
    manual.current = true;
    setPosition(p);
    setLabel(placeLabel);
    setStatus("ok");
  }, []);

  return { status, position, label, request, setManual };
}
