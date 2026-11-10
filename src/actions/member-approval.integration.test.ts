/**
 * Integration test cho approveAndMergeMember + getNameMatches — trước đây
 * KHÔNG có test. Quyết định 2026-07-06: KHÔNG chặn merge khi target đã có
 * mật khẩu riêng nữa (trước đó chặn hẳn) — cho merge NHƯNG reset mật khẩu cũ
 * (set null) để tránh 2 người cùng truy cập 1 tài khoản (chống chiếm tài
 * khoản theo cách khác: đảm bảo chỉ còn 1 đường đăng nhập sau merge).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  memberOauthIdentities,
  peerFeedback,
  exchangeEvents,
  venueReviews,
  venues,
} from "@/db/schema";
import { eq } from "drizzle-orm";

const flag = vi.hoisted(() => ({ on: true }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/exchange-flag", () => ({
  isExchangeEnabled: vi.fn(async () => flag.on),
}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  approveAndMergeMember,
  approveMember,
  getNameMatches,
  declineGroupRequest,
  rejectMember,
} = await import("./member-approval");
const { requireAdmin } = await import("@/lib/auth");
const { findMemberByOAuth } = await import("@/lib/oauth-identity");

async function reset() {
  await client.execute("DELETE FROM member_oauth_identities");
  await client.execute("DELETE FROM members");
}

async function memberById(id: number) {
  return testDb.query.members.findFirst({ where: eq(members.id, id) });
}

describe("approveAndMergeMember", () => {
  beforeEach(reset);

  it("target CÓ mật khẩu riêng: merge vẫn thành công, passwordHash bị reset về null", async () => {
    const [target] = await testDb
      .insert(members)
      .values({
        name: "Tuấn Béo",
        nickname: "Tuấn Béo",
        approvalStatus: "approved",
        passwordHash: "$2a$10$realbcrypthashforexistinguser",
        email: "old@example.com",
      })
      .returning({ id: members.id });
    const [pending] = await testDb
      .insert(members)
      .values({
        name: "Tuấn Phạm",
        approvalStatus: "pending",
        googleId: "google-sub-123",
      })
      .returning({ id: members.id });

    const result = await approveAndMergeMember(pending.id, target.id);
    expect(result).toEqual({ success: true });

    const merged = await memberById(target.id);
    expect(merged?.passwordHash).toBeNull();
    expect(merged?.googleId).toBe("google-sub-123");
    expect(merged?.approvalStatus).toBe("approved");

    const pendingRow = await memberById(pending.id);
    expect(pendingRow).toBeUndefined(); // hard-deleted sau merge
  });

  it("target KHÔNG có mật khẩu: merge thành công, passwordHash vẫn null (không đổi gì thừa)", async () => {
    const [target] = await testDb
      .insert(members)
      .values({ name: "Placeholder", approvalStatus: "approved" })
      .returning({ id: members.id });
    const [pending] = await testDb
      .insert(members)
      .values({
        name: "Placeholder Thật",
        approvalStatus: "pending",
        facebookId: "fb-456",
      })
      .returning({ id: members.id });

    const result = await approveAndMergeMember(pending.id, target.id);
    expect(result).toEqual({ success: true });

    const merged = await memberById(target.id);
    expect(merged?.passwordHash).toBeNull();
    expect(merged?.facebookId).toBe("fb-456");
  });

  it("cả 2 bên cùng có googleId (multi-SSO): merge thành công, cả 2 Google trỏ về target", async () => {
    // Trước 2026-07-06 guard chặn case này. Giờ multi-SSO: Google của pending
    // gộp thành identity phụ của target → cả 2 tài khoản Google đăng nhập được
    // vào target. Đúng kịch bản "Phiêu 2 tài khoản Google".
    const [target] = await testDb
      .insert(members)
      .values({
        name: "A",
        approvalStatus: "approved",
        googleId: "google-target",
      })
      .returning({ id: members.id });
    const [pending] = await testDb
      .insert(members)
      .values({
        name: "A giống tên",
        approvalStatus: "pending",
        googleId: "google-pending",
      })
      .returning({ id: members.id });

    const result = await approveAndMergeMember(pending.id, target.id);
    expect(result).toEqual({ success: true });

    // Pending bị xóa; cả 2 Google đều đăng nhập vào target (pending's Google
    // qua identity row vừa tạo, target's Google qua fallback cột legacy).
    expect(await memberById(pending.id)).toBeUndefined();
    expect((await findMemberByOAuth("google", "google-pending"))?.id).toBe(
      target.id,
    );
    expect((await findMemberByOAuth("google", "google-target"))?.id).toBe(
      target.id,
    );
    const foldedId = await testDb.query.memberOauthIdentities.findFirst({
      where: eq(memberOauthIdentities.providerUid, "google-pending"),
    });
    expect(foldedId?.memberId).toBe(target.id);
  });
});

describe("getNameMatches", () => {
  beforeEach(reset);

  it("trả hasPassword=true cho candidate đã có mật khẩu riêng", async () => {
    await testDb.insert(members).values({
      name: "Tuấn Béo",
      nickname: "Tuấn Béo",
      approvalStatus: "approved",
      passwordHash: "$2a$10$hash",
    });
    const [pending] = await testDb
      .insert(members)
      .values({ name: "Tuấn Phạm", approvalStatus: "pending" })
      .returning({ id: members.id });

    const suggestions = await getNameMatches(pending.id);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].hasPassword).toBe(true);
  });

  it("trả hasPassword=false cho candidate admin-tạo chưa có mật khẩu", async () => {
    await testDb.insert(members).values({
      name: "Tuấn Béo",
      approvalStatus: "approved",
    });
    const [pending] = await testDb
      .insert(members)
      .values({ name: "Tuấn Béo", approvalStatus: "pending" })
      .returning({ id: members.id });

    const suggestions = await getNameMatches(pending.id);
    expect(suggestions[0].hasPassword).toBe(false);
  });
});

describe("getNameMatches với identity zalo", () => {
  beforeEach(reset);

  it("member approved chỉ có identity zalo KHÔNG được gợi ý như member do admin tạo", async () => {
    const [zaloOnly] = await testDb
      .insert(members)
      .values({ name: "Hùng Zalo", approvalStatus: "approved" })
      .returning({ id: members.id });
    await testDb.insert(memberOauthIdentities).values({
      memberId: zaloOnly.id,
      provider: "zalo",
      providerUid: "zalo-uid-1",
    });
    const [pending] = await testDb
      .insert(members)
      .values({ name: "Hùng Zalo", approvalStatus: "pending" })
      .returning({ id: members.id });

    expect(await getNameMatches(pending.id)).toEqual([]);
  });

  it("member approved không có cột legacy nhưng có identity GOOGLE vẫn được gợi ý (hành vi cũ)", async () => {
    const [linked] = await testDb
      .insert(members)
      .values({ name: "Hùng Google", approvalStatus: "approved" })
      .returning({ id: members.id });
    await testDb.insert(memberOauthIdentities).values({
      memberId: linked.id,
      provider: "google",
      providerUid: "google-uid-linked",
    });
    const [pending] = await testDb
      .insert(members)
      .values({ name: "Hùng Google", approvalStatus: "pending" })
      .returning({ id: members.id });

    const s = await getNameMatches(pending.id);
    expect(s.map((x) => x.memberId)).toEqual([linked.id]);
  });

  it("member approved không có identity nào vẫn được gợi ý", async () => {
    const [adminMade] = await testDb
      .insert(members)
      .values({ name: "Hùng Tạo Tay", approvalStatus: "approved" })
      .returning({ id: members.id });
    const [pending] = await testDb
      .insert(members)
      .values({ name: "Hùng Tạo Tay", approvalStatus: "pending" })
      .returning({ id: members.id });

    const s = await getNameMatches(pending.id);
    expect(s.map((x) => x.memberId)).toEqual([adminMade.id]);
  });
});

describe("approveAndMergeMember với tài khoản giao lưu", () => {
  beforeEach(reset);

  it("từ chối khi đích là tài khoản giao lưu, không đổi gì", async () => {
    const [target] = await testDb
      .insert(members)
      .values({
        name: "Đích",
        approvalStatus: "pending",
        signupIntent: "exchange",
      })
      .returning({ id: members.id });
    const [pending] = await testDb
      .insert(members)
      .values({ name: "Nguồn", approvalStatus: "pending", googleId: "g-x" })
      .returning({ id: members.id });

    const r = await approveAndMergeMember(pending.id, target.id);
    expect(r).toHaveProperty("error");
    expect((await memberById(target.id))?.approvalStatus).toBe("pending");
    expect(await memberById(pending.id)).toBeDefined();
  });

  it("từ chối khi nguồn là tài khoản giao lưu", async () => {
    const [target] = await testDb
      .insert(members)
      .values({ name: "Đích", approvalStatus: "approved" })
      .returning({ id: members.id });
    const [exch] = await testDb
      .insert(members)
      .values({
        name: "Giao lưu",
        approvalStatus: "pending",
        signupIntent: "exchange",
      })
      .returning({ id: members.id });

    const r = await approveAndMergeMember(exch.id, target.id);
    expect(r).toHaveProperty("error");
    expect(await memberById(exch.id)).toBeDefined();
  });
});

describe("declineGroupRequest", () => {
  beforeEach(async () => {
    flag.on = true;
    await reset();
  });

  async function seedPending(
    values: Partial<typeof members.$inferInsert> = {},
  ) {
    const [m] = await testDb
      .insert(members)
      .values({
        name: "Xin vào",
        approvalStatus: "pending",
        signupIntent: "group",
        ...values,
      })
      .returning({ id: members.id });
    return m.id;
  }

  it("pending group → exchange, approvalStatus vẫn pending", async () => {
    const id = await seedPending();
    expect(await declineGroupRequest(id)).toEqual({ success: true });
    const m = await memberById(id);
    expect(m?.signupIntent).toBe("exchange");
    expect(m?.approvalStatus).toBe("pending");
    expect(m?.isActive).toBe(true);
  });

  it("không phải admin → error, không ghi", async () => {
    const id = await seedPending();
    vi.mocked(requireAdmin).mockResolvedValueOnce({ error: "Unauthorized" });
    const r = await declineGroupRequest(id);
    expect(r).toHaveProperty("error");
    expect((await memberById(id))?.signupIntent).toBe("group");
  });

  it("cờ giao lưu tắt → error, không ghi", async () => {
    const id = await seedPending();
    flag.on = false;
    expect(await declineGroupRequest(id)).toHaveProperty("error");
    expect((await memberById(id))?.signupIntent).toBe("group");
  });

  it("approved → error, không đổi ý định", async () => {
    const id = await seedPending({ approvalStatus: "approved" });
    expect(await declineGroupRequest(id)).toHaveProperty("error");
    expect((await memberById(id))?.signupIntent).toBe("group");
  });

  it("đã là exchange, đã bị khoá hay id sai → error", async () => {
    const exch = await seedPending({ signupIntent: "exchange" });
    const locked = await seedPending({ isActive: false });
    expect(await declineGroupRequest(exch)).toHaveProperty("error");
    expect(await declineGroupRequest(locked)).toHaveProperty("error");
    expect((await memberById(locked))?.signupIntent).toBe("group");
    expect(await declineGroupRequest(0)).toHaveProperty("error");
    expect(await declineGroupRequest(99999)).toHaveProperty("error");
  });
});

// ── G2d: duyệt / từ chối làm mới cache hồ sơ, người được chấm và điểm sân ──

describe("approve and reject refresh reputation caches (G2d)", () => {
  const NOW = "2026-11-05T00:00:00.000Z";

  async function cleanRep() {
    for (const t of [
      "peer_feedback",
      "venue_reviews",
      "exchange_events",
      "venues",
      "notifications",
    ]) {
      await client.execute(`DELETE FROM ${t}`);
    }
  }

  beforeEach(async () => {
    await cleanRep();
    await reset();
    const { updateTag } = await import("next/cache");
    vi.mocked(updateTag).mockClear();
  });
  afterEach(cleanRep);

  it("rejecting or approving a rater refreshes their profile, the people they rated and their venue tags", async () => {
    const [rater, rated, host] = await testDb
      .insert(members)
      .values([
        { name: "Nguoi cham", approvalStatus: "pending" },
        { name: "Duoc cham", approvalStatus: "approved" },
        { name: "Host", approvalStatus: "approved" },
      ])
      .returning({ id: members.id });
    const [v] = await testDb
      .insert(venues)
      .values({ name: "San", lat: 10, lng: 106 })
      .returning({ id: venues.id });
    const [ev] = await testDb
      .insert(exchangeEvents)
      .values({
        publicCode: "REPAP1",
        hostMemberId: host.id,
        venueId: v.id,
        title: "Giao lưu",
        startAt: "2026-11-01T12:00:00.000Z",
        endAt: "2026-11-01T14:00:00.000Z",
        slotsTotal: 10,
        feeMode: "fixed",
        registerDeadline: "2026-11-01T10:00:00.000Z",
        cancelDeadline: "2026-11-01T08:00:00.000Z",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning({ id: exchangeEvents.id });
    await testDb.insert(peerFeedback).values({
      eventId: ev.id,
      fromMemberId: rater.id,
      toMemberId: rated.id,
      raterWeight: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await testDb.insert(venueReviews).values({
      venueId: v.id,
      memberId: rater.id,
      scoreSurface: 4,
      scoreLighting: 4,
      scoreVentilation: 4,
      scorePrice: 4,
      scoreParking: 4,
      scoreOwner: 4,
      raterWeight: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const { updateTag } = await import("next/cache");
    const expected = [`rep:m${rater.id}`, `rep:m${rated.id}`, `vrev:v${v.id}`];

    expect(await rejectMember(rater.id)).toEqual({ success: true });
    expect(vi.mocked(updateTag).mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(expected),
    );

    vi.mocked(updateTag).mockClear();
    expect(await approveMember(rater.id)).toEqual({ success: true });
    expect(vi.mocked(updateTag).mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(expected),
    );
  });

  it("a failing cache refresh after approve or reject still returns success and revalidates the pending page", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "Cho duyet", approvalStatus: "pending" })
      .returning({ id: members.id });
    const { updateTag, revalidatePath } = await import("next/cache");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const run of [approveMember, rejectMember]) {
        vi.mocked(revalidatePath).mockClear();
        vi.mocked(updateTag).mockImplementationOnce(() => {
          throw new Error("socket hang up");
        });
        expect(await run(m.id)).toEqual({ success: true });
        expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toEqual(
          expect.arrayContaining(["/admin/members", "/pending-approval"]),
        );
      }
      expect((await memberById(m.id))?.approvalStatus).toBe("rejected");
      expect(err).toHaveBeenCalledWith("[Reputation] invalidate_failed", {
        memberIds: [m.id],
      });
    } finally {
      err.mockRestore();
    }
  });
});
