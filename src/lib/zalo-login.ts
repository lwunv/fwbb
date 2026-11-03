import { db } from "@/db";
import { members, memberOauthIdentities } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { findMemberByOAuth } from "@/lib/oauth-identity";

/** Tên dùng khi Zalo trả tên rỗng (members.name NOT NULL). */
const FALLBACK_NAME = "Zalo user";

export type ZaloLoginResult =
  | { memberId: number; created: boolean }
  | { error: "blocked" };

/** Khoá hoặc bị từ chối thì không cho vào, khớp loginWithPassword và fb-auth. */
function isBlocked(m: { isActive: boolean; approvalStatus: string }): boolean {
  return !m.isActive || m.approvalStatus === "rejected";
}

/**
 * Lỗi UNIQUE(provider, provider_uid) của `member_oauth_identities`. Drizzle bọc
 * lỗi libsql trong `DrizzleQueryError` nên phải lần theo `cause`. Chỉ khớp
 * đúng bảng này: UNIQUE của bảng khác là lỗi thật, không phải thua cuộc đua.
 */
function isZaloIdentityUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if (e.message.includes("UNIQUE constraint failed: member_oauth_identities"))
      return true;
  }
  return false;
}

/** SQLITE_BUSY, kể cả khi drizzle bọc trong `cause`. */
function isSqliteBusy(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    const code = (e as { code?: unknown }).code;
    if (code === "SQLITE_BUSY") return true;
    if (
      e.message.includes("SQLITE_BUSY") ||
      e.message.includes("database is locked")
    )
      return true;
  }
  return false;
}

const BUSY_RETRIES = 6;

/**
 * Chạy lại cả transaction khi bị SQLITE_BUSY. Libsql mở transaction ghi ngay
 * từ đầu (BEGIN IMMEDIATE), nhưng với DB file nó mở connection mới sau mỗi
 * transaction và connection đó không chờ lock (timeout 0), nên callback song
 * song thứ hai bị BUSY ngay thay vì xếp hàng. Tệ hơn, câu BEGIN hỏng đó kẹt
 * lại trên connection, nên transaction kế tiếp trên connection ấy bị BUSY lúc
 * COMMIT ("SQL statements in progress"). Vì vậy phải chạy lại nhiều lần: lần
 * sau lấy connection mới và qua được (với WAL, chế độ DB file local đang dùng).
 * Transaction bị BUSY đã rollback nên chạy lại an toàn; lần chạy lại thấy
 * identity bên thắng vừa commit. Cùng kiểu backoff với `doCheck` trong
 * rate-limit.ts.
 */
async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isSqliteBusy(err) || attempt >= BUSY_RETRIES) throw err;
      const backoffMs = Math.min(100, 5 * 2 ** attempt) + Math.random() * 5;
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}

/**
 * Tìm hoặc tạo member cho một lần đăng nhập Zalo. Không đặt cookie.
 *
 * Tìm và tạo nằm chung một transaction, mọi truy vấn đi qua `tx`, nên lỗi ở
 * bước ghi identity rollback luôn member vừa tạo (không có member mồ côi).
 * Không đi qua `ensureOAuthIdentity` vì nó ghi bằng `db` toàn cục, nằm ngoài
 * transaction. UNIQUE(provider, provider_uid) là lớp chặn cuối cho hai callback
 * song song: bên thua đọc lại member của bên thắng.
 *
 * Chỉ tra qua bảng identity, không fallback cột legacy: uid Zalo trùng chuỗi
 * với `facebookId` của người khác không được khớp vào hồ sơ đó.
 *
 * Member đã có giữ nguyên `approvalStatus` và `signupIntent` (member nhóm đăng
 * nhập từ trang giao lưu vẫn là member nhóm), chỉ cập nhật tên và ảnh.
 */
export async function loginOrCreateZaloMember(p: {
  uid: string;
  name: string;
  pictureUrl: string | null;
  intent: "exchange";
}): Promise<ZaloLoginResult> {
  const name = p.name.trim() || FALLBACK_NAME;
  try {
    return await withBusyRetry(() =>
      db.transaction(async (tx): Promise<ZaloLoginResult> => {
        const identity = await tx.query.memberOauthIdentities.findFirst({
          where: and(
            eq(memberOauthIdentities.provider, "zalo"),
            eq(memberOauthIdentities.providerUid, p.uid),
          ),
          columns: { memberId: true },
        });

        if (identity) {
          const existing = await tx.query.members.findFirst({
            where: eq(members.id, identity.memberId),
            columns: {
              id: true,
              name: true,
              avatarUrl: true,
              isActive: true,
              approvalStatus: true,
            },
          });
          // FK cascade nên identity luôn có member; thiếu là DB hỏng, ném ra.
          if (!existing) throw new Error("zalo identity without member");
          if (isBlocked(existing)) return { error: "blocked" };
          if (existing.name !== name || existing.avatarUrl !== p.pictureUrl) {
            await tx
              .update(members)
              .set({ name, avatarUrl: p.pictureUrl })
              .where(eq(members.id, existing.id));
          }
          return { memberId: existing.id, created: false };
        }

        const [created] = await tx
          .insert(members)
          .values({
            name,
            avatarUrl: p.pictureUrl,
            approvalStatus: "pending",
            signupIntent: p.intent,
          })
          .returning({ id: members.id });
        await tx.insert(memberOauthIdentities).values({
          memberId: created.id,
          provider: "zalo",
          providerUid: p.uid,
          email: null,
        });
        return { memberId: created.id, created: true };
      }),
    );
  } catch (err) {
    if (!isZaloIdentityUniqueViolation(err)) throw err;
    // Thua cuộc đua: transaction đã rollback member của mình, dùng member
    // của bên thắng.
    const winner = await findMemberByOAuth("zalo", p.uid);
    if (!winner) throw err;
    if (isBlocked(winner)) return { error: "blocked" };
    return { memberId: winner.id, created: false };
  }
}
