// @vitest-environment jsdom
/**
 * Ba nhóm nữ trên trang Cài đặt chỉ hiện khi công tắc `genderPricingEnabled`
 * bật.
 *
 * Ràng buộc quan trọng nhất KHÔNG phải chuyện ẩn/hiện, mà là: khi ba nhóm nữ
 * đang ẩn, giá trị của chúng vẫn phải được GỬI NGUYÊN VẸN mỗi lần lưu. Schema
 * `groupPolicies` là `.strict()` và đòi đủ sáu nhóm; gửi thiếu thì cả object
 * bị coi là sai và rơi về mặc định, tức là âm thầm xoá cấu hình nhóm nữ mà
 * admin đã đặt trước đó.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { defaultSettings } from "@/lib/settings-registry";
import type { GroupKey, GroupPolicy } from "@/lib/group-policy";

const saved = vi.hoisted(() => ({ groupPolicies: null as unknown }));
vi.mock("@/actions/settings", () => ({
  updateSetting: vi.fn(async (key: string, value: unknown) => {
    if (key === "groupPolicies") saved.groupPolicies = value;
    return { success: true };
  }),
}));

const { SectionMoney } = await import("./section-money");

afterEach(() => {
  cleanup();
  saved.groupPolicies = null;
});

/** Cấu hình nhóm nữ đã đặt sẵn, để xem nó có sống sót qua lần lưu không. */
function settingsWith(genderOn: boolean) {
  const base = defaultSettings();
  const policies: Record<GroupKey, GroupPolicy> = {
    ...base.groupPolicies,
    memberFemale: { mode: "fixed", amount: 42_000, capAtEqual: true },
  };
  return {
    ...base,
    genderPricingEnabled: genderOn,
    groupPolicies: policies,
  };
}

function renderSection(genderOn: boolean) {
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <SectionMoney settings={settingsWith(genderOn)} />
    </NextIntlClientProvider>,
  );
}

/** Đếm số lần một nhãn nhóm xuất hiện. Dùng getAllBy vì khi công tắc bật,
 *  cùng một nhãn hiện ở thẻ nhóm, ở ô nhập xem trước, và ở dòng kết quả xem
 *  trước — nhiều hơn một là bình thường, 0 mới là "đang ẩn". */
const countText = (label: string) => screen.queryAllByText(label).length;

describe("ba nhóm nữ trên trang Cài đặt", () => {
  it("công tắc TẮT: không có dòng nhóm nữ nào trong DOM", () => {
    renderSection(false);
    expect(countText("Thành viên nữ")).toBe(0);
    expect(countText("Khách nữ của thành viên")).toBe(0);
    expect(countText("Khách nữ của admin")).toBe(0);
    // Ba nhóm thường vẫn còn nguyên.
    expect(screen.getAllByText("Thành viên").length).toBeGreaterThan(0);
  });

  it("công tắc BẬT: ba dòng nhóm nữ hiện ra", () => {
    renderSection(true);
    expect(countText("Thành viên nữ")).toBeGreaterThan(0);
    expect(countText("Khách nữ của thành viên")).toBeGreaterThan(0);
    expect(countText("Khách nữ của admin")).toBeGreaterThan(0);
  });

  it("đang ẩn nhóm nữ mà sửa một nhóm thường: giá trị nhóm nữ vẫn được gửi nguyên", async () => {
    renderSection(false);

    // Đổi cách tính của nhóm "Thành viên" → kích hoạt một lần lưu.
    fireEvent.click(
      screen.getByRole("button", { name: "Cách tính: Thành viên" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cố định" }));

    await vi.waitFor(() => expect(saved.groupPolicies).not.toBeNull());
    const sent = saved.groupPolicies as Record<GroupKey, GroupPolicy>;

    // Đủ sáu nhóm — thiếu một nhóm là `.strict()` đánh hỏng cả object.
    expect(Object.keys(sent).sort()).toEqual(
      [
        "guestAdmin",
        "guestAdminFemale",
        "guestMember",
        "guestMemberFemale",
        "member",
        "memberFemale",
      ].sort(),
    );
    // Và cấu hình nhóm nữ đã đặt trước đó KHÔNG bị nuốt mất.
    expect(sent.memberFemale).toEqual({
      mode: "fixed",
      amount: 42_000,
      capAtEqual: true,
    });
  });
});
