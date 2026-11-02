/**
 * Kênh để tour mở/đóng ngăn kéo menu (NavDrawer) — các mục Lịch sử / Quỹ /
 * Thống kê / Cá nhân nằm trong ngăn kéo nên tour phải mở nó ra mới neo được
 * từng mục. Dùng CustomEvent trên window thay vì store chung vì tour và
 * NavDrawer chỉ cần 1 tín hiệu một chiều.
 */
export const TOUR_DRAWER_EVENT = "fwbb:tour-drawer";

export function setTourDrawer(open: boolean) {
  window.dispatchEvent(
    new CustomEvent<{ open: boolean }>(TOUR_DRAWER_EVENT, {
      detail: { open },
    }),
  );
}
