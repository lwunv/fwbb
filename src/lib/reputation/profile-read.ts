import "server-only";
import { eq, sql, type SQL } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import { members, referrals } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { CHARGEABLE_STATUSES } from "@/lib/exchange/constants";
import { isExchangeEnabled } from "@/lib/exchange-flag";
import { SKILL_LEVELS, type SkillLevel } from "@/lib/skill-level";
import {
  FEEDBACK_WINDOW_DAYS,
  PROFILE_REVALIDATE_S,
  repTag,
} from "./constants";
import { validCheckInSql } from "./eligibility";
import {
  toPublicPlayerProfile,
  type AttendanceSummary,
  type HostSummary,
  type PublicPlayerProfile,
  type Reputation,
} from "./public-profile";
import {
  percent,
  summarizeHost,
  summarizePeer,
  type HostRow,
  type PeerRow,
} from "./score";

const WINDOW_MS = FEEDBACK_WINDOW_DAYS * 86_400_000;
/** Trần số dòng chấm đọc cho một đối tượng (quota Turso tính theo dòng đọc). */
const FEEDBACK_ROW_CAP = 500;
const PROFILE_CODE_RE = /^[a-hjkmnp-z2-9]{10}$/;
const SKILL_SET: ReadonlySet<string> = new Set(SKILL_LEVELS);

// Alias bảng dùng trong SQL thô bên dưới; `validCheckInSql` nhận cột nên dùng
// được với alias.
const col = (name: string) => sql.raw(name);
const validReg = (reg: string, ev: string) =>
  validCheckInSql(
    { checkedIn: col(`${reg}.checked_in`), status: col(`${reg}.status`) },
    { hiddenAt: col(`${ev}.hidden_at`), status: col(`${ev}.status`) },
  );
/** Buổi có ít nhất một điểm danh hợp lệ (host đã điểm danh ai đó). */
const hasCheckIn = (ev: string) =>
  sql`EXISTS (SELECT 1 FROM exchange_registrations ci WHERE ci.event_id = ${col(`${ev}.id`)} AND ci.status = 'approved' AND ci.checked_in = 1)`;
/** Mốc trả phí đúng hạn: giờ bắt đầu cộng 24 giờ, cùng định dạng ISO đã lưu. */
const PAY_DUE = sql`strftime('%Y-%m-%dT%H:%M:%fZ', e.start_at, '+1 day')`;
const CHARGEABLE_SQL = sql.raw(
  CHARGEABLE_STATUSES.map((s) => `'${s}'`).join(", "),
);

/**
 * Một truy vấn `GROUP BY member_id` cho số liệu đến của nhiều member. Điều
 * kiện buổi hiện (không ẩn, không huỷ) nằm trong từng `CASE` chứ không ở
 * `WHERE`, vì `anyCheckIn` (định nghĩa nick mới G2b) đếm mọi lần điểm danh.
 */
export function attendanceQuery(ids: number[], nowIso: string): SQL {
  const vis = sql`e.hidden_at IS NULL AND e.status <> 'cancelled'`;
  const chg = sql`${vis} AND r.fee_amount > 0 AND r.fee_waived = 0
    AND r.status IN (${CHARGEABLE_SQL}) AND e.status IN ('locked', 'done')
    AND ${nowIso} > ${PAY_DUE}`;
  return sql`SELECT r.member_id AS memberId,
      SUM(CASE WHEN ${validReg("r", "e")} AND e.end_at < ${nowIso} THEN 1 ELSE 0 END) AS attended,
      SUM(CASE WHEN ${vis} AND r.status IN ('approved', 'no_show', 'late_cancelled')
        AND e.end_at < ${nowIso} AND ${hasCheckIn("e")} THEN 1 ELSE 0 END) AS approvedPast,
      SUM(CASE WHEN ${vis} AND r.status = 'late_cancelled' THEN 1 ELSE 0 END) AS lateCancels,
      SUM(CASE WHEN ${vis} AND r.status = 'no_show' THEN 1 ELSE 0 END) AS noShows,
      SUM(CASE WHEN ${chg} THEN 1 ELSE 0 END) AS charged,
      SUM(CASE WHEN ${chg} AND r.paid = 1 AND r.paid_at <= ${PAY_DUE} THEN 1 ELSE 0 END) AS paidOnTime,
      MAX(CASE WHEN r.checked_in = 1 THEN 1 ELSE 0 END) AS anyCheckIn
    FROM exchange_registrations r
    INNER JOIN exchange_events e ON e.id = r.event_id
    WHERE r.member_id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
    GROUP BY r.member_id`;
}

type AttendanceRow = {
  memberId: number;
  attended: number;
  approvedPast: number;
  lateCancels: number;
  noShows: number;
  charged: number;
  paidOnTime: number;
  anyCheckIn: number;
};

/**
 * Số liệu đến của nhiều member trong một truy vấn (quyết định 12, 13, 15).
 * Member không có đăng ký nào vẫn có mục (toàn 0). Nick mới đúng định nghĩa
 * G2b: không `approved` và chưa từng có đăng ký `checked_in = 1`.
 */
