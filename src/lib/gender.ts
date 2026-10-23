/**
 * Giới tính member tự khai / admin khai hộ.
 *
 * ẢNH HƯỞNG TIỀN: khi admin bật `genderPricingEnabled`, bộ chia tiền hỏi đúng
 * MỘT câu `gender === "female"` (xem `cost-calculator.ts`). Mọi giá trị khác,
 * kể cả `null` và `"lgbt"`, đều vào nhóm không-nữ và trả suất đầy đủ. Đó là
 * hướng thu đủ: thà tính đủ rồi admin chỉnh, còn hơn tự cho ai đó suất ưu đãi
 * vì một giá trị mà bộ chia tiền chưa từng biết tới.
 *
 * Gom vào một chỗ vì trước đây danh sách này nằm rải ở sáu nơi (schema ×2,
 * validators, action, hai khai báo kiểu). Thêm một giá trị mà sót một nơi thì
 * giá trị đó lọt được vào DB nhưng lại rơi ra ở chỗ khác, không có lỗi nào báo.
 */
export const GENDERS = ["male", "female", "lgbt"] as const;

export type Gender = (typeof GENDERS)[number];

/** Chuỗi rỗng = chưa khai (hợp lệ). Giá trị lạ cũng trả `null`. */
export function parseGender(raw: unknown): Gender | null {
  if (typeof raw !== "string" || raw === "") return null;
  return (GENDERS as readonly string[]).includes(raw) ? (raw as Gender) : null;
}

/** Phân biệt "chưa khai" với "giá trị rác" — hai chuyện khác nhau. */
export function isGender(raw: unknown): raw is Gender {
  return (
    typeof raw === "string" && (GENDERS as readonly string[]).includes(raw)
  );
}
