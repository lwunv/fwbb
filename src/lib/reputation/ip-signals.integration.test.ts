import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { memberIpSignals, members } from "@/db/schema";
import { hashedIpKey } from "@/lib/client-ip";

const { db: testDb, client } = await createTestDb();
const { ipSignalHash, ipSignalPruneQuery, pruneIpSignals, recordIpSignal } =
  await import("./ip-signals");

const DAY = 86_400_000;
const NOW = new Date("2026-11-10T03:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

async function newMember() {
  const [m] = await testDb
    .insert(members)
    .values({ name: "m", approvalStatus: "pending", signupIntent: "exchange" })
    .returning({ id: members.id });
  return m.id;
}

const allSignals = () =>
  testDb.select().from(memberIpSignals).orderBy(memberIpSignals.id);

beforeEach(async () => {
  await client.execute("DELETE FROM member_ip_signals");
  await client.execute("DELETE FROM members");
});

describe("ipSignalHash", () => {
  it("ipSignalHash differs from hashedIpKey for the same IP and two IPv6 addresses in one /64 share it", () => {
    const h = ipSignalHash("203.0.113.7");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toBe(hashedIpKey("203.0.113.7"));
    expect(h).not.toContain("203.0.113.7");
    expect(ipSignalHash("203.0.113.8")).not.toBe(h);

    const a = ipSignalHash("2001:db8:1:2::1");
    expect(ipSignalHash("2001:db8:1:2:ffff::9")).toBe(a);
    expect(ipSignalHash("2001:db8:1:3::1")).not.toBe(a);
  });
});

describe("recordIpSignal", () => {
  it("recording upserts one row per member, hash and kind and moves last_seen_at", async () => {
    const id = await newMember();
    const t1 = new Date(NOW.getTime() - 2 * DAY);
    await recordIpSignal(
      testDb,
      { memberId: id, ip: "203.0.113.7", kind: "login" },
      t1,
    );
    await recordIpSignal(
      testDb,
      { memberId: id, ip: "203.0.113.7", kind: "login" },
      NOW,
    );
    await recordIpSignal(
      testDb,
      { memberId: id, ip: "203.0.113.7", kind: "register" },
      NOW,
    );
    await recordIpSignal(
      testDb,
      { memberId: id, ip: "198.51.100.1", kind: "login" },
      NOW,
    );

    const rows = await allSignals();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      memberId: id,
      ipHash: ipSignalHash("203.0.113.7"),
      kind: "login",
      firstSeenAt: t1.toISOString(),
      lastSeenAt: NOW.toISOString(),
    });
    expect(rows[1]).toMatchObject({
      kind: "register",
      firstSeenAt: NOW.toISOString(),
    });
    expect(rows[2].ipHash).toBe(ipSignalHash("198.51.100.1"));
    // Không lưu IP thô ở bất kỳ cột nào.
    expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
  });

  it("unknown IP records nothing", async () => {
    const id = await newMember();
    await recordIpSignal(
      testDb,
      { memberId: id, ip: "unknown", kind: "signup" },
      NOW,
    );
    expect(await allSignals()).toEqual([]);
  });

  it("a write prunes one batch of rows older than 30 days", async () => {
    const id = await newMember();
    await testDb.insert(memberIpSignals).values([
      {
        memberId: id,
        ipHash: "old",
        kind: "login",
        firstSeenAt: ago(40 * DAY),
        lastSeenAt: ago(31 * DAY),
      },
      {
        memberId: id,
        ipHash: "fresh",
        kind: "login",
        firstSeenAt: ago(40 * DAY),
        lastSeenAt: ago(29 * DAY),
      },
    ]);
    await recordIpSignal(
      testDb,
      { memberId: id, ip: "203.0.113.7", kind: "login" },
      NOW,
    );
    expect((await allSignals()).map((r) => r.ipHash).sort()).toEqual(
      ["fresh", ipSignalHash("203.0.113.7")].sort(),
    );
  });
});

describe("pruneIpSignals", () => {
  it("the prune deletes at most 200 rows per batch and uses the last_seen_at index (EXPLAIN, no SCAN)", async () => {
    const id = await newMember();
    const old = Array.from({ length: 250 }, (_, i) => ({
      memberId: id,
      ipHash: `h${i}`,
      kind: "login" as const,
      firstSeenAt: ago(60 * DAY),
      lastSeenAt: ago(31 * DAY + i * 1000),
    }));
    for (let i = 0; i < old.length; i += 50) {
      await testDb.insert(memberIpSignals).values(old.slice(i, i + 50));
    }
    await testDb.insert(memberIpSignals).values({
      memberId: id,
      ipHash: "fresh",
      kind: "login",
      firstSeenAt: ago(60 * DAY),
      lastSeenAt: ago(29 * DAY),
    });

    expect(await pruneIpSignals(testDb, NOW)).toBe(200);
    expect(await allSignals()).toHaveLength(51);
    // Lô đầu xoá dòng cũ nhất trước.
    const left = (await allSignals()).map((r) => r.ipHash);
    expect(left).toContain("h0");
    expect(left).not.toContain("h249");

    expect(await pruneIpSignals(testDb, NOW)).toBe(50);
    expect(await pruneIpSignals(testDb, NOW)).toBe(0);
    expect((await allSignals()).map((r) => r.ipHash)).toEqual(["fresh"]);

    const q = ipSignalPruneQuery(testDb, NOW).toSQL();
    const plan = await client.execute({
      sql: `EXPLAIN QUERY PLAN ${q.sql}`,
      args: q.params as (string | number)[],
    });
    const details = plan.rows.map((r) => String(r.detail));
    expect(details.join("\n")).toContain("member_ip_signals_last_seen_idx");
    expect(details.filter((d) => /^SCAN\b/.test(d))).toEqual([]);
  });
});