export async function attendanceSummaries(
  dbx: DbOrTx,
  list: { id: number; approvalStatus: string }[],
  now: Date,
): Promise<Map<number, AttendanceSummary>> {
  const out = new Map<number, AttendanceSummary>();
  if (list.length === 0) return out;
  const ids = [...new Set(list.map((m) => m.id))];
  const rows = await dbx.all<AttendanceRow>(
    attendanceQuery(ids, now.toISOString()),
  );
  const byId = new Map(rows.map((r) => [Number(r.memberId), r]));
  for (const m of list) {
    const r = byId.get(m.id);
    out.set(m.id, {
      attended: Number(r?.attended ?? 0),
      approvedPast: Number(r?.approvedPast ?? 0),
      lateCancels: Number(r?.lateCancels ?? 0),
      noShows: Number(r?.noShows ?? 0),
      charged: Number(r?.charged ?? 0),
      paidOnTime: Number(r?.paidOnTime ?? 0),
      isNew:
        m.approvalStatus !== "approved" && Number(r?.anyCheckIn ?? 0) === 0,
    });
  }
  return out;
}

/**
 * Dòng chấm người chơi đã qua mọi bộ lọc "Lượt chấm được cộng" trừ ngưỡng 3
 * người mỗi buổi (`summarizePeer` làm bước đó): buổi đã đóng chấm, không ẩn,
 * không huỷ; người chấm và người được chấm còn điểm danh hợp lệ; người chấm
 * không bị khoá, không bị từ chối; không dòng nào dính tới host của buổi. Đi
 * theo index `peer_feedback(to_member_id, updated_at)`.
 */
export function peerRowsQuery(memberId: number, closedBeforeIso: string): SQL {
  return sql`SELECT pf.id AS id, pf.event_id AS eventId,
      pf.from_member_id AS fromId, pf.updated_at AS updatedAt,
      pf.rater_weight AS w5, pf.play_again AS playAgain, pf.tags AS tags,
      pf.skill_level AS skill
    FROM peer_feedback pf
    INNER JOIN exchange_events e ON e.id = pf.event_id
    INNER JOIN exchange_registrations fr
      ON fr.event_id = pf.event_id AND fr.member_id = pf.from_member_id
    INNER JOIN exchange_registrations tr
      ON tr.event_id = pf.event_id AND tr.member_id = pf.to_member_id
    INNER JOIN members fm ON fm.id = pf.from_member_id
    WHERE pf.to_member_id = ${memberId}
      AND e.end_at <= ${closedBeforeIso}
      AND e.host_member_id <> pf.from_member_id
      AND e.host_member_id <> pf.to_member_id
      AND ${validReg("fr", "e")}
      AND tr.checked_in = 1 AND tr.status = 'approved'
      AND fm.is_active = 1 AND fm.approval_status <> 'rejected'
    ORDER BY pf.updated_at DESC, pf.id DESC
    LIMIT ${FEEDBACK_ROW_CAP}`;
}

/** Như `peerRowsQuery` cho câu trả lời về host, đi từ buổi của host. */
export function hostRowsQuery(hostId: number, closedBeforeIso: string): SQL {
  return sql`SELECT hf.id AS id, hf.event_id AS eventId,
      hf.from_member_id AS fromId, hf.updated_at AS updatedAt,
      hf.rater_weight AS w5, hf.as_described AS asDescribed,
      hf.fee_as_promised AS feeAsPromised
    FROM exchange_events e
    INNER JOIN host_feedback hf ON hf.event_id = e.id
    INNER JOIN exchange_registrations fr
      ON fr.event_id = hf.event_id AND fr.member_id = hf.from_member_id
    INNER JOIN members fm ON fm.id = hf.from_member_id
    WHERE e.host_member_id = ${hostId}
      AND e.end_at <= ${closedBeforeIso}
      AND hf.from_member_id <> e.host_member_id
      AND ${validReg("fr", "e")}
      AND fm.is_active = 1 AND fm.approval_status <> 'rejected'
    ORDER BY hf.updated_at DESC, hf.id DESC
    LIMIT ${FEEDBACK_ROW_CAP}`;
}

/**
 * Số buổi host đã tổ chức và đã huỷ (quyết định 14): tổ chức = không huỷ,
 * không ẩn, đã qua giờ kết thúc, có điểm danh hợp lệ; huỷ = không ẩn, còn ít
 * nhất một đăng ký `approved` (huỷ buổi giữ nguyên trạng thái đăng ký).
 */
export function hostCountsQuery(hostId: number, nowIso: string): SQL {
  return sql`SELECT
      COALESCE(SUM(CASE WHEN e.status <> 'cancelled' AND e.end_at < ${nowIso}
        AND ${hasCheckIn("e")} THEN 1 ELSE 0 END), 0) AS organized,
      COALESCE(SUM(CASE WHEN e.status = 'cancelled' AND EXISTS (
        SELECT 1 FROM exchange_registrations ar
        WHERE ar.event_id = e.id AND ar.status = 'approved') THEN 1 ELSE 0 END), 0) AS cancelled
    FROM exchange_events e
    WHERE e.host_member_id = ${hostId} AND e.hidden_at IS NULL`;
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    // Dòng hỏng thì coi như không có tag, không làm hỏng cả hồ sơ.
    return [];
  }
}

