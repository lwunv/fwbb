import "server-only";
import { createHmac } from "crypto";
import { asc, inArray, lt } from "drizzle-orm";
import { memberIpSignals } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { ipRateLimitKey } from "@/lib/ip-rate-limit-key";
import {
  IP_SIGNAL_PRUNE_BATCH,
  IP_SIGNAL_RETENTION_DAYS,
  type IpSignalKind,
} from "./constants";

const DAY_MS = 86_400_000;
/** Bước dọn hằng ngày xoá tối đa chừng này lô mỗi lần chạy. */
const DAILY_PRUNE_MAX_BATCHES = 10;

/**
 * Mạng đã băm của một IP để so tài khoản giao lưu (quyết định 52). Cùng khoá
 * `USER_COOKIE_SECRET` với `hashedIpKey` nhưng tiền tố riêng, nên hash này
 * không khớp được với khoá rate limit. IPv6 gom theo /64 như rate limit.
 */
export function ipSignalHash(ip: string): string {
  const secret = process.env.USER_COOKIE_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "USER_COOKIE_SECRET env var is required and must be at least 16 characters.",
    );
  }
  return createHmac("sha256", secret)
    .update(`dup-ip:v1:${ipRateLimitKey(ip)}`)
    .digest("hex")
    .slice(0, 32);
}

/** Câu xoá một lô dòng quá hạn, theo index `(last_seen_at)`. Tách ra để test EXPLAIN. */
export function ipSignalPruneQuery(db: DbOrTx, now: Date) {
  const cutoff = new Date(
    now.getTime() - IP_SIGNAL_RETENTION_DAYS * DAY_MS,
  ).toISOString();
  return db
    .delete(memberIpSignals)
    .where(
      inArray(
        memberIpSignals.id,
        db
          .select({ id: memberIpSignals.id })
          .from(memberIpSignals)
          .where(lt(memberIpSignals.lastSeenAt, cutoff))
          .orderBy(asc(memberIpSignals.lastSeenAt))
          .limit(IP_SIGNAL_PRUNE_BATCH),
      ),
    )
    .returning({ id: memberIpSignals.id });
}

/** Xoá một lô (tối đa 200) dòng tín hiệu quá 30 ngày, cũ nhất trước. Trả số dòng đã xoá. */
export async function pruneIpSignals(db: DbOrTx, now: Date): Promise<number> {
  const rows = await ipSignalPruneQuery(db, now);
  return rows.length;
}

/**
 * Bước dọn của cron hằng ngày: lặp từng lô tới khi một lô xoá chưa đủ 200 dòng
 * hoặc đã đủ 10 lô. Chạy cả khi đang tắt thông báo (quyết định 55).
 */
export async function pruneIpSignalsDaily(
  db: DbOrTx,
  now: Date,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < DAILY_PRUNE_MAX_BATCHES; i++) {
    const n = await pruneIpSignals(db, now);
    total += n;
    if (n < IP_SIGNAL_PRUNE_BATCH) break;
  }
  return total;
}

/**
 * Ghi (hoặc làm mới `last_seen_at`) một tín hiệu mạng của member, rồi dọn một
 * lô dòng cũ. Không có IP tin cậy (máy local) thì không ghi gì.
 */
export async function recordIpSignal(
  db: DbOrTx,
  input: { memberId: number; ip: string; kind: IpSignalKind },
  now: Date,
): Promise<void> {
  if (input.ip === "unknown") return;
  const nowIso = now.toISOString();
  await db
    .insert(memberIpSignals)
    .values({
      memberId: input.memberId,
      ipHash: ipSignalHash(input.ip),
      kind: input.kind,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
    })
    .onConflictDoUpdate({
      target: [
        memberIpSignals.memberId,
        memberIpSignals.ipHash,
        memberIpSignals.kind,
      ],
      set: { lastSeenAt: nowIso },
    });
  await pruneIpSignals(db, now);
}

/**
 * `recordIpSignal` cho đăng nhập và đăng ký. Tín hiệu chỉ để admin tham khảo
 * (quyết định 56): ghi lỗi thì bỏ qua có chủ đích để không làm hỏng việc chính
 * của người dùng. Log chỉ có id member, không IP, tên hay lỗi DB.
 */
export async function recordIpSignalQuietly(
  db: DbOrTx,
  input: { memberId: number; ip: string; kind: IpSignalKind },
  now: Date,
): Promise<void> {
  try {
    await recordIpSignal(db, input, now);
  } catch {
    console.error("[DupSignal] record_failed", { memberId: input.memberId });
  }
}
