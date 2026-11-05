import { describe, it, expect } from "vitest";
import { eventFormSchema, resolveEventTimes } from "./event-schema";

const base = {
  venueId: 1,
  date: "2026-11-20",
  startTime: "20:30",
  endTime: "22:30",
  title: "Giao lưu tối thứ sáu",
  description: "",
  slotsTotal: 12,
  femaleReservedSlots: 0,
  reserveRelease: "never",
  hostHeads: 1,
  shuttleType: "",
  feeMode: "fixed",
  feeAmountMale: 50000,
  depositAmount: 0,
  hostContact: "0912345678",
  zaloGroupLink: "",
  turnstileToken: "tok",
  idempotencyKey: "0b0f6d8e-9a3c-4c8e-8a49-1c2f3a4b5c6d",
} as const;

const ok = (v: unknown) => eventFormSchema.safeParse(v).success;

describe("schema", () => {
  it("accepts a valid fixed-fee form and applies defaults", () => {
    const r = eventFormSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.registerDeadlineHours).toBe(2);
      expect(r.data.cancelDeadlineHours).toBe(12);
      expect(r.data.autoApprove).toBe(false);
      expect(r.data.allowPlusOnes).toBe(false);
    }
  });

  it("fixed needs its amount", () => {
    expect(ok({ ...base, feeAmountMale: undefined })).toBe(false);
  });

  it("schema: fixed_gender needs both amounts; split needs total cost and minHeads", () => {
    const fg = { ...base, feeMode: "fixed_gender" };
    expect(ok(fg)).toBe(false);
    expect(ok({ ...fg, feeAmountFemale: 30000 })).toBe(true);

    const sp = { ...base, feeMode: "split_equal" };
    expect(ok(sp)).toBe(false);
    expect(ok({ ...sp, estimatedTotalCost: 600000 })).toBe(false);
    expect(ok({ ...sp, estimatedTotalCost: 600000, minHeads: 8 })).toBe(true);
    expect(ok({ ...sp, estimatedTotalCost: 999, minHeads: 8 })).toBe(false);
    expect(ok({ ...sp, estimatedTotalCost: 600000, minHeads: 13 })).toBe(false);
  });

  it("split_female_discount needs a female percent or amount", () => {
    const s = {
      ...base,
      feeMode: "split_female_discount",
      estimatedTotalCost: 600000,
      minHeads: 8,
    };
    expect(ok(s)).toBe(false);
    expect(ok({ ...s, feeFemalePercent: 50 })).toBe(true);
    expect(ok({ ...s, feeAmountFemale: 20000 })).toBe(true);
    expect(ok({ ...s, feeFemalePercent: 101 })).toBe(false);
  });

  it("money must be integer VND within limits", () => {
    expect(ok({ ...base, feeAmountMale: 50000.5 })).toBe(false);
    expect(ok({ ...base, feeAmountMale: 2_000_001 })).toBe(false);
    expect(ok({ ...base, depositAmount: -1 })).toBe(false);
  });

  it("schema: payout all three or none", () => {
    const p = { payoutBankBin: "970436" };
    const full = {
      ...p,
      payoutAccountNo: "0123456789",
      payoutAccountName: "NGUYEN VAN A",
    };
    expect(ok({ ...base, ...p })).toBe(false);
    expect(ok({ ...base, ...full })).toBe(true);
    expect(ok({ ...base, ...full, payoutAccountNo: "12" })).toBe(false);
    expect(ok({ ...base, ...full, payoutBankBin: "000000" })).toBe(false);
    expect(ok({ ...base, ...full, payoutAccountName: "Nguyễn Văn A" })).toBe(
      false,
    );
  });

  it("schema: skillMin above skillMax rejected", () => {
    expect(ok({ ...base, skillMin: "tb", skillMax: "yeu" })).toBe(false);
    expect(ok({ ...base, skillMin: "yeu", skillMax: "tb" })).toBe(true);
  });

  it("endTime must be after startTime; reserved slots within slotsTotal", () => {
    expect(ok({ ...base, endTime: "20:30" })).toBe(false);
    expect(ok({ ...base, femaleReservedSlots: 13 })).toBe(false);
  });

  it("hostContact is a VN phone or a zalo.me link; group link is zalo.me/g", () => {
    expect(ok({ ...base, hostContact: "hello" })).toBe(false);
    expect(ok({ ...base, hostContact: "https://zalo.me/0912345678" })).toBe(
      true,
    );
    expect(ok({ ...base, hostContact: "123" })).toBe(false);
    expect(ok({ ...base, zaloGroupLink: "https://evil.example/g/x" })).toBe(
      false,
    );
    expect(ok({ ...base, zaloGroupLink: "https://zalo.me/g/abcdef" })).toBe(
      true,
    );
  });
});

