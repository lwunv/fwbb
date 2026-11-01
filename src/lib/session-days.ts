/**
 * Nhãn các ngày trong tuần dùng cho bộ chọn "ngày tạo buổi".
 *
 * `dow` theo chuẩn JS (`Date.getDay()`): CN = 0, T2 = 1, ..., T7 = 6. Thứ tự
 * mảng bắt đầu từ T2 vì người Việt đọc tuần kiểu đó, nên KHÔNG dùng `dow` làm
 * chỉ số mảng.
 *
 * Để ở `lib/` vì hai chỗ cùng chỉnh một setting: mục "Mặc định cho buổi mới"
 * trong trang Cài đặt, và panel gọn trên Dashboard. Hai bản sao chép tay sẽ
 * lệch nhau lúc nào không hay.
 */
export interface DayPill {
  dow: number;
  label: string;
}

export const DAY_PILLS: readonly DayPill[] = [
  { dow: 1, label: "T2" },
  { dow: 2, label: "T3" },
  { dow: 3, label: "T4" },
  { dow: 4, label: "T5" },
  { dow: 5, label: "T6" },
  { dow: 6, label: "T7" },
  { dow: 0, label: "CN" },
];

/**
 * Bật/tắt một ngày, trả về danh sách đã sắp xếp.
 *
 * Trả về `null` khi thao tác sẽ bỏ hết ngày: registry bắt buộc ít nhất một
 * ngày, và một mảng rỗng gửi lên server chỉ đổi lại một lỗi validate khó hiểu.
 * Gọi bên ngoài tự quyết định làm gì với `null` (hiện tại: bỏ qua cú bấm).
 */
export function toggleSessionDay(
  current: readonly number[],
  dow: number,
): number[] | null {
  const next = new Set(current);
  if (next.has(dow)) next.delete(dow);
  else next.add(dow);
  if (next.size === 0) return null;
  return Array.from(next).sort((a, b) => a - b);
}
