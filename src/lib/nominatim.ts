/**
 * Geocode địa chỉ bằng Nominatim (OpenStreetMap), free. Chỉ chạy ở server.
 *
 * Chính sách dùng Nominatim công khai: tối đa 1 request/giây, User-Agent định
 * danh app, không autocomplete theo từng phím. Hàng đợi bên dưới giữ nhịp
 * 1 req/s trong một tiến trình; caller phải cache kết quả để không gọi lặp.
 *
 * Mọi lỗi (HTTP, mạng, JSON) trả `null`: người dùng chỉ cần biết "không tìm
 * thấy, thử gõ khác hoặc kéo bản đồ". Không ghi log query (có thể là địa chỉ
 * nhà riêng).
 */

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const MIN_INTERVAL_MS = 1000;
const TIMEOUT_MS = 5000;
const MAX_QUERY_LEN = 200;

let lastCallAt = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Chỉ dành cho test: xoá nhịp đã ghi để mỗi test bắt đầu sạch. */
export function __resetNominatimThrottle() {
  lastCallAt = 0;
  queue = Promise.resolve();
}

function userAgent(): string {
  const site = process.env.NEXT_PUBLIC_APP_URL;
  return site ? `FWBB/1.0 (+${site})` : "FWBB/1.0 (badminton group app)";
}

export async function geocodeNominatim(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ lat: number; lng: number; label: string } | null> {
  const q = query.trim();
  if (!q || q.length > MAX_QUERY_LEN) return null;

  const run = async () => {
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
      if (!res.ok) return null;
      const body: unknown = await res.json();
      if (!Array.isArray(body) || body.length === 0) return null;
      const hit = body[0] as {
        lat?: string;
        lon?: string;
        display_name?: string;
      };
      const lat = Number(hit.lat);
      const lng = Number(hit.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng, label: hit.display_name ?? q };
    } catch {
      return null;
    }
  };

  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
