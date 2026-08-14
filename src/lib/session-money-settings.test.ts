import { describe, expect, it } from "vitest";
import {
  resolveSessionSettings,
  serializeSnapshot,
} from "./session-money-settings";
import { defaultSettings } from "./settings-registry";

describe("resolveSessionSettings", () => {
  const global = { ...defaultSettings(), minDeductionAmount: 70_000 };

  it("chưa có snapshot thì dùng setting hiện tại, và báo là cần ghi snapshot", () => {
    const r = resolveSessionSettings({
      global,
      override: null,
      snapshot: null,
    });
    expect(r.settings.minDeductionAmount).toBe(70_000);
    expect(r.fromSnapshot).toBe(false);
  });

  it("có snapshot thì dùng snapshot, KHÔNG dùng setting hiện tại", () => {
    const frozen = serializeSnapshot({
      ...defaultSettings(),
      minDeductionAmount: 60_000,
    });
    const r = resolveSessionSettings({
      global,
      override: null,
      snapshot: frozen,
    });
    // global đang 70K nhưng buổi này đã đóng băng ở 60K
    expect(r.settings.minDeductionAmount).toBe(60_000);
    expect(r.fromSnapshot).toBe(true);
  });

  it("snapshot hỏng thì rơi về setting hiện tại chứ không ném lỗi, và báo chưa có snapshot", () => {
    const r = resolveSessionSettings({
      global,
      override: null,
      snapshot: "{{{",
    });
    expect(r.settings.minDeductionAmount).toBe(70_000);
    expect(r.fromSnapshot).toBe(false);
  });

  it("snapshot thắng cả override của buổi", () => {
    const frozen = serializeSnapshot({
      ...defaultSettings(),
      minDeductionAmount: 50_000,
    });
    const r = resolveSessionSettings({
      global,
      override: JSON.stringify({ minDeductionAmount: 80_000 }),
      snapshot: frozen,
    });
    expect(r.settings.minDeductionAmount).toBe(50_000);
  });

  it("chưa có snapshot thì override của buổi vẫn đè setting chung", () => {
    const r = resolveSessionSettings({
      global,
      override: JSON.stringify({ minDeductionAmount: 80_000 }),
      snapshot: null,
    });
    expect(r.settings.minDeductionAmount).toBe(80_000);
  });

  it("key CÓ MẶT trong snapshot nhưng sai schema → CẢ snapshot hỏng, rơi về setting hiện tại", () => {
    // Mô phỏng registry thắt chặt schema sau khi buổi đã đóng băng (vd thêm
    // field bắt buộc vào groupPolicySchema) khiến 1 key cũ không còn hợp lệ.
    // minDeductionAmount sai kiểu (string thay vì number), genderPricingEnabled
    // vẫn hợp lệ (true) nếu xét riêng — nhưng KHÔNG được áp dụng, vì trộn
    // "genderPricingEnabled mới" với "phần fallback cho các key khác" tạo ra
    // một cấu hình chưa từng tồn tại thật.
    const brokenSnapshot = JSON.stringify({
      minDeductionAmount: "not-a-number",
      genderPricingEnabled: true,
    });
    const r = resolveSessionSettings({
      global, // genderPricingEnabled mặc định false ở đây
      override: null,
      snapshot: brokenSnapshot,
    });
    expect(r.fromSnapshot).toBe(false);
    expect(r.settings.minDeductionAmount).toBe(70_000); // fallback, không phải giá trị hỏng
    // Chứng minh CẢ snapshot bị bỏ, không chỉ riêng key hỏng: nếu chỉ rơi
    // riêng minDeductionAmount thì genderPricingEnabled đáng lẽ vẫn là `true`
    // (áp theo snapshot) — ở đây nó phải quay về fallback (false).
    expect(r.settings.genderPricingEnabled).toBe(false);
  });

  it("key VẮNG MẶT trong snapshot (registry thêm setting mới sau) → không phải hỏng, phần còn lại của snapshot vẫn áp dụng", () => {
    // Snapshot cũ chỉ có genderPricingEnabled, KHÔNG có minDeductionAmount —
    // mô phỏng registry thêm setting tiền mới sau khi buổi này đã chốt.
    const partialSnapshot = JSON.stringify({ genderPricingEnabled: true });
    const r = resolveSessionSettings({
      global, // minDeductionAmount = 70_000, genderPricingEnabled = false
      override: null,
      snapshot: partialSnapshot,
    });
    expect(r.fromSnapshot).toBe(true); // vẫn là snapshot hợp lệ, không hỏng
    expect(r.settings.genderPricingEnabled).toBe(true); // từ snapshot
    expect(r.settings.minDeductionAmount).toBe(70_000); // key vắng mặt → rơi về fallback
  });

  it("key perSession:false trong snapshot (tàn dư định dạng cũ) bị bỏ qua, không áp dụng và không coi là hỏng", () => {
    // Định dạng snapshot TRƯỚC fix-2 lưu toàn bộ AppSettings, gồm cả
    // bankAccountNo — key này perSession:false. Đọc lại snapshot dạng cũ
    // không được áp dụng field đó (và không được coi là snapshot hỏng).
    const oldFormatSnapshot = JSON.stringify({
      minDeductionAmount: 60_000,
      bankAccountNo: "1234567890",
      appName: "Ten khac",
    });
    const r = resolveSessionSettings({
      global,
      override: null,
      snapshot: oldFormatSnapshot,
    });
    expect(r.fromSnapshot).toBe(true);
    expect(r.settings.minDeductionAmount).toBe(60_000); // key perSession áp dụng bình thường
    expect(r.settings.bankAccountNo).toBe(global.bankAccountNo); // bị bỏ qua, không lấy "1234567890"
    expect(r.settings.appName).toBe(global.appName); // bị bỏ qua, không lấy "Ten khac"
  });
});

describe("serializeSnapshot", () => {
  it("chỉ ghi các key perSession:true, KHÔNG ghi thông tin ngân hàng hay các key khác", () => {
    const settings = {
      ...defaultSettings(),
      bankAccountNo: "9999999999",
      bankAccountName: "CLUB CAU LONG",
      appName: "Ten rieng",
    };
    const json = JSON.parse(serializeSnapshot(settings)) as Record<
      string,
      unknown
    >;

    expect(json).toHaveProperty("minDeductionAmount");
    expect(json).toHaveProperty("genderPricingEnabled");
    expect(json).toHaveProperty("groupPolicies");

    // Không rải thông tin tài khoản ngân hàng (hay bất kỳ key non-money nào
    // khác) vào từng buổi đã chốt sổ.
    expect(json).not.toHaveProperty("bankAccountNo");
    expect(json).not.toHaveProperty("bankAccountName");
    expect(json).not.toHaveProperty("appName");
  });
});
