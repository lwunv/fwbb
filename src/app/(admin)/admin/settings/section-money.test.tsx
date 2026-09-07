// @vitest-environment jsdom
/**
 * Bug đã fix: `updateRow` bắn một `updateSetting("groupPolicies", ...)`
 * không xếp hàng cho MỖI lần đổi 1 dòng. Thao tác bình thường "đổi cách tính
 * sang Cố định (lộ ô số tiền) rồi gõ số tiền ngay sau" là hai lần ghi cả
 * object groupPolicies liên tiếp. `updateSetting` là upsert last-write-wins,
 * không version check, nên nếu request 1 (đổi mode) về CHẬM hơn request 2
 * (đổi số tiền), nó đè lên bằng snapshot cũ hơn — mất đúng lần sửa mới nhất,
 * và `.strict()` không bắt được vì cả hai payload đều hợp lệ.
 *
 * Test này giả lập đúng kịch bản đó bằng cách khoá lần ghi ĐẦU (chỉ tự nhả
 * khi test gọi resolveFirstWrite()) trong khi lần ghi SAU vẫn resolve ngay.
 * Không có `enqueueWrite` xếp hàng, `savedGroupPolicies` cuối cùng sẽ bị lần
 * ghi đầu (đến muộn) đè về giá trị CŨ — test đỏ. Có hàng đợi, lần ghi thứ
 * hai chỉ thật sự bắn đi SAU khi lần đầu định đoạt xong, nên `savedGroupPolicies`
 * cuối cùng phản ánh đúng lần sửa mới nhất — test xanh.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { defaultSettings } from "@/lib/settings-registry";

const state = vi.hoisted(() => ({
  groupPolicyCalls: 0,
  savedGroupPolicies: null as unknown,
  resolveFirstWrite: null as (() => void) | null,
}));

const settingsActions = vi.hoisted(() => ({
  updateSetting: vi.fn(async (key: string, value: unknown) => {
    if (key !== "groupPolicies") return { success: true };
    state.groupPolicyCalls += 1;
    if (state.groupPolicyCalls === 1) {
      // Lần ghi đầu (đổi mode) bị giữ lại — chỉ "về tới server" khi test chủ
      // động nhả, mô phỏng round-trip chậm hơn lần ghi thứ hai.
      await new Promise<void>((resolve) => {
        state.resolveFirstWrite = resolve;
      });
    }
    state.savedGroupPolicies = value;
    return { success: true };
  }),
}));
vi.mock("@/actions/settings", () => settingsActions);

const { SectionMoney } = await import("./section-money");

afterEach(() => {
  cleanup();
  settingsActions.updateSetting.mockClear();
  state.groupPolicyCalls = 0;
  state.savedGroupPolicies = null;
  state.resolveFirstWrite = null;
});

function renderSection() {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <SectionMoney settings={defaultSettings()} />
    </NextIntlClientProvider>,
  );
}

describe("SectionMoney — ghi groupPolicies không được mất bản sửa mới nhất", () => {
  it("đổi mode rồi gõ số tiền ngay sau → giá trị cuối phải là số tiền mới, kể cả khi lần ghi đầu về chậm", async () => {
    renderSection();

    // Nhóm "member" mặc định mode=equal (ô số tiền đang ẩn). Đổi sang "Cố
    // định" để lộ ô số tiền — đây là lần ghi #1 (bị giữ lại trong mock).
    fireEvent.click(
      screen.getByRole("button", { name: "Cách tính: Thành viên" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cố định" }));

    await waitFor(() =>
      expect(settingsActions.updateSetting).toHaveBeenCalledTimes(1),
    );

    // Ô số tiền giờ đã lộ ra — gõ số tiền mới rồi blur. Đây là lần ghi #2.
    const amountInput = screen.getByLabelText(/Số tiền: Thành viên/);
    fireEvent.change(amountInput, { target: { value: "50000" } });
    fireEvent.blur(amountInput);

    // Nhả lần ghi #1 — mô phỏng round-trip chậm của nó về đích SAU khi lần
    // ghi #2 (nếu không xếp hàng) đã lẽ ra chạy xong.
    state.resolveFirstWrite?.();

    // Xả hết microtask đang chờ bằng một macrotask thật (setTimeout 0), CHỨ
    // KHÔNG dùng `waitFor` ở bước này: `waitFor` kiểm tra đồng bộ NGAY lần
    // gọi đầu, và ngay lúc này `savedGroupPolicies` vẫn còn đang là giá trị
    // ĐÚNG của lần ghi #2 (gán đồng bộ lúc blur, phía trên) — continuation
    // của lần ghi #1 vừa nhả chưa kịp chạy. Nếu check bằng `waitFor` ở đây,
    // test sẽ xanh giả (pass ngay từ lần kiểm đầu) bất kể có fix hay không,
    // vì không hề đợi phần đè-giá-trị-cũ (nếu có) kịp xảy ra. `setTimeout(0)`
    // đảm bảo toàn bộ hàng đợi microtask (gồm continuation của lần ghi #1)
    // đã chạy xong trước khi ta đọc giá trị cuối.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const saved = state.savedGroupPolicies as {
      member: { mode: string; amount: number; capAtEqual: boolean };
    } | null;
    expect(saved?.member.amount).toBe(50000);
    expect(saved?.member.mode).toBe("fixed");
  });
});
