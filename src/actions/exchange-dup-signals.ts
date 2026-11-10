"use server";

import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { dupIgnoredPairs, memberIpSignals, members } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { isExchangeAccount } from "@/lib/exchange-account";
import { isExchangeEnabled } from "@/lib/exchange-flag";
import {
  DUP_SIGNAL_ROW_CAP,
  IP_SIGNAL_RETENTION_DAYS,
} from "@/lib/reputation/constants";
import {
  findDupSignalGroups,
  type DupSignalGroupView,
} from "@/lib/reputation/dup-signals";

const DAY_MS = 86_400_000;
const MAX_GROUPS = 50;

/**
 * Tín hiệu nick trùng của tài khoản giao lưu cho banner admin (quyết định 53,
 * 54): chỉ để xem, app không tự khoá ai. Cờ tắt hoặc không phải admin thì trả
 * rỗng như `findDuplicateMembers`. Payload chỉ có trường hiển thị: không hash
 * mạng, IP hay email.
 */
export async function findExchangeDuplicateSignals(): Promise<
  DupSignalGroupView[]
> {
  if (!(await isExchangeEnabled())) return [];
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  // Dòng quá 30 ngày có thể chưa kịp dọn: lúc đọc luôn bỏ qua (quyết định 55).
  const cutoff = new Date(
    Date.now() - IP_SIGNAL_RETENTION_DAYS * DAY_MS,
  ).toISOString();
  const rows = await db
    .select({
      memberId: memberIpSignals.memberId,
      ipHash: memberIpSignals.ipHash,
      kind: memberIpSignals.kind,
      firstSeenAt: memberIpSignals.firstSeenAt,
      lastSeenAt: memberIpSignals.lastSeenAt,
      name: members.name,
      approvalStatus: members.approvalStatus,
      signupIntent: members.signupIntent,
      avatarUrl: members.avatarUrl,
      avatarKey: members.avatarKey,
      createdAt: members.createdAt,
      code: members.publicCode,
    })
    .from(memberIpSignals)
    .innerJoin(members, eq(members.id, memberIpSignals.memberId))
    .where(
      and(gte(memberIpSignals.lastSeenAt, cutoff), eq(members.isActive, true)),
    )
    .orderBy(desc(memberIpSignals.lastSeenAt))
    .limit(DUP_SIGNAL_ROW_CAP);
  if (rows.length === 0) return [];

  const ignoredRows = await db
    .select({
      low: dupIgnoredPairs.memberIdLow,
      high: dupIgnoredPairs.memberIdHigh,
    })
    .from(dupIgnoredPairs);
  const ignored = new Set(ignoredRows.map((r) => `${r.low}-${r.high}`));

  const groups = findDupSignalGroups(
    rows.map((r) => ({
      memberId: r.memberId,
      ipHash: r.ipHash,
      kind: r.kind,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
      name: r.name,
      isExchange: isExchangeAccount(r),
    })),
    ignored,
  ).slice(0, MAX_GROUPS);

  const byId = new Map(rows.map((r) => [r.memberId, r]));
  return groups.map((g) => ({
    key: g.key,
    reason: g.reason,
    // Mọi id trong nhóm đều lấy từ `rows`, nên luôn có trong `byId`.
    members: g.memberIds.flatMap((id) => {
      const m = byId.get(id);
      if (!m) return [];
      return [
        {
          id,
          name: m.name,
          avatarUrl: m.avatarUrl,
          avatarKey: m.avatarKey,
          isExchange: isExchangeAccount(m),
          createdAt: m.createdAt,
          code: m.code,
        },
      ];
    }),
  }));
}
