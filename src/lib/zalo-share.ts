/**
 * Soạn sẵn tin nhắn để admin dán vào nhóm Zalo (spec 4.4). Chỉ dựng chuỗi, không
 * gọi mạng; nút chia sẻ ở `zalo-share-button.tsx`. Tin viết tiếng Việt vì nhóm
 * chơi là người Việt, bất kể ngôn ngữ giao diện của admin.
 */

const VN_OFFSET_MS = 7 * 3_600_000;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;

/** `YYYY-MM-DD` thành `DD/MM`; chuỗi lạ trả về nguyên văn thay vì ném lỗi. */
function shortDate(ymd: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${m[2]}/${m[1]}` : ymd;
}

/**
 * Hạn vote theo giờ VN bất kể múi giờ máy chạy. Có `Z` hoặc offset thì là mốc
 * tuyệt đối, đổi sang giờ VN bằng cách cộng 7 giờ rồi đọc trường UTC (không dùng
 * getHours, vì nó theo múi giờ máy). Không có offset thì `sessions.voteDeadline`
 * vốn đã lưu giờ VN, giữ nguyên.
 */
function formatDeadlineVn(deadline: string): string | null {
  const naive = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(deadline);
  if (!naive) return null;
  if (!HAS_OFFSET.test(deadline)) {
    return `${naive[4]}:${naive[5]} ${naive[3]}/${naive[2]}`;
  }
  const ms = Date.parse(deadline);
  if (Number.isNaN(ms)) return null;
  const vn = new Date(ms + VN_OFFSET_MS).toISOString();
  return `${vn.slice(11, 16)} ${vn.slice(8, 10)}/${vn.slice(5, 7)}`;
}

/**
 * Link tuyệt đối tới trang vote của một buổi. Đọc `NEXT_PUBLIC_APP_URL` lúc gọi;
 * thiếu thì trả đường dẫn tương đối (dán vào Zalo sẽ không bấm được, nhưng
 * không bao giờ trỏ nhầm về localhost).
 */
export function voteLink(sessionId: number): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  return `${base}/vote/${sessionId}`;
}

export function buildUnvotedReminderText(input: {
  sessionDate: string;
  startTime: string;
  voteDeadline: string | null;
  names: string[];
}): string {
  const deadline = input.voteDeadline
    ? formatDeadlineVn(input.voteDeadline)
    : null;
  const lines = [
    `Buổi chơi ${shortDate(input.sessionDate)} lúc ${input.startTime} còn mấy bạn chưa vote: ${input.names.join(", ")}.`,
  ];
  if (deadline) lines.push(`Hạn vote là ${deadline}.`);
  lines.push("Các bạn vào vote giúp mình nhé.");
  return lines.join(" ");
}

export function buildLowAttendanceText(input: {
  sessionDate: string;
  startTime: string;
  headcount: number;
  maxPlayers: number;
  link: string;
}): string {
  return `Buổi chơi ${shortDate(input.sessionDate)} lúc ${input.startTime} mới có ${input.headcount}/${input.maxPlayers} người. Bạn nào rảnh thì vào vote giúp mình nhé: ${input.link}`;
}
