import { describe, it, expect } from "vitest";
import { buildAdminDebtAlertEmail } from "./mailer";

describe("buildAdminDebtAlertEmail", () => {
  const mail = buildAdminDebtAlertEmail({
    memberName: "Nguyen <script>alert(1)</script> Thanh",
    balanceBefore: 20_000,
    balanceAfter: -188_000,
    description: "Chốt sổ buổi 2026-11-02 & <b>x</b>",
    link: "https://lwcifer.io.vn/admin/fund/transactions?q=Nguyen%20Thanh",
  });

  it("tiêu đề nêu tên member vừa âm quỹ", () => {
    expect(mail.subject).toContain("vừa âm quỹ");
    expect(mail.subject).toContain("Nguyen");
  });

  it("có số dư trước và sau (định dạng VND) + link sổ quỹ", () => {
    expect(mail.text).toContain("-188.000");
    expect(mail.text).toContain("20.000");
    expect(mail.text).toContain(
      "https://lwcifer.io.vn/admin/fund/transactions?q=Nguyen%20Thanh",
    );
    expect(mail.html).toContain(
      'href="https://lwcifer.io.vn/admin/fund/transactions?q=Nguyen%20Thanh"',
    );
  });

  it("escape HTML của tên và mô tả (dữ liệu người dùng nhập)", () => {
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("&amp; &lt;b&gt;x&lt;/b&gt;");
  });
});
