/**
 * Fetch cho client libSQL/Turso: dùng fetch có sẵn của Node và tự thử lại một
 * lần khi kết nối bị cắt ngang.
 *
 * Vì sao cần: mặc định hrana-client gửi request qua cross-fetch (node-fetch@2)
 * với keep-alive. Turso đóng kết nối idle, còn instance Vercel đang ấm thì vẫn
 * giữ socket đó, nên request kế tiếp nhận `socket hang up` (ECONNRESET) và cả
 * trang chết với màn "This page couldn't load". Log prod 07/10/2026 toàn lỗi
 * này, rải trên mọi query.
 *
 * Thử lại áp cho MỌI request, kể cả lệnh ghi (quyết định 07/10/2026). Đánh đổi
 * đã chấp nhận: nếu kết nối đứt SAU khi Turso đã chạy xong lệnh ghi thì lệnh có
 * thể chạy hai lần. Các luồng ghi tiền có `idempotencyKey` + UNIQUE index chặn
 * trùng ở tầng DB.
 */

/**
 * Phần tối thiểu của Request mà hrana-client truyền vào. Nó là Request của
 * node-fetch@2 chứ không phải Request chuẩn, nên không đưa thẳng cho fetch của
 * Node được (fetch Node sẽ ép nó thành chuỗi "[object Request]").
 */
export type DbFetchRequest = {
  url: string;
  method: string;
  headers: { forEach(cb: (value: string, key: string) => void): void };
  arrayBuffer(): Promise<ArrayBuffer>;
};

/**
 * Mã lỗi chứng tỏ socket chết giữa chừng. Cố ý KHÔNG gồm ETIMEDOUT / ENOTFOUND:
 * timeout không cho biết lệnh đã chạy hay chưa, còn lỗi DNS thử lại ngay cũng
 * không khỏi.
 */
const RESET_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
]);

/** True nếu lỗi (hoặc một `cause` lồng bên trong) là kết nối bị đứt ngang. */
export function isConnectionResetError(err: unknown): boolean {
  // undici bọc lỗi socket trong TypeError("fetch failed", { cause }), nên phải
  // đi xuống chuỗi cause. Giới hạn độ sâu để không kẹt nếu cause vòng lặp.
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && RESET_CODES.has(code)) return true;
    if (/socket hang up/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

/**
 * Tạo hàm fetch để truyền vào `createClient({ fetch })`.
 *
 * @param baseFetch fetch thật dùng để gửi đi, mặc định là fetch của Node.
 * @param retries số lần thử lại khi kết nối bị đứt.
 */
export function createRetryingFetch(
  baseFetch: typeof fetch = globalThis.fetch,
  retries = 1,
) {
  return async (request: DbFetchRequest): Promise<Response> => {
    const headers = new Headers();
    request.headers.forEach((value, key) => headers.set(key, value));
    // Đọc body ra buffer một lần để mỗi lần thử gửi lại đúng nội dung đó
    // (stream body chỉ đọc được một lần).
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : new Uint8Array(await request.arrayBuffer());

    for (let attempt = 0; ; attempt++) {
      try {
        return await baseFetch(request.url, {
          method: request.method,
          headers,
          body,
        });
      } catch (err) {
        if (attempt >= retries || !isConnectionResetError(err)) throw err;
      }
    }
  };
}
