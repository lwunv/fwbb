"use client";

import { useMemo, useSyncExternalStore } from "react";
import { ledgerTimeToDate } from "@/lib/admin-notifications-view";

/**
 * Trạng thái đã đọc của thông báo admin, lưu trên trình duyệt (yêu cầu user
 * 6/11/2026: bấm vào thông báo thì đánh dấu đã đọc). Không có bảng DB cho
 * thông báo (chúng tính từ sổ cái), nên "đã đọc" là tiện ích riêng mỗi máy.
 * Dùng chung cho chuông và trang /admin/notifications.
 */

const LAST_SEEN_KEY = "fwbb.adminNotifications.lastSeenAt";
const READ_KEYS_KEY = "fwbb.adminNotifications.readKeys";
/** Giữ tối đa chừng này key đã đọc (mới nhất), tránh localStorage phình mãi. */
export const READ_KEYS_CAP = 500;
/** Chưa từng xem: chỉ coi tin trong 7 ngày gần đây là chưa đọc. */
const FRESH_MS = 7 * 86_400_000;

export type ReadState = {
  ready: boolean;
  lastSeen: string | null;
  readKeys: Set<string>;
};

export function notificationKey(n: { memberId: number; txId: number }) {
  return `${n.memberId}-${n.txId}`;
}

/** Snapshot dạng "<lastSeen>|<json mảng key>"; hỏng thì coi như rỗng. */
export function parseReadSnapshot(snapshot: string): ReadState {
  const i = snapshot.indexOf("|");
  const lastSeenRaw = i >= 0 ? snapshot.slice(0, i) : "";
  const keysRaw = i >= 0 ? snapshot.slice(i + 1) : "";
  let keys: string[] = [];
  try {
    const parsed: unknown = JSON.parse(keysRaw || "[]");
    if (Array.isArray(parsed)) {
      keys = parsed.filter((k): k is string => typeof k === "string");
    }
  } catch {
    // Dữ liệu cũ hỏng: bỏ qua, coi như chưa đọc gì (chỉ ảnh hưởng chấm xanh).
  }
  const lastSeen =
    lastSeenRaw && !Number.isNaN(Date.parse(lastSeenRaw)) ? lastSeenRaw : null;
  return { ready: true, lastSeen, readKeys: new Set(keys) };
}

export function isNotificationUnread(
  st: ReadState,
  key: string,
  at: string,
  now: Date,
): boolean {
  if (!st.ready || st.readKeys.has(key)) return false;
  const t = ledgerTimeToDate(at).getTime();
  if (st.lastSeen === null) return now.getTime() - t < FRESH_MS;
  return t > Date.parse(st.lastSeen);
}

export function addReadKey(keys: string[], key: string): string[] {
  if (keys.includes(key)) return keys;
  return [...keys, key].slice(-READ_KEYS_CAP);
}

// ── Kho quanh localStorage cho useSyncExternalStore ──────────────────────
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((cb) => cb());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function safeGet(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    // Trình duyệt chặn localStorage: coi như chưa xem gì, trang vẫn chạy.
    return "";
  }
}
function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Không lưu được: chấm chưa đọc vẫn còn, không làm hỏng thao tác.
  }
}
const SERVER_SNAPSHOT = "__server__";
const getSnapshot = () => `${safeGet(LAST_SEEN_KEY)}|${safeGet(READ_KEYS_KEY)}`;
const getServerSnapshot = () => SERVER_SNAPSHOT;

/** Đọc trạng thái đã đọc. Lúc render ở server: chưa sẵn sàng (không chấm). */
export function useNotificationReadState(): ReadState {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(
    () =>
      snap === SERVER_SNAPSHOT
        ? { ready: false, lastSeen: null, readKeys: new Set<string>() }
        : parseReadSnapshot(snap),
    [snap],
  );
}

export function markNotificationRead(key: string) {
  const current = parseReadSnapshot(getSnapshot());
  safeSet(
    READ_KEYS_KEY,
    JSON.stringify(addReadKey([...current.readKeys], key)),
  );
  emit();
}

export function markAllNotificationsSeen() {
  safeSet(LAST_SEEN_KEY, new Date().toISOString());
  emit();
}
