import type { LatLng } from "./geo";
import {
  isMapsHost,
  isShortLinkHost,
  parseLatLngFromMapsUrl,
} from "./maps-link";

const MAX_HOPS = 5;
const TIMEOUT_MS = 5000;

/**
 * Như `parseLatLngFromMapsUrl` nhưng mở được link rút gọn
 * (`maps.app.goo.gl/...`) bằng cách đi theo redirect. Chỉ chạy ở server.
 *
 * Chống SSRF: tự đi từng bước redirect (`redirect: "manual"`) và chỉ đi tiếp
 * khi đích là https + host của Google. Không vậy thì link độc có thể bắt
 * server gọi vào địa chỉ nội bộ (vd 169.254.169.254).
 *
 * Mọi lỗi mạng trả `null`: caller báo "không tách được toạ độ" cho người
 * dùng, không có gì để retry ở đây. Không ghi log URL (có thể lộ vị trí).
 */
export async function resolveMapsLink(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LatLng | null> {
  const direct = parseLatLngFromMapsUrl(url);
  if (direct) return direct;

  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return null;
  }
  if (current.protocol !== "https:" || !isShortLinkHost(current.hostname)) {
    return null;
  }

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    const location = res.headers.get("location");
    if (!location) return null;

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return null;
    }
    if (
      next.protocol !== "https:" ||
      !(isShortLinkHost(next.hostname) || isMapsHost(next.hostname))
    ) {
      return null;
    }
    const found = parseLatLngFromMapsUrl(next.toString());
    if (found) return found;
    current = next;
  }
  return null;
}
