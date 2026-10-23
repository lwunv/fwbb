/**
 * Trình độ tự khai của member (yêu cầu 23/10/2026).
 *
 * Chỉ để hiển thị: xếp cặp, chia đội hay chia tiền đều KHÔNG đọc cột này. Nó
 * là thông tin member tự nói về mình, không phải xếp hạng của ban tổ chức.
 *
 * Thứ tự trong `SKILL_LEVELS` là thứ tự hiện trên màn hình, từ thấp lên cao,
 * đúng thứ tự user liệt kê. Nhãn và câu mô tả nằm ở file dịch (`me.skillShort`,
 * `me.skillBlurb`), chỉ phần màu nằm ở đây vì nó là chuyện trình bày.
 */
export const SKILL_LEVELS = ["tapChoi", "yeu", "tby", "tb", "tbk"] as const;

export type SkillLevel = (typeof SKILL_LEVELS)[number];

/**
 * Màu riêng cho từng mức, mỗi mức một gam khác hẳn nhau để liếc là ra.
 *
 * Dùng bảng màu cố định của Tailwind chứ không dùng biến theme: các biến theme
 * (`--primary`...) đổi theo light/dark/pink, năm mức mà cùng bám một biến thì
 * nhìn giống hệt nhau. Mỗi lớp đều có biến thể `dark:` để chữ còn đọc được trên
 * nền tối.
 */
export const SKILL_BADGE_CLASS: Record<SkillLevel, string> = {
  tapChoi:
    "border-slate-400/50 bg-slate-400/15 text-slate-700 dark:border-slate-300/40 dark:bg-slate-300/15 dark:text-slate-200",
  yeu: "border-sky-500/50 bg-sky-500/15 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/15 dark:text-sky-300",
  tby: "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/15 dark:text-emerald-300",
  tb: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-300",
  tbk: "border-violet-500/50 bg-violet-500/15 text-violet-700 dark:border-violet-400/40 dark:bg-violet-400/15 dark:text-violet-300",
};

/**
 * Giá trị gửi lên server là chuỗi tự do cho tới khi qua được hàm này.
 * Chuỗi rỗng nghĩa là member bỏ khai, trả về `null`.
 */
export function parseSkillLevel(raw: unknown): SkillLevel | null {
  if (typeof raw !== "string" || raw === "") return null;
  return (SKILL_LEVELS as readonly string[]).includes(raw)
    ? (raw as SkillLevel)
    : null;
}

/** Phân biệt "member bỏ khai" với "giá trị rác" — hai chuyện khác nhau. */
export function isSkillLevel(raw: unknown): raw is SkillLevel {
  return (
    typeof raw === "string" && (SKILL_LEVELS as readonly string[]).includes(raw)
  );
}
