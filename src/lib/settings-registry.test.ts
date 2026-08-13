import { describe, expect, it } from "vitest";
import {
  SETTINGS,
  defaultSettings,
  isPerSession,
  type SettingKey,
} from "./settings-registry";
import { DEFAULT_GROUP_POLICIES } from "./group-policy";

const EQUAL_FIXTURE = { mode: "equal", amount: 0, capAtEqual: false };

describe("defaultSettings", () => {
  it("khớp hành vi đang chạy hôm nay", () => {
    const d = defaultSettings();
    expect(d.lowFundThreshold).toBe(100_000);
    expect(d.voteBlockDebtThreshold).toBe(100_000);
    expect(d.lowStockThresholdQua).toBe(12);
    expect(d.voteDeadlineOffsetHours).toBe(4);
    expect(d.defaultStartTime).toBe("20:30");
    expect(d.defaultEndTime).toBe("22:30");
    expect(d.defaultCourtQuantity).toBe(1);
    expect(d.defaultMaxPlayers).toBe(16);
    expect(d.maxPlayersOptions).toEqual([8, 12, 16, 20]);
    expect(d.sessionDaysOfWeek).toEqual([1, 3, 5]);
    expect(d.appName).toBe("FWBB");
    expect(d.autoCreateSessions).toBe(true);
    expect(d.bankBin).toBe("970454");
    expect(d.bankAccountNo).toBe("");
    expect(d.bankAccountName).toBe("");
  });
});

describe("SETTINGS", () => {
  it("mỗi entry có key trùng với tên thuộc tính", () => {
    for (const [name, def] of Object.entries(SETTINGS)) {
      expect(def.key).toBe(name);
    }
  });

  it("default của mỗi entry tự nó parse được qua schema của nó", () => {
    for (const def of Object.values(SETTINGS)) {
      expect(() => def.schema.parse(def.default)).not.toThrow();
    }
  });

  it("giữ nguyên tên key cũ đã có dữ liệu trong app_settings", () => {
    const keys = Object.keys(SETTINGS);
    expect(keys).toContain("appName");
    expect(keys).toContain("defaultCourtId");
    expect(keys).toContain("defaultBrandId");
    expect(keys).toContain("sessionDaysOfWeek");
  });
});

describe("isPerSession", () => {
  it("ngưỡng dùng chung thì không override theo buổi", () => {
    expect(isPerSession("lowFundThreshold" as SettingKey)).toBe(false);
    expect(isPerSession("appName" as SettingKey)).toBe(false);
  });
});

describe("schema chặn giá trị vô lý", () => {
  it("giờ phải đúng dạng HH:MM", () => {
    expect(() => SETTINGS.defaultStartTime.schema.parse("25:00")).toThrow();
    expect(() => SETTINGS.defaultStartTime.schema.parse("8h30")).toThrow();
  });
  it("ngưỡng tiền không âm và là số nguyên", () => {
    expect(() => SETTINGS.lowFundThreshold.schema.parse(-1)).toThrow();
    expect(() => SETTINGS.lowFundThreshold.schema.parse(1.5)).toThrow();
  });
  it("danh sách mức tối đa phải có ít nhất một mức", () => {
    expect(() => SETTINGS.maxPlayersOptions.schema.parse([])).toThrow();
  });
  it("ngày trong tuần phải nằm trong 0..6 và không rỗng", () => {
    expect(() => SETTINGS.sessionDaysOfWeek.schema.parse([7])).toThrow();
    expect(() => SETTINGS.sessionDaysOfWeek.schema.parse([])).toThrow();
  });

  it("bankBin chỉ nhận BIN có trong VN_BANKS, không cho BIN tự do", () => {
    expect(() => SETTINGS.bankBin.schema.parse("970454")).not.toThrow();
    expect(() => SETTINGS.bankBin.schema.parse("999999")).toThrow();
    expect(() => SETTINGS.bankBin.schema.parse("")).toThrow();
  });

  it("bankAccountNo nhận rỗng (chưa cấu hình), chặn chữ cái và dấu cách", () => {
    expect(() => SETTINGS.bankAccountNo.schema.parse("")).not.toThrow();
    expect(() =>
      SETTINGS.bankAccountNo.schema.parse("1234567890"),
    ).not.toThrow();
    expect(() => SETTINGS.bankAccountNo.schema.parse("123ABC7890")).toThrow();
    expect(() => SETTINGS.bankAccountNo.schema.parse("1234 5678")).toThrow();
    expect(() => SETTINGS.bankAccountNo.schema.parse("12345")).toThrow(); // < 6 số
    expect(() => SETTINGS.bankAccountNo.schema.parse("1".repeat(21))).toThrow(); // > 20 số
  });

  it("bankAccountName nhận rỗng, chặn quá 100 ký tự", () => {
    expect(() => SETTINGS.bankAccountName.schema.parse("")).not.toThrow();
    expect(() =>
      SETTINGS.bankAccountName.schema.parse("NGUYEN VAN A"),
    ).not.toThrow();
    expect(() =>
      SETTINGS.bankAccountName.schema.parse("A".repeat(101)),
    ).toThrow();
  });
});

describe("setting tiền (giai đoạn 3)", () => {
  it("mặc định giữ đúng hành vi hôm nay", () => {
    const d = defaultSettings();
    expect(d.minDeductionAmount).toBe(60_000);
    expect(d.genderPricingEnabled).toBe(false);
    expect(d.groupPolicies.guestAdmin).toEqual({
      mode: "floor",
      amount: 60_000,
      capAtEqual: false,
    });
    expect(d.groupPolicies.member.mode).toBe("equal");
  });

  it("ba setting tiền đều override được theo từng buổi", () => {
    expect(isPerSession("minDeductionAmount")).toBe(true);
    expect(isPerSession("genderPricingEnabled")).toBe(true);
    expect(isPerSession("groupPolicies")).toBe(true);
  });

  it("chặn chế độ lạ và số tiền âm", () => {
    expect(() =>
      SETTINGS.groupPolicies.schema.parse({
        ...DEFAULT_GROUP_POLICIES,
        member: { mode: "khong-ton-tai", amount: 0, capAtEqual: false },
      }),
    ).toThrow();
    expect(() => SETTINGS.minDeductionAmount.schema.parse(-1)).toThrow();
    expect(() => SETTINGS.minDeductionAmount.schema.parse(1.5)).toThrow();
  });

  it("thiếu nhóm trong bảng thì bị chặn, không âm thầm điền khuyết", () => {
    expect(() =>
      SETTINGS.groupPolicies.schema.parse({ member: EQUAL_FIXTURE }),
    ).toThrow();
  });

  it("dư key lạ trong groupPolicies bị chặn, không âm thầm bỏ qua", () => {
    expect(() =>
      SETTINGS.groupPolicies.schema.parse({
        ...DEFAULT_GROUP_POLICIES,
        khongTonTai: EQUAL_FIXTURE,
      }),
    ).toThrow();
  });

  it("dư key lạ trong một nhóm bị chặn", () => {
    expect(() =>
      SETTINGS.groupPolicies.schema.parse({
        ...DEFAULT_GROUP_POLICIES,
        member: { ...EQUAL_FIXTURE, extra: 1 },
      }),
    ).toThrow();
  });
});
