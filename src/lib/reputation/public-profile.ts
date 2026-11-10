// Kiểu dữ liệu uy tín và payload hồ sơ công khai (G2d). Thuần, không DB, không
// `server-only`: component client import được kiểu và danh sách key.

import type { SkillLevel } from "@/lib/skill-level";
import type { PeerSummary } from "./score";

/** Số liệu đến của một member (quyết định 12, 13, 15). */
export type AttendanceSummary = {
  attended: number;
  approvedPast: number;
  lateCancels: number;
  noShows: number;
  charged: number;
  paidOnTime: number;
  isNew: boolean;
};

/** Số liệu host (quyết định 14); phần trăm null khi chưa đủ người chấm. */
export type HostSummary = {
  organized: number;
  cancelled: number;
  cancelPct: number | null;
  raters: number | null;
  asDescribedPct: number | null;
  feeAsPromisedPct: number | null;
};

/**
 * Uy tín đầy đủ của một member, chỉ sống trong cache phía server. Không bao
 * giờ trả thẳng ra client: luôn đi qua `toPublicPlayerProfile`.
 */
export type Reputation = {
  member: {
    name: string;
    avatarUrl: string | null;
    avatarKey: string | null;
    skillLevel: SkillLevel | null;
    approvalStatus: "pending" | "approved" | "rejected";
    isActive: boolean;
  };
  attendance: AttendanceSummary;
  peer: PeerSummary;
  host: HostSummary | null;
  referred: boolean;
};

export type PublicPlayerProfile = {
  code: string;
  name: string;
  avatarUrl: string | null;
  avatarKey: string | null;
  selfSkill: SkillLevel | null;
  isNew: boolean;
  referred: boolean;
  attendance: Omit<AttendanceSummary, "isNew">;
  peer: PeerSummary;
  host: HostSummary | null;
};

/** Whitelist: thêm key vào đây là quyết định có chủ ý, không phải vô tình. */
export const PUBLIC_PLAYER_PROFILE_KEYS: readonly (keyof PublicPlayerProfile)[] =
  [
    "code",
    "name",
    "avatarUrl",
    "avatarKey",
    "selfSkill",
    "isNew",
    "referred",
    "attendance",
    "peer",
    "host",
  ];

/**
 * Dựng payload hồ sơ công khai bằng cách chép từng trường, kể cả object lồng
 * nhau, không spread: trường mới của `Reputation` không tự lọt ra ngoài.
 * Không có id member, người chấm, buổi, sđt hay email.
 */
export function toPublicPlayerProfile(
  code: string,
  rep: Reputation,
): PublicPlayerProfile {
  const { member, attendance: a, peer: p, host: h } = rep;
  return {
    code,
    name: member.name,
    avatarUrl: member.avatarUrl,
    avatarKey: member.avatarKey,
    selfSkill: member.skillLevel,
    isNew: a.isNew,
    referred: rep.referred,
    attendance: {
      attended: a.attended,
      approvedPast: a.approvedPast,
      lateCancels: a.lateCancels,
      noShows: a.noShows,
      charged: a.charged,
      paidOnTime: a.paidOnTime,
    },
    peer: {
      raters: p.raters,
      playAgain: p.playAgain,
      tags: p.tags.map((t) => ({ tag: t.tag, count: t.count })),
      skill: p.skill ? { level: p.skill.level, raters: p.skill.raters } : null,
    },
    host: h
      ? {
          organized: h.organized,
          cancelled: h.cancelled,
          cancelPct: h.cancelPct,
          raters: h.raters,
          asDescribedPct: h.asDescribedPct,
          feeAsPromisedPct: h.feeAsPromisedPct,
        }
      : null,
  };
}
