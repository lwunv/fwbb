/**
 * Integration test cho approveAndMergeMember + getNameMatches — trước đây
 * KHÔNG có test. Quyết định 2026-07-06: KHÔNG chặn merge khi target đã có
 * mật khẩu riêng nữa (trước đó chặn hẳn) — cho merge NHƯNG reset mật khẩu cũ
 * (set null) để tránh 2 người cùng truy cập 1 tài khoản (chống chiếm tài
 * khoản theo cách khác: đảm bảo chỉ còn 1 đường đăng nhập sau merge).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, memberOauthIdentities } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { approveAndMergeMember, getNameMatches, declineGroupRequest } =
  await import("./member-approval");
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
  beforeEach(reset);

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
