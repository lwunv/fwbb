import { describe, expect, it } from "vitest";
import {
  computeGroupPlayRates,
  DEFAULT_GROUP_POLICIES,
  type GroupPolicy,
  type GroupKey,
} from "./group-policy";

const equal: GroupPolicy = { mode: "equal", amount: 0, capAtEqual: false };
const floor60: GroupPolicy = {
  mode: "floor",
  amount: 60_000,
  capAtEqual: false,
};
const fixed50Cap: GroupPolicy = {
  mode: "fixed",
  amount: 50_000,
  capAtEqual: true,
};
const fixed50: GroupPolicy = {
  mode: "fixed",
  amount: 50_000,
  capAtEqual: false,
};

function heads(
  partial: Partial<Record<GroupKey, number>>,
): Record<GroupKey, number> {
  return {
    member: 0,
    memberFemale: 0,
    guestMember: 0,
    guestMemberFemale: 0,
    guestAdmin: 0,
    guestAdminFemale: 0,
    ...partial,
  };
}

describe("computeGroupPlayRates — ba ví dụ trong spec", () => {
  const policies = {
    ...DEFAULT_GROUP_POLICIES,
    memberFemale: fixed50Cap,
    guestAdmin: floor60,
  };

  it("buổi đông vừa: 6 nam, 2 nữ, 2 khách admin", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({ member: 6, memberFemale: 2, guestAdmin: 2 }),
      policies,
    });
    expect(r.member).toBe(75_000);
    expect(r.guestAdmin).toBe(75_000); // suất chia đều đã vượt sàn nên sàn không kích hoạt
    expect(r.memberFemale).toBe(50_000);
    // Thu đúng tổng chi: 8 × 75K + 2 × 50K = 700K
    expect(6 * r.member + 2 * r.guestAdmin + 2 * r.memberFemale).toBe(700_000);
  });

  it("buổi vắng: 2 nam, 2 nữ — nam gánh phần còn lại", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({ member: 2, memberFemale: 2 }),
      policies,
    });
    expect(r.memberFemale).toBe(50_000);
    expect(r.member).toBe(300_000);
  });

  it("buổi rất đông: tick cap kéo nữ về suất chia đều", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({ member: 20, memberFemale: 2 }),
      policies,
    });
    expect(r.member).toBe(32_000);
    expect(r.memberFemale).toBe(32_000);
  });

  it("bỏ tick cap thì nữ trả đúng số cố định dù cao hơn suất chia đều", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({ member: 20, memberFemale: 2 }),
      policies: { ...DEFAULT_GROUP_POLICIES, memberFemale: fixed50 },
    });
    expect(r.memberFemale).toBe(50_000);
    expect(r.member).toBe(30_000);
  });
});

describe("computeGroupPlayRates — biên", () => {
  it("không ai chơi thì mọi suất bằng 0", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({}),
      policies: DEFAULT_GROUP_POLICIES,
    });
    expect(Object.values(r).every((v) => v === 0)).toBe(true);
  });

  it("mọi nhóm đều cố định (rổ chia đều rỗng) thì bỏ qua chính sách, chia đều naive", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({ member: 2, memberFemale: 2 }),
      policies: {
        ...DEFAULT_GROUP_POLICIES,
        member: fixed50,
        memberFemale: fixed50,
      },
    });
    // 700K / 4 đầu = 175K, làm tròn lên 1K
    expect(r.member).toBe(175_000);
    expect(r.memberFemale).toBe(175_000);
  });

  it("nhóm cố định đòi nhiều hơn cả tổng chi phí thì suất chia đều không âm", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 50_000,
      headsByGroup: heads({ member: 1, memberFemale: 2 }),
      policies: { ...DEFAULT_GROUP_POLICIES, memberFemale: fixed50 },
    });
    expect(r.member).toBe(0);
    expect(r.memberFemale).toBe(50_000);
  });

  it("nhóm 0 đầu người không ảnh hưởng suất của nhóm khác", () => {
    const a = computeGroupPlayRates({
      totalPlayCost: 300_000,
      headsByGroup: heads({ member: 3 }),
      policies: { ...DEFAULT_GROUP_POLICIES, guestAdmin: floor60 },
    });
    expect(a.member).toBe(100_000);
  });
});

describe("DEFAULT_GROUP_POLICIES — giữ hành vi hôm nay", () => {
  it("chỉ hai nhóm khách của admin ăn sàn 60K, còn lại chia đều", () => {
    expect(DEFAULT_GROUP_POLICIES.guestAdmin).toEqual({
      mode: "floor",
      amount: 60_000,
      capAtEqual: false,
    });
    expect(DEFAULT_GROUP_POLICIES.guestAdminFemale).toEqual({
      mode: "floor",
      amount: 60_000,
      capAtEqual: false,
    });
    expect(DEFAULT_GROUP_POLICIES.member.mode).toBe("equal");
    expect(DEFAULT_GROUP_POLICIES.memberFemale.mode).toBe("equal");
    expect(DEFAULT_GROUP_POLICIES.guestMember.mode).toBe("equal");
    expect(DEFAULT_GROUP_POLICIES.guestMemberFemale.mode).toBe("equal");
  });
});

describe("tương đương hành vi cũ (chứng minh ở spec mục 4.4)", () => {
  // Với cấu hình mặc định, kết quả phải khớp computeGuestAwarePlayRates:
  // sàn kích hoạt khi totalPlayCost / tổngĐầu < 60K.
  it("sàn KHÔNG kích hoạt khi suất chia đều đã vượt sàn", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({ member: 6, guestAdmin: 2 }),
      policies: DEFAULT_GROUP_POLICIES,
    });
    // naive = 700/8 = 87.5K ≥ 60K → mọi người cùng suất
    expect(r.member).toBe(88_000);
    expect(r.guestAdmin).toBe(88_000);
  });

  it("sàn kích hoạt khi suất chia đều thấp hơn sàn", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 300_000,
      headsByGroup: heads({ member: 8, guestAdmin: 2 }),
      policies: DEFAULT_GROUP_POLICIES,
    });
    // naive = 30K < 60K → khách admin trả 60K, còn (300 - 120)/8 = 22.5K → 23K
    expect(r.guestAdmin).toBe(60_000);
    expect(r.member).toBe(23_000);
  });
});
