/**
 * Regression (03/11/2026): các trang dữ liệu nhóm trong (public) chỉ kiểm
 * "đã đăng nhập". Layout có chặn tài khoản chờ duyệt / bị khoá bằng giao diện,
 * nhưng Next render page song song với layout nên dữ liệu của page vẫn nằm
 * trong RSC payload. Tài khoản chờ duyệt đọc được nợ từng người (/history),
 * thống kê theo tên (/stats) và danh sách vote của bất kỳ buổi nào (/vote/[id]).
 * Trang chủ công khai cũng liệt kê cả member chờ duyệt (getActiveMembers).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { courts, members, sessions } from "@/db/schema";

const identity = vi.hoisted(() => ({
  current: null as { memberId: number; externalId: string } | null,
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => identity.current),
}));
vi.mock("@/lib/auth", () => ({
  getAdminFromCookie: vi.fn(async () => null),
  requireAdmin: vi.fn(async () => ({ error: "not admin" })),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { default: HistoryPage } = await import("./history/page");
const { default: PublicStatsPage } = await import("./stats/page");
const { default: VoteSessionPage } = await import("./vote/[id]/page");
const { getActiveMembers } = await import("@/actions/members");

type Viewer = "approved" | "pending" | "rejected" | "locked";

async function seedMember(name: string, kind: Viewer) {
  const [m] = await testDb
    .insert(members)
    .values({
      name,
      approvalStatus:
        kind === "pending"
          ? "pending"
          : kind === "rejected"
            ? "rejected"
            : "approved",
      isActive: kind !== "locked",
    })
    .returning({ id: members.id });
  return m.id;
}

async function seedSession(status: "voting" | "completed") {
  const [c] = await testDb
    .insert(courts)
    .values({ name: "Sân test", pricePerSession: 200_000 })
    .returning({ id: courts.id });
  const [s] = await testDb
    .insert(sessions)
    .values({ date: "2026-10-01", courtId: c.id, status })
    .returning({ id: sessions.id });
  return s.id;
}

function loginAs(memberId: number) {
  identity.current = { memberId, externalId: `ext-${memberId}` };
}

const stats = () => PublicStatsPage({ searchParams: Promise.resolve({}) });
const vote = (id: number) =>
  VoteSessionPage({ params: Promise.resolve({ id: String(id) }) });

beforeEach(async () => {
  identity.current = null;
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM courts");
  await client.execute("DELETE FROM members");
});

describe("trang dữ liệu nhóm chỉ cho member đã duyệt", () => {
  it.each(["pending", "rejected", "locked"] as const)(
    "%s: /history, /stats, /vote/[id] không trả dữ liệu",
    async (kind) => {
      await seedMember("Đã duyệt", "approved");
      const sid = await seedSession("completed");
      loginAs(await seedMember("Người lạ", kind));

      expect(await HistoryPage()).toBeNull();
      expect(await stats()).toBeNull();
      expect(await vote(sid)).toBeNull();
    },
  );

  it("chưa đăng nhập: vẫn chuyển sang /login như cũ", async () => {
    const sid = await seedSession("voting");
    await expect(HistoryPage()).rejects.toThrow("REDIRECT:/login");
    await expect(stats()).rejects.toThrow("REDIRECT:/login");
    await expect(vote(sid)).rejects.toThrow("REDIRECT:/login");
  });

  it("member đã duyệt: cả ba trang vẫn render như cũ", async () => {
    const sid = await seedSession("voting");
    loginAs(await seedMember("Đã duyệt", "approved"));

    expect(await HistoryPage()).not.toBeNull();
    expect(await stats()).not.toBeNull();
    expect(await vote(sid)).not.toBeNull();
  });
});

describe("getActiveMembers (danh sách công khai ở trang chủ / vote)", () => {
  it("không liệt kê member chờ duyệt hay bị từ chối", async () => {
    const ok = await seedMember("Đã duyệt", "approved");
    await seedMember("Chờ duyệt", "pending");
    await seedMember("Bị từ chối", "rejected");
    await seedMember("Bị khoá", "locked");

    const list = await getActiveMembers();
    expect(list.map((m) => m.id)).toEqual([ok]);
  });
});
