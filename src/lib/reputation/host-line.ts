// Dòng uy tín ngắn của host trên trang buổi (G2d quyết định 18). Thuần, không
// DB: trang server dựng từ hồ sơ công khai, component client chỉ hiển thị.

import type { PublicPlayerProfile } from "./public-profile";

/** Phần hồ sơ host đủ cho một dòng; phần trăm null khi chưa đủ người chấm. */
export type HostLine = {
  code: string;
  organized: number;
  asDescribedPct: number | null;
  feeAsPromisedPct: number | null;
};

/**
 * Không mã hồ sơ, hoặc hồ sơ không còn công khai (cờ tắt, tài khoản bị khoá),
 * thì không có dòng. `host: null` nghĩa là chưa từng tổ chức buổi nào nên tính
 * như `organized = 0` ("Host mới"). Chép từng trường, không spread hồ sơ.
 */
export function toHostLine(
  code: string | null,
  profile: PublicPlayerProfile | null,
): HostLine | null {
  if (!code || !profile) return null;
  return {
    code,
    organized: profile.host?.organized ?? 0,
    asDescribedPct: profile.host?.asDescribedPct ?? null,
    feeAsPromisedPct: profile.host?.feeAsPromisedPct ?? null,
  };
}
