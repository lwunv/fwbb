/**
 * Cách tính "nữ = X% nam" (yêu cầu 22/9/2026).
 *
 * Khác hẳn ba cách đã có: `floor`/`fixed` chốt một SỐ TIỀN, còn cách này chốt
 * một TỶ LỆ so với nhóm nam tương ứng. Nghĩa là suất của nữ chỉ biết được sau
 * khi biết suất của nam, mà suất của nam lại phụ thuộc nữ đóng bao nhiêu. Giải
 * bằng cách cho nhóm nữ vào cùng rổ chia đều nhưng mang TRỌNG SỐ X% thay vì 1.
 *
 * Ràng buộc phải giữ, quan trọng hơn mọi con số cụ thể: tổng thu được luôn
 * PHỦ ĐỦ tiền sân + cầu. Làm nữ rẻ đi mà quên dồn phần thiếu sang nam là admin
 * bị hụt tiền thật.
 */
import { describe, expect, it } from "vitest";
import {
  computeGroupPlayRates,
  DEFAULT_GROUP_POLICIES,
  type GroupKey,
  type GroupPolicy,
} from "./group-policy";

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

function pct(percent: number): GroupPolicy {
  return { mode: "percent", amount: 0, capAtEqual: false, percent };
}

/** Tổng tiền thu được của cả buổi theo suất từng nhóm. */
function collected(
  rates: Record<GroupKey, number>,
  h: Record<GroupKey, number>,
): number {
  return (Object.keys(h) as GroupKey[]).reduce(
    (s, k) => s + rates[k] * h[k],
    0,
  );
}

