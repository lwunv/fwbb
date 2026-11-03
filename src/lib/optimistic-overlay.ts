/**
 * Đọc giá trị optimistic đè lên giá trị server. Phân biệt "chưa có overlay"
 * (key không có) với "overlay là null" (vd vừa bỏ nối): dùng `??` sẽ coi
 * null là chưa có và hiện lại giá trị cũ của server.
 */
export function overlayValue<T>(
  overlay: Record<number, T | null>,
  id: number,
  serverValue: T | null,
): T | null {
  return id in overlay ? overlay[id] : serverValue;
}
