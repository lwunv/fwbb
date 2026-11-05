import "server-only";
import { randomBytes } from "node:crypto";

/** Bỏ chữ dễ nhầm (i, l, o, 0, 1) vì mã có thể được đọc to hoặc gõ tay. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 10;
// Bội số lớn nhất của 31 nhỏ hơn 256: byte từ mức này trở lên bị bỏ để phép
// chia lấy dư không làm lệch phân phối (rejection sampling).
const LIMIT = 256 - (256 % ALPHABET.length);

/** Mã ngẫu nhiên, không đoán được, dùng trong URL công khai của buổi giao lưu. */
export function newPublicCode(): string {
  let out = "";
  while (out.length < CODE_LENGTH) {
    for (const b of randomBytes(CODE_LENGTH * 2)) {
      if (b >= LIMIT) continue;
      out += ALPHABET[b % ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}
