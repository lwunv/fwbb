import { and, eq, ne, or } from "drizzle-orm";
import { members } from "@/db/schema";

/**
 * Tài khoản giao lưu = đăng ký với ý định "exchange" và chưa được admin duyệt
 * vào nhóm. Layout, trang admin và danh sách chờ duyệt dùng chung định nghĩa
 * này để không lệch nhau; ngoài trạng thái này là member nhóm bình thường.
 */
export function isExchangeAccount(m: {
  approvalStatus: string;
  signupIntent: string;
}): boolean {
  return m.approvalStatus === "pending" && m.signupIntent === "exchange";
}

/** Điều kiện Drizzle tương ứng với `isExchangeAccount`. */
export const exchangeAccountWhere = and(
  eq(members.approvalStatus, "pending"),
  eq(members.signupIntent, "exchange"),
);

/**
 * Phủ định của `exchangeAccountWhere`. Cả hai cột đều NOT NULL nên `ne` không
 * dính bẫy NULL của SQL (NULL != x cho ra NULL, làm mất dòng).
 */
export const notExchangeAccountWhere = or(
  ne(members.approvalStatus, "pending"),
  ne(members.signupIntent, "exchange"),
);
