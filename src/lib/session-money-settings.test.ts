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
});
