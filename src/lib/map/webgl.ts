/**
 * maplibre-gl v6 chỉ chạy trên WebGL2. Nằm riêng, không import maplibre-gl,
 * để màn nào cũng kiểm được mà không kéo thư viện vào bundle trang.
 * Phía server (không có `document`) coi như hỗ trợ: việc kiểm thật chỉ có ý
 * nghĩa ở trình duyệt.
 */
export function hasWebGL2(): boolean {
  if (typeof document === "undefined") return true;
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}
