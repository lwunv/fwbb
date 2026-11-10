/**
 * Số cho link `tel:` từ số điện thoại sân người dùng gõ tự do: chỉ giữ chữ số
 * và dấu "+". Chuỗi không có chữ số nào (rỗng, "+", "không có") trả null để
 * UI ẩn nút gọi, thay vì hiện một nút quay số "+".
 */
export function toTelNumber(raw: string | null | undefined): string | null {
  if (!raw || !/\d/.test(raw)) return null;
  return raw.replace(/[^0-9+]/g, "");
}
