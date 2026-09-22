/**
 * Field `percent` mới thêm vào `groupPolicies` (22/9/2026) và hai rủi ro của nó.
 *
 * Rủi ro lớn nhất KHÔNG phải chuyện validate sai, mà là buổi đã chốt sổ. Mỗi
 * buổi giữ một bản chụp cấu hình trong `sessions.settings_snapshot`; bản chụp
 * cũ không có field này. `parseSnapshot` coi "có mặt nhưng sai schema" là hỏng
 * CẢ bản chụp rồi rơi về cấu hình hiện tại, nên nếu field mới là bắt buộc thì
 * mọi buổi lịch sử bị tính lại theo cấu hình hôm nay. Bài đầu khoá đúng chỗ đó.
 */
import { describe, expect, it } from "vitest";
import { SETTINGS, defaultSettings } from "./settings-registry";
import {
  resolveSessionSettings,
  serializeSnapshot,
} from "./session-money-settings";

const schema = SETTINGS.groupPolicies.schema;

/** Bản chụp kiểu CŨ: đúng sáu nhóm, không nhóm nào có `percent`. */
const OLD_SNAPSHOT = JSON.stringify({
  groupPolicies: {
    member: { mode: "equal", amount: 0, capAtEqual: false },
    memberFemale: { mode: "equal", amount: 0, capAtEqual: false },
    guestMember: { mode: "equal", amount: 0, capAtEqual: false },
    guestMemberFemale: { mode: "equal", amount: 0, capAtEqual: false },
    guestAdmin: { mode: "floor", amount: 60_000, capAtEqual: false },
    guestAdminFemale: { mode: "floor", amount: 60_000, capAtEqual: false },
  },
  minDeductionAmount: 60_000,
});

describe("percent trong schema groupPolicies", () => {
  it("bản chụp CŨ (không có percent) vẫn đọc được, buổi lịch sử không bị tính lại", () => {
    const global = defaultSettings();
    const r = resolveSessionSettings({
      global,
      override: null,
      snapshot: OLD_SNAPSHOT,
    });

    expect(r.fromSnapshot).toBe(true);
    expect(r.settings.groupPolicies.guestAdmin.amount).toBe(60_000);
    expect(r.settings.groupPolicies.guestAdmin.mode).toBe("floor");
  });

  it("bản chụp mới ghi kèm percent và đọc lại đúng nguyên giá trị", () => {
    const s = defaultSettings();
    s.groupPolicies = {
      ...s.groupPolicies,
      memberFemale: {
        mode: "percent",
        amount: 0,
        capAtEqual: false,
        percent: 75,
      },
    };

    const r = resolveSessionSettings({
      global: defaultSettings(),
      override: null,
      snapshot: serializeSnapshot(s),
    });

    expect(r.settings.groupPolicies.memberFemale.mode).toBe("percent");
    expect(r.settings.groupPolicies.memberFemale.percent).toBe(75);
  });

  it("chặn phần trăm ở nhóm KHÔNG phải nữ, báo đúng nhóm nào sai", () => {
    const bad = {
      ...defaultSettings().groupPolicies,
      member: { mode: "percent", amount: 0, capAtEqual: false, percent: 50 },
    };

    const r = schema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) {
      // `some` chứ không phải `issues[0]`: schema có nhiều nhánh kiểm, khẳng
      // định theo vị trí là phụ thuộc thứ tự viết các nhánh đó.
      expect(
        r.error.issues.some(
          (i) =>
            i.path.join(".") === "member.mode" && i.message.includes("nhóm nữ"),
        ),
      ).toBe(true);
    }
  });

  it("nhóm nữ dùng phần trăm thì hợp lệ", () => {
    const ok = {
      ...defaultSettings().groupPolicies,
      guestAdminFemale: {
        mode: "percent",
        amount: 0,
        capAtEqual: false,
        percent: 80,
      },
    };
    expect(schema.safeParse(ok).success).toBe(true);
  });

  it("chọn cách tính phần trăm mà THIẾU số phần trăm thì bị chặn", () => {
    const bad = {
      ...defaultSettings().groupPolicies,
      memberFemale: { mode: "percent", amount: 0, capAtEqual: false },
    };

    const r = schema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) => i.path.join(".") === "memberFemale.percent"),
      ).toBe(true);
    }
  });

  it("phần trăm ngoài khoảng 0–100 bị chặn", () => {
    for (const percent of [-1, 101, 1000]) {
      const bad = {
        ...defaultSettings().groupPolicies,
        memberFemale: {
          mode: "percent",
          amount: 0,
          capAtEqual: false,
          percent,
        },
      };
      expect(schema.safeParse(bad).success, `percent=${percent}`).toBe(false);
    }
  });

  it("phần trăm phải là số nguyên — 80,5% không lưu được", () => {
    const bad = {
      ...defaultSettings().groupPolicies,
      memberFemale: {
        mode: "percent",
        amount: 0,
        capAtEqual: false,
        percent: 80.5,
      },
    };
    expect(schema.safeParse(bad).success).toBe(false);
  });
});
