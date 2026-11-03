/** Khoá localStorage đánh dấu đã xem tour (bản hiện tại ghi vào đây). */
export const TOUR_DONE_KEY = "fwbb-tour-done-v2";

/**
 * Đã xem BẤT KỲ bản nào thì không tự hiện lại (user chốt 03/11/2026: tránh
 * phiền). Muốn xem bản mới thì vào menu > Hướng dẫn. KHÔNG đổi khoá để ép hiện
 * lại; nếu sau này đổi tên khoá thì thêm khoá cũ vào danh sách này.
 */
const SEEN_KEYS = [TOUR_DONE_KEY, "fwbb-tour-done"];

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
// Lấy storage TRONG try: một số trình duyệt (chặn cookie / chế độ riêng tư)
// ném lỗi ngay khi chạm vào `window.localStorage`.
const browserStorage = (): Storage => window.localStorage;

export function hasSeenTour(
  getStorage: () => Storage = browserStorage,
): boolean {
  try {
    const storage = getStorage();
    return SEEN_KEYS.some((k) => storage.getItem(k) === "1");
  } catch {
    return true; // localStorage chặn → coi như đã xem, không auto-run.
  }
}

export function markTourSeen(getStorage: () => Storage = browserStorage) {
  try {
    getStorage().setItem(TOUR_DONE_KEY, "1");
  } catch {
    /* localStorage chặn → bỏ qua */
  }
}
