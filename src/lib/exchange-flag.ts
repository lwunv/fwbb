import { getSettings } from "@/actions/settings";

/**
 * Cờ tổng của tính năng giao lưu. Mọi URL, route handler và action mới của G2
 * gọi hàm này đầu tiên và trả 404 khi nó là false, để lúc tắt app y như chưa
 * có tính năng.
 *
 * Đọc qua `getSettings()` (cùng đường đọc và cùng dedup theo request với root
 * layout) thay vì một cache riêng, nên admin gạt công tắc là có hiệu lực ở
 * request kế tiếp, không có bản sao nào để lệch.
 */
export async function isExchangeEnabled(): Promise<boolean> {
  return (await getSettings()).exchangeEnabled;
}