const toSkill = (v: unknown): SkillLevel | null =>
  typeof v === "string" && SKILL_SET.has(v) ? (v as SkillLevel) : null;

/**
 * Uy tín đầy đủ của một member: đọc member, số liệu đến, dòng chấm người chơi,
 * và (nếu từng tổ chức hay huỷ buổi) số liệu host. `host` null khi chưa tổ
 * chức hay huỷ buổi nào. `referred`: đã có người giới thiệu (không nói là ai).
 */
export async function loadReputation(
  dbx: DbOrTx,
  memberId: number,
  now: Date,
): Promise<Reputation | null> {
  const [m] = await dbx
    .select({
      name: members.name,
      avatarUrl: members.avatarUrl,
      avatarKey: members.avatarKey,
      skillLevel: members.skillLevel,
      approvalStatus: members.approvalStatus,
      isActive: members.isActive,
    })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!m) return null;

  const nowIso = now.toISOString();
  const closedBefore = new Date(now.getTime() - WINDOW_MS).toISOString();

  const attendance = (
    await attendanceSummaries(
      dbx,
      [{ id: memberId, approvalStatus: m.approvalStatus }],
      now,
    )
  ).get(memberId)!;

  const peerRaw = await dbx.all<Record<string, unknown>>(
    peerRowsQuery(memberId, closedBefore),
  );
  const peerRows: PeerRow[] = peerRaw.map((r) => ({
    id: Number(r.id),
    eventId: Number(r.eventId),
    fromId: Number(r.fromId),
    updatedAt: String(r.updatedAt),
    w5: Number(r.w5),
    playAgain: Number(r.playAgain) === 1,
    tags: parseTags(r.tags),
    skill: toSkill(r.skill),
  }));

  const [counts] = await dbx.all<{ organized: number; cancelled: number }>(
    hostCountsQuery(memberId, nowIso),
  );
  const organized = Number(counts?.organized ?? 0);
  const cancelled = Number(counts?.cancelled ?? 0);

  let host: HostSummary | null = null;
  if (organized + cancelled > 0) {
    // Buổi có lượt chấm được cộng luôn là buổi đã tổ chức, nên chưa tổ chức
    // buổi nào thì khỏi đọc dòng chấm host.
    const hostRows: HostRow[] =
      organized === 0
        ? []
        : (
            await dbx.all<Record<string, unknown>>(
              hostRowsQuery(memberId, closedBefore),
            )
          ).map((r) => ({
            id: Number(r.id),
            eventId: Number(r.eventId),
            fromId: Number(r.fromId),
            updatedAt: String(r.updatedAt),
            w5: Number(r.w5),
            asDescribed: Number(r.asDescribed) === 1,
            feeAsPromised: Number(r.feeAsPromised) === 1,
          }));
    host = {
      organized,
      cancelled,
      cancelPct: percent(cancelled, organized + cancelled),
      ...summarizeHost(hostRows),
    };
  }

  // Chỉ cần biết có dòng giới thiệu hay không; người giới thiệu không bao giờ
  // ra khỏi đây (quyết định 46).
  const [ref] = await dbx
    .select({ id: referrals.id })
    .from(referrals)
    .where(eq(referrals.refereeMemberId, memberId))
    .limit(1);

  return {
    member: {
      name: m.name,
      avatarUrl: m.avatarUrl,
      avatarKey: m.avatarKey,
      skillLevel: m.skillLevel,
      approvalStatus: m.approvalStatus,
      isActive: m.isActive,
    },
    attendance,
    peer: summarizePeer(peerRows),
    host,
    referred: !!ref,
  };
}

async function memberIdByCode(code: string): Promise<{ id: number } | null> {
  const [row] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.publicCode, code))
    .limit(1);
  return row ? { id: row.id } : null;
}

/**
 * Hồ sơ công khai theo mã (quyết định 16, 20). Hai lớp cache: mã → id (chỉ
 * id, tag "exchange") và uy tín theo member (tag `repTag(id)`, mọi đường sửa
 * member làm mới tag này). Khoá hay từ chối được kiểm trên dữ liệu của cache
 * thứ hai nên làm mới `repTag` là đủ để ẩn hồ sơ ngay.
 */
export async function getPublicProfile(
  code: string,
): Promise<PublicPlayerProfile | null> {
  if (!(await isExchangeEnabled())) return null;
  if (!PROFILE_CODE_RE.test(code)) return null;
  const ref = await unstable_cache(
    () => memberIdByCode(code),
    ["pcode", code],
    { tags: ["exchange"], revalidate: PROFILE_REVALIDATE_S },
  )();
  if (!ref) return null;
  const rep = await unstable_cache(
    () => loadReputation(db, ref.id, new Date()),
    ["rep", String(ref.id)],
    { tags: [repTag(ref.id)], revalidate: PROFILE_REVALIDATE_S },
  )();
  if (!rep || !rep.member.isActive || rep.member.approvalStatus === "rejected")
    return null;
  return toPublicPlayerProfile(code, rep);
}
