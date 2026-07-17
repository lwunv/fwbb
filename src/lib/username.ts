/**
 * Chuẩn hoá + validate FORMAT của username (login đa kênh): lowercase, 3-32 ký
 * tự [a-z0-9._]. Rỗng → value=null (xoá). Thuần, KHÔNG check uniqueness (mỗi
 * caller tự tra bảng của mình: members hoặc admins). Dùng chung members +
 * admin để chuẩn format nhất quán.
 */
export function normalizeUsername(
  raw: string,
): { value: string | null } | { code: "invalid" } {
  const norm = raw.trim().toLowerCase();
  if (!norm) return { value: null };
  if (!/^[a-z0-9._]{3,32}$/.test(norm)) return { code: "invalid" };
  return { value: norm };
}
