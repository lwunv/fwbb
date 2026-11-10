import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { dupIgnoredPairs, memberIpSignals, members } from "@/db/schema";
import type { CacheStore } from "@/test-utils/next-cache-store";

const mocks = vi.hoisted(() => ({ flag: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/cache", async () =>
  (await import("@/test-utils/next-cache-store")).createCacheStore(),
);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const cache = (await import("next/cache")) as unknown as CacheStore;
const { findExchangeDuplicateSignals } = await import("./exchange-dup-signals");
const { DUP_SIGNALS_TAG } = await import("@/lib/reputation/constants");
const { ipSignalHash, recordIpSignal } =
  await import("@/lib/reputation/ip-signals");
const { runDailyNotifications } = await import("@/lib/notifications/daily");

const DAY = 86_400_000;
const H = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const IP = "203.0.113.7";

type NewMember = Partial<typeof members.$inferInsert>;
async function addMember(over: NewMember = {}) {
  const [m] = await testDb
    .insert(members)
    .values({ name: "Lan Anh", approvalStatus: "approved", ...over })
    .returning();
  return m;
}
const exchangeAccount = (over: NewMember = {}) =>
  addMember({ approvalStatus: "pending", signupIntent: "exchange", ...over });

async function signal(
  memberId: number,
  kind: "signup" | "login" | "register",
  seenAt: string,
  ipHash = ipSignalHash(IP),
) {
  await testDb.insert(memberIpSignals).values({
    memberId,
    ipHash,
    kind,
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
  });
}

beforeEach(async () => {
  await client.execute("DELETE FROM member_ip_signals");
  await client.execute("DELETE FROM dup_ignored_pairs");
  await client.execute("DELETE FROM members");
  await client.execute("DELETE FROM app_settings");
  cache.clear();
  mocks.flag.mockReset().mockResolvedValue(true);
  mocks.admin.mockReset().mockResolvedValue({ admin: { role: "admin" } });
});

describe("findExchangeDuplicateSignals", () => {
  it("returns same-name and burst groups with only display fields", async () => {
    const group = await addMember({
      name: "Lan Anh",
      publicCode: "abcdefghjk",
    });
    const twin = await exchangeAccount({ name: "lan anh" });
    await signal(group.id, "login", ago(2 * DAY));
    await signal(twin.id, "signup", ago(DAY));

    const burst = [];
    for (let i = 0; i < 3; i++) {
      const m = await exchangeAccount({ name: `Nick ${i}` });
      burst.push(m.id);
      await signal(
        m.id,
        "signup",
        ago(5 * DAY + i * H),
        ipSignalHash("198.51.100.4"),
      );
    }

    const groups = await findExchangeDuplicateSignals();
    expect(groups.map((g) => g.key)).toEqual([
      `same_name_network:${group.id}-${twin.id}`,
      `network_burst:${burst.join("-")}`,
    ]);
    expect(groups[0].members).toEqual([
      {
        id: group.id,
        name: "Lan Anh",
        avatarUrl: null,
        avatarKey: null,
        isExchange: false,
        createdAt: group.createdAt,
        code: "abcdefghjk",
      },
      {
        id: twin.id,
        name: "lan anh",
        avatarUrl: null,
        avatarKey: null,
        isExchange: true,
        createdAt: twin.createdAt,
        code: null,
      },
    ]);
  });

  // Final review M4: hồ sơ của tài khoản bị từ chối trả 404, không có link.
  it("a rejected member in a group has code null", async () => {
    const rejected = await addMember({
      publicCode: "abcdefghjk",
      approvalStatus: "rejected",
    });
    const twin = await exchangeAccount({ publicCode: "bcdefghjkm" });
    await signal(rejected.id, "login", ago(DAY));
    await signal(twin.id, "signup", ago(DAY));
    const [g] = await findExchangeDuplicateSignals();
    expect(g.members.map((m) => [m.id, m.code])).toEqual([
      [rejected.id, null],
      [twin.id, "bcdefghjkm"],
    ]);
  });

  it("admin payload has no hash, IP or email", async () => {
    const group = await addMember({
      email: "lan@example.com",
      phoneNumber: "0912345678",
    });
    const twin = await exchangeAccount({ email: "lan2@example.com" });
    await signal(group.id, "login", ago(DAY));
    await signal(twin.id, "signup", ago(DAY));

    const groups = await findExchangeDuplicateSignals();
    expect(groups).toHaveLength(1);
    for (const m of groups[0].members) {
      expect(Object.keys(m).sort()).toEqual([
        "avatarKey",
        "avatarUrl",
        "code",
        "createdAt",
        "id",
        "isExchange",
        "name",
      ]);
    }
    expect(Object.keys(groups[0]).sort()).toEqual(["key", "members", "reason"]);
    const json = JSON.stringify(groups);
    expect(json).not.toContain(ipSignalHash(IP));
    expect(json).not.toContain(IP);
    expect(json).not.toContain("@example.com");
    expect(json).not.toContain("0912345678");
  });

  it("a member cookie or flag off gets nothing", async () => {
    const group = await addMember();
    const twin = await exchangeAccount();
    await signal(group.id, "login", ago(DAY));
    await signal(twin.id, "signup", ago(DAY));
    expect(await findExchangeDuplicateSignals()).toHaveLength(1);

    mocks.admin.mockResolvedValue({ error: "Không có quyền admin" });
    expect(await findExchangeDuplicateSignals()).toEqual([]);

    mocks.admin.mockClear();
    mocks.flag.mockResolvedValue(false);
    expect(await findExchangeDuplicateSignals()).toEqual([]);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("ignored pairs and inactive members drop out", async () => {
    const group = await addMember();
    const twin = await exchangeAccount();
    const locked = await exchangeAccount({ isActive: false });
    await signal(group.id, "login", ago(DAY));
    await signal(twin.id, "signup", ago(DAY));
    await signal(locked.id, "signup", ago(DAY));

    expect(
      (await findExchangeDuplicateSignals())[0].members.map((m) => m.id),
    ).toEqual([group.id, twin.id]);
    await testDb
      .insert(dupIgnoredPairs)
      .values({ memberIdLow: group.id, memberIdHigh: twin.id });
    // `ignoreDuplicateGroup` làm mới tag này (members.integration.test.ts).
    cache.updateTag(DUP_SIGNALS_TAG);
    expect(await findExchangeDuplicateSignals()).toEqual([]);
  });

  // Final review M3: trang thành viên tự làm mới mỗi 5 phút; mỗi lượt không
  // được đọc lại bảng tín hiệu. Chỉ tín hiệu MỚI (hoặc "Bỏ qua") làm mới cache.
  it("a refresh poll reads no signal rows; a new signal refreshes the banner, a repeat login does not", async () => {
    const group = await addMember();
    const twin = await exchangeAccount();
    await signal(group.id, "login", ago(DAY));
    await signal(twin.id, "signup", ago(DAY));
    const first = await findExchangeDuplicateSignals();
    expect(first[0].members.map((m) => m.id)).toEqual([group.id, twin.id]);

    const exec = vi.spyOn(client, "execute");
    try {
      expect(await findExchangeDuplicateSignals()).toEqual(first);
      expect(exec).not.toHaveBeenCalled();

      // Đăng nhập lại cùng mạng: chỉ đổi last_seen_at, cache giữ nguyên.
      await recordIpSignal(
        testDb,
        { memberId: twin.id, ip: IP, kind: "signup" },
        new Date(),
      );
      exec.mockClear();
      expect(await findExchangeDuplicateSignals()).toEqual(first);
      expect(exec).not.toHaveBeenCalled();
    } finally {
      exec.mockRestore();
    }

    const third = await exchangeAccount();
    await recordIpSignal(
      testDb,
      { memberId: third.id, ip: IP, kind: "signup" },
      new Date(),
    );
    expect(
      (await findExchangeDuplicateSignals())[0].members.map((m) => m.id),
    ).toEqual([group.id, twin.id, third.id]);
  });

  it("rows older than 30 days are ignored, pruned on write and by the daily step", async () => {
    const group = await addMember();
    const twin = await exchangeAccount();
    await signal(group.id, "login", ago(31 * DAY));
    await signal(twin.id, "signup", ago(DAY));
    // Đọc: dòng quá 30 ngày không ghép được nữa.
    expect(await findExchangeDuplicateSignals()).toEqual([]);

    // Ghi: lần ghi kế xoá luôn dòng cũ.
    await recordIpSignal(
      testDb,
      { memberId: twin.id, ip: IP, kind: "login" },
      new Date(),
    );
    let rows = await testDb.select().from(memberIpSignals);
    expect(rows.map((r) => r.memberId)).not.toContain(group.id);

    // Bước dọn hằng ngày (thông báo đang tắt vì app_settings rỗng).
    await signal(group.id, "register", ago(45 * DAY));
    const report = await runDailyNotifications(testDb, new Date());
    expect(report.errors).toEqual([]);
    expect(report.ipSignalsPruned).toBe(1);
    rows = await testDb.select().from(memberIpSignals);
    expect(rows.map((r) => r.memberId).sort()).toEqual([twin.id, twin.id]);
  });
});
