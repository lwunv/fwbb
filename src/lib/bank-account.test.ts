import { describe, expect, it } from "vitest";
import { resolveBankAccount } from "./bank-account";
import { getVietQRUrl } from "./vietqr";
import { defaultSettings } from "./settings-registry";

describe("resolveBankAccount", () => {
  it("setting đầy đủ thì thắng env", () => {
    const settings = {
      bankBin: "970436",
      bankAccountNo: "111222",
      bankAccountName: "NGUYEN VAN A",
    };
    const r = resolveBankAccount(settings, {
      accountNo: "999888",
      accountName: "ENV NAME",
    });
    expect(r).toEqual({
      bankBin: "970436",
      accountNo: "111222",
      accountName: "NGUYEN VAN A",
    });
  });

  it("setting rỗng thì lùi về env", () => {
    const settings = {
      bankBin: "970454",
      bankAccountNo: "",
      bankAccountName: "",
    };
    const r = resolveBankAccount(settings, {
      accountNo: "999888",
      accountName: "ENV NAME",
    });
    expect(r.accountNo).toBe("999888");
    expect(r.accountName).toBe("ENV NAME");
  });

  it("cả setting và env đều rỗng thì ra chuỗi rỗng, không throw", () => {
    const settings = {
      bankBin: "970454",
      bankAccountNo: "",
      bankAccountName: "",
    };
    const r = resolveBankAccount(settings, { accountNo: "", accountName: "" });
    expect(r.accountNo).toBe("");
    expect(r.accountName).toBe("");
  });

  it("bankBin luôn lấy từ setting, không lùi về env (đã có default '970454')", () => {
    const settings = {
      bankBin: "970436",
      bankAccountNo: "111222",
      bankAccountName: "A",
    };
    const r = resolveBankAccount(settings, { accountNo: "", accountName: "" });
    expect(r.bankBin).toBe("970436");
  });

  it("giữ đúng hành vi hôm nay: settings mặc định (chưa ai cấu hình) + env trống → account rỗng như hiện tại", () => {
    // Mô phỏng prod hôm nay: admin chưa nhập setting nào, và .env cũng chưa có
    // NEXT_PUBLIC_TIMO_ACCOUNT_NO/NAME (giống code cũ default về "").
    const r = resolveBankAccount(defaultSettings(), {
      accountNo: "",
      accountName: "",
    });
    expect(r).toEqual({ bankBin: "970454", accountNo: "", accountName: "" });
  });
});

describe("resolveBankAccount + getVietQRUrl: URL đổi theo setting", () => {
  it("cùng số tiền/nội dung, hai bộ setting khác nhau cho ra hai URL khác nhau chứa đúng BIN + số tài khoản", () => {
    const env = { accountNo: "", accountName: "" };

    const settingsA = {
      bankBin: "970454",
      bankAccountNo: "1111111111",
      bankAccountName: "NGUYEN VAN A",
    };
    const settingsB = {
      bankBin: "970436",
      bankAccountNo: "2222222222",
      bankAccountName: "TRAN THI B",
    };

    const urlA = getVietQRUrl({
      ...resolveBankAccount(settingsA, env),
      amount: 150_000,
      memo: "FWBB THANG 8",
    });
    const urlB = getVietQRUrl({
      ...resolveBankAccount(settingsB, env),
      amount: 150_000,
      memo: "FWBB THANG 8",
    });

    expect(urlA).not.toBe(urlB);
    expect(urlA).toContain("970454-1111111111-");
    expect(urlB).toContain("970436-2222222222-");
  });
});
