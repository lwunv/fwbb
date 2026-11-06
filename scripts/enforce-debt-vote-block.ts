/**
 * Dọn một lần: bỏ phiếu ở buổi còn mở vote của member đang nợ quá hạn mức
 * (spec 2026-11-06-debt-vote-block-design.md mục 4.3). Dùng sau khi deploy
 * tính năng chặn vote, cho những phiếu có từ trước.
 *
 * Mặc định CHẠY THỬ: chỉ in danh sách phiếu sẽ bị bỏ, không ghi gì.
 * Hạn mức đọc từ app_settings trên DB đích (không nhận tham số).
 *
 * Usage:
 *   npx tsx scripts/enforce-debt-vote-block.ts local           # e2e/local.db, chạy thử
 *   npx tsx scripts/enforce-debt-vote-block.ts local --apply   # e2e/local.db, xoá thật
 *   npx tsx scripts/enforce-debt-vote-block.ts prod            # TURSO_* trong .env.local, chạy thử
 *   npx tsx scripts/enforce-debt-vote-block.ts prod --apply    # CHỈ chạy khi user đã duyệt danh sách
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema";
import {
  enforceDebtVoteBlock,
  findMembersWithOpenVotes,
} from "../src/lib/debt-vote-block";
import type { DbLike } from "../src/lib/financial-ledger";
import { resolveGlobal } from "../src/lib/settings-resolve";

const target = process.argv[2];
const apply = process.argv.includes("--apply");

if (target !== "local" && target !== "prod") {
  console.error(
    "Target required: 'local' (e2e/local.db) or 'prod' (.env.local TURSO_*)",
  );
  process.exit(1);
}

const client =
  target === "local"
    ? createClient({ url: "file:./e2e/local.db" })
    : createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
const db = drizzle(client, { schema });

class DryRunRollback extends Error {}

async function main() {
  console.log(
    `\nTARGET = ${target.toUpperCase()}  MODE = ${apply ? "APPLY" : "DRY RUN"}\n`,
  );
  let removed: Array<{ memberId: number; sessionId: number }> = [];
  let threshold = 0;
  try {
    await db.transaction(async (tx) => {
      const settingRows = await tx
        .select({
          key: schema.appSettings.key,
          value: schema.appSettings.value,
        })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "voteBlockDebtThreshold"));
      threshold = resolveGlobal(settingRows).voteBlockDebtThreshold;
      const ids = await findMembersWithOpenVotes(tx as unknown as DbLike);
      const r = await enforceDebtVoteBlock(
        tx as unknown as DbLike,
        ids,
        threshold,
      );
      removed = r.removed;
      // Chạy thử = làm thật trong tx rồi rollback, để danh sách in ra đúng
      // y như khi --apply (cùng một đường code, không viết lại logic lọc).
      if (!apply) throw new DryRunRollback();
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }

  console.log(`Hạn mức nợ chặn vote: ${threshold}`);
  if (removed.length === 0) {
    console.log("Không có phiếu nào cần bỏ.");
    return;
  }
  const memberIds = [...new Set(removed.map((r) => r.memberId))];
  const sessionIds = [...new Set(removed.map((r) => r.sessionId))];
  const names = new Map(
    (
      await db
        .select({ id: schema.members.id, name: schema.members.name })
        .from(schema.members)
        .where(inArray(schema.members.id, memberIds))
    ).map((m) => [m.id, m.name]),
  );
  const dates = new Map(
    (
      await db
        .select({ id: schema.sessions.id, date: schema.sessions.date })
        .from(schema.sessions)
        .where(inArray(schema.sessions.id, sessionIds))
    ).map((s) => [s.id, s.date]),
  );
  console.table(
    removed.map((r) => ({
      memberId: r.memberId,
      ten: names.get(r.memberId),
      sessionId: r.sessionId,
      ngay: dates.get(r.sessionId),
    })),
  );
  console.log(
    apply
      ? `ĐÃ bỏ ${removed.length} phiếu.`
      : `${removed.length} phiếu SẼ bị bỏ. Chạy lại với --apply để xoá thật.`,
  );
}

main()
  .then(() => client.close())
  .catch((err) => {
    console.error(err);
    client.close();
    process.exit(1);
  });
