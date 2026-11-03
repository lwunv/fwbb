/**
 * Khoá rate limit theo IP. IPv6 gom theo dải /64: một máy thường có cả dải
 * /64, xoay địa chỉ trong đó là miễn phí nên giới hạn theo /128 vô nghĩa.
 *
 * Tách file riêng, thuần (không import next/headers): venues.ts dùng trực tiếp
 * và test của nó mock cả module client-ip. client-ip.ts re-export lại.
 */
export function ipRateLimitKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const tl = tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...h, ...Array(Math.max(0, 8 - h.length - tl.length)).fill("0"), ...tl]
    : h;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}
