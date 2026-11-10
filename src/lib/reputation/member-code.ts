import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { members } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { newPublicCode } from "@/lib/exchange/public-code";

const MAX_ATTEMPTS = 5;

/** Mã vừa ghi trùng mã của member khác (unique index `members.public_code`). */
function isCodeTaken(e: unknown): boolean {
  const text = [e, (e as { cause?: unknown } | null)?.cause]
    .map((x) => (x instanceof Error ? x.message : String(x ?? "")))
    .join(" ");
  return /UNIQUE constraint failed/i.test(text) && text.includes("public_code");
}

async function storedCode(
  db: DbOrTx,
  memberId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ code: members.publicCode })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!row) throw new Error("member not found");
  return row.code;
}

/**
 * Mã hồ sơ công khai của member, tạo lần đầu khi cần (mở buổi, đăng ký, chia
 * sẻ hồ sơ). Chỉ ghi khi cột còn NULL nên hai lần gọi chạy đua vẫn kết thúc
 * với một mã: lần thua không ghi gì và đọc lại mã của lần thắng.
 */
export async function ensureMemberPublicCode(
  db: DbOrTx,
  memberId: number,
): Promise<string> {
  const current = await storedCode(db, memberId);
  if (current) return current;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await db
        .update(members)
        .set({ publicCode: newPublicCode() })
        .where(and(eq(members.id, memberId), isNull(members.publicCode)));
    } catch (e) {
      if (isCodeTaken(e)) continue;
      throw e;
    }
    const code = await storedCode(db, memberId);
    if (code) return code;
  }
  throw new Error("public code attempts exhausted");
}