describe("host contact and date (R15, R17)", () => {
  it("hostContact may be empty or omitted", () => {
    expect(ok({ ...base, hostContact: "" })).toBe(true);
    expect(ok({ ...base, hostContact: "   " })).toBe(true);
    const { hostContact: _omit, ...rest } = base;
    void _omit;
    expect(ok(rest)).toBe(true);
  });

  it("rejects impossible dates, accepts real leap day", () => {
    expect(ok({ ...base, date: "2026-02-31" })).toBe(false);
    expect(ok({ ...base, date: "2026-13-01" })).toBe(false);
    expect(ok({ ...base, date: "2028-02-29" })).toBe(true);
  });
});

describe("resolveEventTimes", () => {
  const now = new Date("2026-11-05T00:00:00.000Z");
  const input = {
    date: "2026-11-20",
    startTime: "20:30",
    endTime: "22:30",
    registerDeadlineHours: 2,
    cancelDeadlineHours: 12,
    reserveRelease: "never" as const,
    femaleReservedSlots: 0,
  };

  it("resolveEventTimes: 20:30 on 2026-11-20 is 13:30Z under TZ=UTC", () => {
    const r = resolveEventTimes(input, now);
    if ("error" in r) throw new Error(r.error);
    expect(r.startAt).toBe("2026-11-20T13:30:00.000Z");
    expect(r.endAt).toBe("2026-11-20T15:30:00.000Z");
    expect(r.registerDeadline).toBe("2026-11-20T11:30:00.000Z");
    expect(r.cancelDeadline).toBe("2026-11-20T01:30:00.000Z");
    expect(r.reserveReleaseAt).toBeNull();
  });

  it("rejects a start under 30 minutes or over 60 days away", () => {
    const soon = resolveEventTimes(
      { ...input, date: "2026-11-05", startTime: "07:20", endTime: "09:00" },
      now,
    );
    expect(soon).toEqual({ error: "startTooSoon" });
    const far = resolveEventTimes({ ...input, date: "2027-02-01" }, now);
    expect(far).toEqual({ error: "startTooFar" });
  });

  it("deadlines never fall before now + 5 minutes", () => {
    const r = resolveEventTimes(
      {
        ...input,
        date: "2026-11-05",
        startTime: "08:00",
        endTime: "10:00",
        registerDeadlineHours: 72,
        cancelDeadlineHours: 72,
      },
      now,
    );
    if ("error" in r) throw new Error(r.error);
    expect(r.registerDeadline).toBe("2026-11-05T00:05:00.000Z");
    expect(r.cancelDeadline).toBe("2026-11-05T00:05:00.000Z");
  });

  it("reserveRelease maps to an instant only when female slots are reserved", () => {
    const withRes = { ...input, femaleReservedSlots: 2 };
    const h24 = resolveEventTimes({ ...withRes, reserveRelease: "h24" }, now);
    const h6 = resolveEventTimes({ ...withRes, reserveRelease: "h6" }, now);
    const dl = resolveEventTimes(
      { ...withRes, reserveRelease: "deadline" },
      now,
    );
    if ("error" in h24 || "error" in h6 || "error" in dl) throw new Error("x");
    expect(h24.reserveReleaseAt).toBe("2026-11-19T13:30:00.000Z");
    expect(h6.reserveReleaseAt).toBe("2026-11-20T07:30:00.000Z");
    expect(dl.reserveReleaseAt).toBe(dl.registerDeadline);
    const none = resolveEventTimes({ ...input, reserveRelease: "h24" }, now);
    if ("error" in none) throw new Error("x");
    expect(none.reserveReleaseAt).toBeNull();
  });
});
