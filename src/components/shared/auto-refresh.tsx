"use client";

import { usePolling } from "@/lib/use-polling";

/**
 * Bật tự làm mới cho trang dựng ở server.
 *
 * Không truyền `interval` thì theo mặc định của `usePolling` (30 giây, và
 * dừng hẳn khi tab bị ẩn). Trước đây chỗ này tự đặt 5000ms, đè lên mặc định.
 */
export function AutoRefresh({ interval }: { interval?: number }) {
  usePolling(interval);
  return null;
}
