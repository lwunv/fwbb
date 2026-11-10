import { useState, useSyncExternalStore } from "react";

/**
 * maplibre-gl v6 chỉ chạy trên WebGL2. Nằm riêng, không import maplibre-gl,
 * để màn nào cũng kiểm được mà không kéo thư viện vào bundle trang.
 * Phía server (không có `document`) coi như hỗ trợ: việc kiểm thật chỉ có ý
 * nghĩa ở trình duyệt.
 */
export function hasWebGL2(): boolean {
  if (typeof document === "undefined") return true;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (gl === null) return false;
    // Trả context dò ngay: trình duyệt giới hạn số context còn sống và huỷ
    // context cũ nhất khi vượt, có thể là context của chính bản đồ.
    gl.getExtension?.("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

const noopSubscribe = () => () => {};
const assumeSupported = () => true;

/**
 * `hasWebGL2()` cho component có render ở server. Server và lần hydrate đầu
 * coi như có (HTML server không phụ thuộc máy), ngay sau hydrate mới là kết
 * quả thật.
 *
 * Chỉ dò một lần mỗi lần mount, không dò mỗi lần render: mỗi lần dò tạo một
 * context WebGL, mà trình duyệt giới hạn số context còn sống và huỷ context cũ
 * nhất khi vượt (có thể là context của chính bản đồ).
 */
export function useWebGL2Support(): boolean {
  const [supported] = useState(hasWebGL2);
  return useSyncExternalStore(noopSubscribe, () => supported, assumeSupported);
}
