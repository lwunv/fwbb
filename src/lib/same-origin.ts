/**
 * Chặn CSRF cho route handler POST. Lớp kiểm Origin có sẵn của Next chỉ áp cho
 * server action, nên route handler phải tự kiểm.
 *
 * - Có `Origin` thì phải đúng bằng origin của app (`"null"` từ iframe sandbox
 *   hay file:// là sai).
 * - Không có `Origin` mà có `Sec-Fetch-Site` khác `same-origin` → sai.
 * - Không có cả hai (trình duyệt cũ, client không phải trình duyệt) → cho qua;
 *   Turnstile đứng ngay sau nên request giả mạo vẫn không đi tiếp được.
 */
export function isSameOriginRequest(req: Request, appOrigin: string): boolean {
  const origin = req.headers.get("origin");
  if (origin !== null) return origin === appOrigin;
  const site = req.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  return true;
}
