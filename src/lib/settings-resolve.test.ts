import { describe, expect, it } from "vitest";
import {
  resolveGlobal,
  resolveForSession,
  serializeSetting,
} from "./settings-resolve";
import { defaultSettings } from "./settings-registry";
import { DEFAULT_GROUP_POLICIES } from "./group-policy";

describe("resolveGlobal", () => {
  it("bảng rỗng thì trả về đúng bộ default", () => {
    expect(resolveGlobal([])).toEqual(defaultSettings());
  });

  it("đọc được giá trị đã lưu", () => {
    const s = resolveGlobal([
      { key: "lowFundThreshold", value: "150000" },
      { key: "appName", value: "Cầu lông FWBB" },
      { key: "sessionDaysOfWeek", value: "[2,4,6]" },
    ]);
    expect(s.lowFundThreshold).toBe(150_000);
    expect(s.appName).toBe("Cầu lông FWBB");
    expect(s.sessionDaysOfWeek).toEqual([2, 4, 6]);
  });

  it("giá trị hỏng thì rơi về default, không ném lỗi", () => {
    const s = resolveGlobal([
      { key: "lowFundThreshold", value: "không phải số" },
      { key: "defaultStartTime", value: "25:99" },
    ]);
    expect(s.lowFundThreshold).toBe(100_000);
    expect(s.defaultStartTime).toBe("20:30");
  });

  it("bỏ qua key lạ không có trong registry", () => {
    expect(() => resolveGlobal([{ key: "keyLa", value: "1" }])).not.toThrow();
  });

  it("đọc được định dạng cũ của sessionDaysOfWeek dạng 1,3,5", () => {
    const s = resolveGlobal([{ key: "sessionDaysOfWeek", value: "1,3,5" }]);
    expect(s.sessionDaysOfWeek).toEqual([1, 3, 5]);
  });

  it("đọc được định dạng cũ của defaultCourtId dạng số trần", () => {
    const s = resolveGlobal([{ key: "defaultCourtId", value: "7" }]);
    expect(s.defaultCourtId).toBe(7);
  });

  // parseRaw thử JSON.parse trước: JSON.parse("FWBB") ném lỗi (không phải
  // token JSON hợp lệ) nên rơi về nhánh legacy, và vì "FWBB" không phải số
  // nên trả nguyên chuỗi. Test riêng case này vì đây đúng là chỗ dễ viết sai
  // thứ tự parse (số trần vs chuỗi trần) trong parseRaw.
  it("đọc được định dạng cũ của appName dạng chuỗi trần không dấu, không bị parse nhầm thành số", () => {
    const s = resolveGlobal([{ key: "appName", value: "FWBB" }]);
    expect(s.appName).toBe("FWBB");
  });
});

describe("resolveForSession", () => {
  const global = { ...defaultSettings(), lowFundThreshold: 150_000 };

  it("không có override thì y hệt setting chung", () => {
    expect(resolveForSession(global, null)).toEqual(global);
  });

  it("JSON hỏng thì rơi về setting chung", () => {
    expect(resolveForSession(global, "{{{")).toEqual(global);
  });

  it("JSON không phải object thì rơi về setting chung", () => {
    expect(resolveForSession(global, "42")).toEqual(global);
  });

  it("bỏ qua ô không cho override theo buổi", () => {
    // Giai đoạn 1 mọi setting đều perSession: false, nên override phải bị lờ đi
    // hoàn toàn. Giai đoạn 3 thêm chính sách chia tiền mới có ô đè được.
    const r = resolveForSession(global, JSON.stringify({ appName: "Buổi lẻ" }));
    expect(r.appName).toBe(global.appName);
  });

  it("bỏ qua key lạ không có trong registry", () => {
    expect(resolveForSession(global, JSON.stringify({ keyLa: 1 }))).toEqual(
      global,
    );
  });

  it("override minDeductionAmount theo buổi thì được áp dụng", () => {
    const r = resolveForSession(
      global,
      JSON.stringify({ minDeductionAmount: 80_000 }),
    );
    expect(r.minDeductionAmount).toBe(80_000);
  });

  it("override groupPolicies theo buổi thì được áp dụng", () => {
    const overridePolicies = {
      ...DEFAULT_GROUP_POLICIES,
      member: { mode: "fixed" as const, amount: 50_000, capAtEqual: true },
    };
    const r = resolveForSession(
      global,
      JSON.stringify({ groupPolicies: overridePolicies }),
    );
    expect(r.groupPolicies).toEqual(overridePolicies);
  });

  it("override minDeductionAmount hỏng (âm) thì rơi về setting chung", () => {
    const r = resolveForSession(
      global,
      JSON.stringify({ minDeductionAmount: -1 }),
    );
    expect(r.minDeductionAmount).toBe(global.minDeductionAmount);
  });

  it("override groupPolicies hỏng (thiếu nhóm) thì rơi về setting chung, không âm thầm điền khuyết bằng default", () => {
    // member cố ý khác default (equal) để lộ ra nếu code âm thầm chấp nhận
    // phần member này rồi tự điền 5 nhóm còn thiếu bằng default — nếu vậy
    // r.groupPolicies.member sẽ là 99_000/fixed thay vì bị rơi về global.
    const r = resolveForSession(
      global,
      JSON.stringify({
        groupPolicies: {
          member: { mode: "fixed", amount: 99_000, capAtEqual: false },
        },
      }),
    );
    expect(r.groupPolicies).toEqual(global.groupPolicies);
  });
});

describe("serializeSetting", () => {
  it("số và chuỗi lưu thành JSON đọc lại được", () => {
    expect(
      resolveGlobal([
        {
          key: "lowFundThreshold",
          value: serializeSetting("lowFundThreshold", 200_000),
        },
      ]).lowFundThreshold,
    ).toBe(200_000);
  });

  it("mảng lưu thành JSON đọc lại được", () => {
    expect(
      resolveGlobal([
        {
          key: "maxPlayersOptions",
          value: serializeSetting("maxPlayersOptions", [8, 16]),
        },
      ]).maxPlayersOptions,
    ).toEqual([8, 16]);
  });
});
