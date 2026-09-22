import { describe, expect, it } from "vitest";
import {
  computeGroupPlayRates,
  DEFAULT_GROUP_POLICIES,
  type GroupPolicy,
  type GroupKey,
} from "./group-policy";

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
      // Chỉ là số điền sẵn cho ô phần trăm (thêm 22/9/2026). Nó KHÔNG tác
      // động đồng nào khi mode còn là "floor"; phần tiền được khoá ở khối
      // "tương đương hành vi cũ" bên dưới.
      percent: 80,
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

describe("computeGroupPlayRates — totalPlayCost = 0 (khác nhánh với 0 người chơi)", () => {
  it("chi phí bằng 0 nhưng vẫn có người chơi thì mọi suất vẫn bằng 0", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 0,
      headsByGroup: heads({ member: 4, guestAdmin: 2 }),
      policies: DEFAULT_GROUP_POLICIES,
    });
    expect(Object.values(r).every((v) => v === 0)).toBe(true);
  });
});

describe("computeGroupPlayRates — biên đúng lúc suất chia đều bằng sàn (review finding 1)", () => {
  // Chỉ 1 nhóm ăn sàn đúng lúc equalRate == amount thì KHÔNG thể phân biệt
  // <= với < (dời nhóm đó vào rổ hay không cho ra số giống nhau — nhập rổ
  // không đổi suất chia đều khi số dời vào đúng bằng suất hiện tại). Cần MỘT
  // nhóm sàn khác thấp hơn hẳn (guestMemberFemale 40K) cùng dời trong CÙNG một
  // vòng để suất chia đều thật sự đổi tuỳ có tính guestAdmin vào rổ hay không —
  // đó mới là chỗ <= và < cho ra hai số khác nhau.
  const floor40: GroupPolicy = {
    mode: "floor",
    amount: 40_000,
    capAtEqual: false,
  };

  it("sàn 60K PHẢI kích hoạt khi suất chia đều đúng bằng 60K (biên chính xác)", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 560_000,
      headsByGroup: heads({ member: 5, guestAdmin: 3, guestMemberFemale: 2 }),
      policies: {
        ...DEFAULT_GROUP_POLICIES,
        guestAdmin: floor60,
        guestMemberFemale: floor40,
      },
    });
    // Vòng đầu: (560K − 60K×3 − 40K×2) / 5 = 300K / 5 = 60K — đúng bằng sàn của
    // guestAdmin. guestMemberFemale (40K) chắc chắn vào rổ vì rẻ hơn hẳn; nếu
    // guestAdmin CŨNG vào rổ (đúng hành vi <=), rổ cuối = 10 đầu, suất ổn định
    // 560K/10 = 56K cho tất cả. Nếu toán tử bị đổi thành < (guestAdmin không
    // vào rổ), guestAdmin vẫn trả 60K cố định còn 8 đầu còn lại chia
    // (560K−60K×3)/8 = 47.5K → 48K, một kết quả khác hẳn — test này bắt được.
    expect(r.member).toBe(56_000);
    expect(r.guestAdmin).toBe(56_000);
    expect(r.guestMemberFemale).toBe(56_000);
  });
});

describe("computeGroupPlayRates — cascade nhiều vòng (review finding 2)", () => {
  it("cap kéo suất lên rồi sàn kéo xuống, chốt đúng điểm dừng cuối chứ không phải số giữa đường", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 2_598_000,
      headsByGroup: heads({ member: 20, guestAdmin: 1, guestMemberFemale: 1 }),
      policies: {
        ...DEFAULT_GROUP_POLICIES,
        guestAdmin: { mode: "fixed", amount: 280_000, capAtEqual: true },
        guestMemberFemale: {
          mode: "floor",
          amount: 118_000,
          capAtEqual: false,
        },
      },
    });
    // Vòng 0: suất chia đều = (2.598M − 280K − 118K)/20 = 110K. guestAdmin đòi
    // 280K > 110K nên bị cap kéo vào rổ.
    // Vòng 1: rổ giờ 21 đầu, suất = (2.598M − 118K)/21 ≈ 118.095K — đã vượt
    // sàn 118K của guestMemberFemale nên nhóm này cũng vào rổ.
    // Vòng 2: rổ đủ 22 đầu, suất = 2.598M/22 ≈ 118.0909K, không ai chuyển nữa
    // — điểm dừng thật, làm tròn lên 119K. Nếu vòng lặp dừng sớm (thiếu vòng
    // xác nhận cuối) thì kết quả sẽ kẹt ở 110K (vòng 0) hoặc một số chưa tính
    // guestMemberFemale (vòng 1), cả hai đều SAI so với 119K.
    expect(r.member).toBe(119_000);
    expect(r.guestAdmin).toBe(119_000);
    expect(r.guestMemberFemale).toBe(119_000);
  });
});

describe("computeGroupPlayRates — đầu người âm là lỗi lập trình (review finding 3)", () => {
  // Đầu người âm không thể xảy ra thật (không có buổi nào có "-2 người").
  // Clamp âm thầm về 0 vẫn ra một số tiền và sẽ có người bị thu theo số đó —
  // đúng kiểu lỗi "thu sai ngầm"/"miễn phí ngầm" app này đã từng dính. Throw
  // để lỗi lộ ra ngay ở test và ở nhánh {error} của server action.
  it("một nhóm âm nhẹ: throw thay vì lệch hẳn suất của nhóm khác", () => {
    expect(() =>
      computeGroupPlayRates({
        totalPlayCost: 300_000,
        headsByGroup: heads({ member: 5, guestMember: -2 }),
        policies: DEFAULT_GROUP_POLICIES,
      }),
    ).toThrow();
  });

  it("một nhóm âm mạnh khiến tổng đầu người âm: throw thay vì thu 0 (miễn phí ngầm)", () => {
    expect(() =>
      computeGroupPlayRates({
        totalPlayCost: 300_000,
        headsByGroup: heads({ member: 2, guestMember: -10 }),
        policies: DEFAULT_GROUP_POLICIES,
      }),
    ).toThrow();
  });
});
