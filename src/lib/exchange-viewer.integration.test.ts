/**
 * Cổng quyền vùng giao lưu: member pending (đăng ký giao lưu hoặc chờ duyệt
 * nhóm) vẫn vào được vùng giao lưu, còn rejected / khoá / không tồn tại thì
 * không. isGroupMember cho UI biết có được mở dữ liệu nhóm hay không.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members } from "@/db/schema";

vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => null),
}));
import { getUserFromCookie } from "@/lib/user-identity";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getExchangeViewer, requireExchangeMember } =
  await import("./member-auth");
const { isExchangeAccount } = await import("./exchange-account");
const { getFundRosterMemberIds } = await import("./fund-calculator");

const cookieMock = vi.mocked(getUserFromCookie);

async function reset() {
  await client.execute("DELETE FROM members");
  cookieMock.mockReset();
  cookieMock.mockResolvedValue(null);
}

async function addMember(opts: {
  fbId: string;
  approvalStatus?: "pending" | "approved" | "rejected";
  signupIntent?: "group" | "exchange";
  isActive?: boolean;
}) {
  const [m] = await testDb
    .insert(members)
    .values({
      name: `M-${opts.fbId}`,
      facebookId: opts.fbId,
      approvalStatus: opts.approvalStatus ?? "approved",
      signupIntent: opts.signupIntent ?? "group",
      isActive: opts.isActive ?? true,
    })
    .returning({ id: members.id });
  return m.id;
}

function loginAs(memberId: number) {
  cookieMock.mockResolvedValue({ memberId, externalId: `ext-${memberId}` });
}

describe("getExchangeViewer", () => {
  beforeEach(reset);

  it("pending exchange → ok, isGroupMember=false", async () => {
    const id = await addMember({
      fbId: "a",
      approvalStatus: "pending",
      signupIntent: "exchange",
    });
    loginAs(id);
    const v = await getExchangeViewer();
    expect(v.status).toBe("ok");
    if (v.status === "ok") {
      expect(v.isGroupMember).toBe(false);
      expect(v.member.id).toBe(id);
    }
  });

  it("pending group → ok, isGroupMember=false", async () => {
    const id = await addMember({ fbId: "b", approvalStatus: "pending" });
    loginAs(id);
    const v = await getExchangeViewer();
    expect(v.status).toBe("ok");
    if (v.status === "ok") expect(v.isGroupMember).toBe(false);
  });

  it("approved → ok, isGroupMember=true", async () => {
    const id = await addMember({ fbId: "c" });
    loginAs(id);
    const v = await getExchangeViewer();
    expect(v.status).toBe("ok");
    if (v.status === "ok") expect(v.isGroupMember).toBe(true);
  });

  it("rejected → blocked", async () => {
    const id = await addMember({ fbId: "d", approvalStatus: "rejected" });
    loginAs(id);
    expect(await getExchangeViewer()).toEqual({ status: "blocked" });
  });

  it("khoá (isActive=false) → blocked, kể cả đã approved", async () => {
    const id = await addMember({ fbId: "e", isActive: false });
    loginAs(id);
    expect(await getExchangeViewer()).toEqual({ status: "blocked" });
  });

  it("member không tồn tại → blocked", async () => {
    loginAs(99999);
    expect(await getExchangeViewer()).toEqual({ status: "blocked" });
  });

  it("không cookie → anonymous", async () => {
    expect(await getExchangeViewer()).toEqual({ status: "anonymous" });
  });
});

describe("requireExchangeMember", () => {
  beforeEach(reset);

  it("pending exchange và pending group đều qua, trả user + member", async () => {
    const ex = await addMember({
      fbId: "f",
      approvalStatus: "pending",
      signupIntent: "exchange",
    });
    loginAs(ex);
    const r1 = await requireExchangeMember();
    expect("error" in r1).toBe(false);
    if (!("error" in r1)) expect(r1.member.id).toBe(ex);

    const gp = await addMember({ fbId: "g", approvalStatus: "pending" });
    loginAs(gp);
    expect("error" in (await requireExchangeMember())).toBe(false);
  });

  it("không cookie / không tồn tại / khoá / rejected → { error }", async () => {
    expect("error" in (await requireExchangeMember())).toBe(true);

    loginAs(99999);
    expect("error" in (await requireExchangeMember())).toBe(true);

    const locked = await addMember({ fbId: "h", isActive: false });
    loginAs(locked);
    expect("error" in (await requireExchangeMember())).toBe(true);

    const rej = await addMember({ fbId: "i", approvalStatus: "rejected" });
    loginAs(rej);
    expect("error" in (await requireExchangeMember())).toBe(true);
  });
});

describe("isExchangeAccount", () => {
  it("chỉ đúng với pending + exchange", () => {
    expect(
      isExchangeAccount({
        approvalStatus: "pending",
        signupIntent: "exchange",
      }),
    ).toBe(true);
    expect(
      isExchangeAccount({ approvalStatus: "pending", signupIntent: "group" }),
    ).toBe(false);
    expect(
      isExchangeAccount({
        approvalStatus: "approved",
        signupIntent: "exchange",
      }),
    ).toBe(false);
    expect(
      isExchangeAccount({
        approvalStatus: "rejected",
        signupIntent: "exchange",
      }),
    ).toBe(false);
    expect(
      isExchangeAccount({ approvalStatus: "approved", signupIntent: "group" }),
    ).toBe(false);
  });
});

describe("fund roster", () => {
  beforeEach(reset);

  it("không gồm member pending exchange", async () => {
    const ex = await addMember({
      fbId: "j",
      approvalStatus: "pending",
      signupIntent: "exchange",
    });
    const ok = await addMember({ fbId: "k" });
    const ids = await getFundRosterMemberIds();
    expect(ids).not.toContain(ex);
    expect(ids).toContain(ok);
  });
});
