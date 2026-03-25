/**
 * Bộ emoji + nền cho avatar mặc định (dùng chung server/client).
 * Lưu DB: `emoji:0` … `emoji:${N-1}`; `null` = tự chọn theo memberId modulo.
 */
export const AVATAR_EMOJI_LIST = [
  "🐱", "🐶", "🐰", "🦊", "🐻", "🐼", "🐨", "🦁", "🐯", "🐸",
  "🐧", "🐦", "🦋", "🐝", "🐞", "🦄", "🐬", "🐳", "🦈", "🐙",
  "🦉", "🐿️", "🦩", "🦜", "🐹",
  "🌸", "🌺", "🌻", "🌷", "🌹", "🍀", "🌿", "🌴", "🌵", "🎋",
  "🍁", "🌾", "🪻", "💐", "🌼",
  "🚗", "🚕", "🏎️", "🚀", "🛸", "⛵", "🎈", "🎪", "🎠", "🎡",
] as const;

const COLORS: readonly (readonly [string, string])[] = [
  ["#FFE0E6", "#D63864"],
  ["#E0F0FF", "#2563EB"],
  ["#E6FFE0", "#16A34A"],
  ["#FFF3E0", "#EA580C"],
  ["#F3E8FF", "#9333EA"],
  ["#FEF9C3", "#CA8A04"],
  ["#E0FFFE", "#0891B2"],
  ["#FFE4E6", "#E11D48"],
  ["#ECFDF5", "#059669"],
  ["#FDF4FF", "#C026D3"],
];

export const AVATAR_EMOJI_COUNT = AVATAR_EMOJI_LIST.length;

export function emojiAvatarKey(index: number): string {
  return `emoji:${index}`;
}

const EMOJI_KEY_RE = /^emoji:(\d+)$/;

export function parseEmojiAvatarKey(key: string): number | null {
  const m = EMOJI_KEY_RE.exec(key);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 0 || n >= AVATAR_EMOJI_COUNT) return null;
  return n;
}

export function getEmojiAvatarByIndex(index: number): {
  emoji: string;
  bg: string;
  border: string;
} {
  const i = ((index % AVATAR_EMOJI_COUNT) + AVATAR_EMOJI_COUNT) % AVATAR_EMOJI_COUNT;
  const emoji = AVATAR_EMOJI_LIST[i];
  const color = COLORS[i % COLORS.length];
  return { emoji, bg: color[0], border: color[1] };
}

/** Khi chưa chọn emoji cố định: icon theo id thành viên (legacy). */
export function getEmojiAvatarForMemberId(memberId: number): {
  emoji: string;
  bg: string;
  border: string;
} {
  return getEmojiAvatarByIndex(memberId);
}
