/**
 * Geocode địa chỉ bằng Nominatim (OpenStreetMap), free. Chỉ chạy ở server.
 *
 * Chính sách dùng Nominatim công khai: tối đa 1 request/giây, User-Agent định
 * danh app, không autocomplete theo từng phím. Hàng đợi bên dưới giữ nhịp
 * 1 req/s trong một tiến trình; caller phải cache kết quả để không gọi lặp.
 *
 * Trả 4 trạng thái để caller xử lý đúng: `not_found` là câu trả lời thật (cache
 * được), còn `error` (HTTP lỗi, 429, mạng, JSON hỏng) và `busy` (hàng chờ đầy)
 * là tạm thời (KHÔNG được cache, báo người dùng thử lại). Không ghi log query
 * (có thể là địa chỉ nhà riêng).
 */

export type GeocodeResult =
  | { status: "ok"; lat: number; lng: number; label: string }
  | { status: "not_found" }
  | { status: "error" }
  | { status: "busy" };

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const MIN_INTERVAL_MS = 1000;
const TIMEOUT_MS = 5000;
const MAX_QUERY_LEN = 200;
/**
 * Số lượt tối đa đang chờ trong tiến trình. Với nhịp 1 req/s, lượt thứ 6 phải
 * chờ ≥ 5 giây; xếp thêm chỉ làm người dùng thật timeout khi có ai spam.
 */
const MAX_PENDING = 6;
let pending = 0;

let lastCallAt = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Chỉ dành cho test: xoá nhịp đã ghi để mỗi test bắt đầu sạch. */
export function __resetNominatimThrottle() {
  lastCallAt = 0;
  queue = Promise.resolve();
  pending = 0;
}

function userAgent(): string {
  const site = process.env.NEXT_PUBLIC_APP_URL;
  return site ? `FWBB/1.0 (+${site})` : "FWBB/1.0 (badminton group app)";
}

export async function geocodeNominatim(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeResult> {
  const q = query.trim();
  if (!q || q.length > MAX_QUERY_LEN) return { status: "not_found" };
  if (pending >= MAX_PENDING) return { status: "busy" };

  const run = async (): Promise<GeocodeResult> => {
    const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();

    const url = new URL(ENDPOINT);
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "vn");
    try {
      const res = await fetchImpl(url.toString(), {
        headers: { "User-Agent": userAgent(), "Accept-Language": "vi" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return { status: "error" };
      const body: unknown = await res.json();
      if (!Array.isArray(body)) return { status: "error" };
      if (body.length === 0) return { status: "not_found" };
      const hit = body[0] as {
        lat?: string;
        lon?: string;
        display_name?: string;
      };
      const lat = Number(hit.lat);
      const lng = Number(hit.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { status: "error" };
      }
      return { status: "ok", lat, lng, label: hit.display_name ?? q };
    } catch {
      return { status: "error" };
    }
  };

  pending++;
  const result = queue.then(run, run).finally(() => {
    pending--;
  });
  queue = result.catch(() => undefined);
  return result;
}