describe("nữ trả theo phần trăm của nam", () => {
  it("80%: 5 nam 5 nữ, 900K — nam 100K, nữ 80K, thu vừa đủ", () => {
    const h = heads({ member: 5, memberFemale: 5 });
    const r = computeGroupPlayRates({
      totalPlayCost: 900_000,
      headsByGroup: h,
      policies: { ...DEFAULT_GROUP_POLICIES, memberFemale: pct(80) },
    });

    // Trọng số: 5 nam × 1 + 5 nữ × 0,8 = 9 suất → 900K / 9 = 100K.
    expect(r.member).toBe(100_000);
    expect(r.memberFemale).toBe(80_000);
    expect(collected(r, h)).toBe(900_000);
  });

  it("đổi được phần trăm: 50% thì nữ trả đúng một nửa nam", () => {
    const h = heads({ member: 4, memberFemale: 4 });
    const r = computeGroupPlayRates({
      totalPlayCost: 600_000,
      headsByGroup: h,
      policies: { ...DEFAULT_GROUP_POLICIES, memberFemale: pct(50) },
    });

    // 4 × 1 + 4 × 0,5 = 6 suất → 100K.
    expect(r.member).toBe(100_000);
    expect(r.memberFemale).toBe(50_000);
    expect(collected(r, h)).toBe(600_000);
  });

  it("100% cho ra ĐÚNG kết quả của chia đều — không được lệch một đồng", () => {
    const h = heads({ member: 3, memberFemale: 4 });
    const arg = { totalPlayCost: 777_000, headsByGroup: h };

    const asPercent = computeGroupPlayRates({
      ...arg,
      policies: { ...DEFAULT_GROUP_POLICIES, memberFemale: pct(100) },
    });
    const asEqual = computeGroupPlayRates({
      ...arg,
      policies: DEFAULT_GROUP_POLICIES,
    });

    expect(asPercent).toEqual(asEqual);
  });

  it("0%: nữ chơi miễn phí, nam gánh trọn tiền sân", () => {
    const h = heads({ member: 5, memberFemale: 3 });
    const r = computeGroupPlayRates({
      totalPlayCost: 500_000,
      headsByGroup: h,
      policies: { ...DEFAULT_GROUP_POLICIES, memberFemale: pct(0) },
    });

    expect(r.memberFemale).toBe(0);
    expect(r.member).toBe(100_000); // 500K / 5 nam
    expect(collected(r, h)).toBe(500_000);
  });

  it("nhóm nam trả số CỐ ĐỊNH: nữ ăn theo đúng số đó, không ăn theo rổ", () => {
    const h = heads({ member: 2, memberFemale: 2, guestMember: 4 });
    const r = computeGroupPlayRates({
      totalPlayCost: 800_000,
      headsByGroup: h,
      policies: {
        ...DEFAULT_GROUP_POLICIES,
        member: { mode: "fixed", amount: 100_000, capAtEqual: false },
        memberFemale: pct(80),
      },
    });

    expect(r.member).toBe(100_000);
    expect(r.memberFemale).toBe(80_000); // 80% của 100K, không phải 80% suất rổ
    // Khách của thành viên nằm trong rổ, gánh phần còn lại:
    // 800K − (2 × 100K) − (2 × 80K) = 440K cho 4 người = 110K.
    expect(r.guestMember).toBe(110_000);
    expect(collected(r, h)).toBe(800_000);
  });

  it("nhóm nam ăn SÀN đang kích hoạt: nữ tính theo mức sàn đó", () => {
    const h = heads({ member: 6, guestAdmin: 1, guestAdminFemale: 1 });
    const r = computeGroupPlayRates({
      totalPlayCost: 400_000,
      headsByGroup: h,
      policies: {
        ...DEFAULT_GROUP_POLICIES, // guestAdmin: sàn 60K
        guestAdminFemale: pct(50),
      },
    });

    // Suất rổ thấp hơn 60K nên sàn kích hoạt: khách admin nam trả 60K,
    // khách admin nữ trả 50% của 60K = 30K.
    expect(r.guestAdmin).toBe(60_000);
    expect(r.guestAdminFemale).toBe(30_000);
    expect(collected(r, h)).toBeGreaterThanOrEqual(400_000);
  });

  it("làm tròn LÊN: chia lẻ thì thu phải phủ đủ chi, không được hụt", () => {
    const h = heads({ member: 7, memberFemale: 5 });
    const r = computeGroupPlayRates({
      totalPlayCost: 1_000_000,
      headsByGroup: h,
      policies: { ...DEFAULT_GROUP_POLICIES, memberFemale: pct(80) },
    });

    expect(collected(r, h)).toBeGreaterThanOrEqual(1_000_000);
    expect(r.member % 1000).toBe(0);
    expect(r.memberFemale % 1000).toBe(0);
  });

  it("cả buổi chỉ có nữ 0%: không ai gánh được thì quay về chia đều, không để admin hụt", () => {
    const h = heads({ memberFemale: 4 });
    const r = computeGroupPlayRates({
      totalPlayCost: 400_000,
      headsByGroup: h,
      policies: { ...DEFAULT_GROUP_POLICIES, memberFemale: pct(0) },
    });

    // Không còn nhóm nào mang trọng số > 0 để gánh. Thà thu đủ còn hơn để
    // admin bù, đúng như nhánh "rổ rỗng" đã có sẵn.
    expect(r.memberFemale).toBe(100_000);
    expect(collected(r, h)).toBe(400_000);
  });

  it("chia CHẴN thì ra số chẵn — không được đội thêm 1.000đ vì sai số dấu phẩy động", () => {
    // 2 nam + 1 nữ ở mức 80%: trọng số 2,8 suất, 350.000 / 2,8 = đúng 125.000.
    // Nhân trực tiếp bằng số thực thì 350000/2.8 ra 125000.00000000001, mà
    // `roundToThousand` làm tròn LÊN nên sai số 1e-11 bị đội thành nguyên
    // 1.000đ cho MỖI đầu người. Giữ phép chia ở dạng số nguyên thì hết.
    const h = heads({ member: 2, memberFemale: 1 });
    const r = computeGroupPlayRates({
      totalPlayCost: 350_000,
      headsByGroup: h,
      policies: { ...DEFAULT_GROUP_POLICIES, memberFemale: pct(80) },
    });

    expect(r.member).toBe(125_000);
    expect(r.memberFemale).toBe(100_000);
    expect(collected(r, h)).toBe(350_000);
  });

  it("55% của 100.000 phải là đúng 55.000, không phải 56.000", () => {
    const h = heads({ member: 1, memberFemale: 1 });
    const r = computeGroupPlayRates({
      // 1 nam + 1 nữ ở 55%: trọng số 1,55 → nam 100.000, nữ 55.000.
      totalPlayCost: 155_000,
      headsByGroup: h,
      policies: { ...DEFAULT_GROUP_POLICIES, memberFemale: pct(55) },
    });

    expect(r.member).toBe(100_000);
    expect(r.memberFemale).toBe(55_000);
  });

  it("nhóm nam hết ăn sàn giữa chừng: nhóm nữ phải vào rổ CÙNG LÚC", () => {
    // Suất chia đều (105.263) đã cao hơn sàn 60K nên sàn thôi tác dụng và
    // khách-admin nam về rổ. Nhóm nữ ăn theo phải về rổ trong cùng vòng đó;
    // nếu nó bị kẹt lại ngoài rổ, nó tính 80% của MỨC SÀN (48.000) còn cả rổ
    // bị tính cao lên 118.000. Cả hai cách đều thu đủ tiền sân nên không có
    // bất biến nào kêu — sai mà không ai biết, đúng loại lỗi cần test riêng.
    const h = heads({ member: 4, guestAdmin: 2, guestAdminFemale: 2 });
    const r = computeGroupPlayRates({
      totalPlayCost: 800_000,
      headsByGroup: h,
      policies: { ...DEFAULT_GROUP_POLICIES, guestAdminFemale: pct(80) },
    });

    expect(r.member).toBe(106_000);
    expect(r.guestAdmin).toBe(106_000);
    expect(r.guestAdminFemale).toBe(85_000);
    expect(collected(r, h)).toBeGreaterThanOrEqual(800_000);
  });

  it("khuyết số phần trăm thì tính như 100% — chọn hướng thu đủ, không ưu đãi ngầm", () => {
    // Bản ghi cũ hoặc một đường ghi setting nào đó bỏ sót field `percent`.
    // Đoán thành 80% là tự làm admin hụt tiền mà không ai báo, nên phải tính
    // đầy suất. Schema cũng chặn lưu trạng thái này; đây là lớp cuối.
    const h = heads({ member: 2, memberFemale: 2 });
    const r = computeGroupPlayRates({
      totalPlayCost: 400_000,
      headsByGroup: h,
      policies: {
        ...DEFAULT_GROUP_POLICIES,
        memberFemale: { mode: "percent", amount: 0, capAtEqual: false },
      },
    });

    expect(r.memberFemale).toBe(100_000);
    expect(r.member).toBe(100_000);
    expect(collected(r, h)).toBe(400_000);
  });

  it("đặt phần trăm cho nhóm KHÔNG phải nữ thì coi như chia đều", () => {
    const h = heads({ member: 4, guestMember: 4 });
    const r = computeGroupPlayRates({
      totalPlayCost: 800_000,
      headsByGroup: h,
      policies: { ...DEFAULT_GROUP_POLICIES, member: pct(50) },
    });

    // `member` không có nhóm nam nào để lấy làm gốc, nên phần trăm vô nghĩa.
    // Chia đều, KHÔNG được âm thầm giảm nửa suất của cả nhóm nam.
    expect(r.member).toBe(100_000);
    expect(r.guestMember).toBe(100_000);
    expect(collected(r, h)).toBe(800_000);
  });
});
