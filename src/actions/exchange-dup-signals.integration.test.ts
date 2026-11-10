import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { dupIgnoredPairs, memberIpSignals, members } from "@/db/schema";

const mocks = vi.hoisted(() => ({ flag: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { findExchangeDuplicateSignals } = await import("./exchange-dup-signals");
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
    expect(await findExchangeDuplicateSignals()).toEqual([]);
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
