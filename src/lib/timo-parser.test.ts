import { describe, it, expect } from "vitest";
import {
  parseTimoEmail,
  parseMemoIntent,
  validateEmailAuth,
  extractEmailFromHeader,
} from "./timo-parser";

// ─── parseTimoEmail ───

describe("parseTimoEmail", () => {
  it("should parse standard Timo incoming transfer email", () => {
    const body = `
      Số dư TK Timo ****0236 của bạn đã tăng 150.000 VND
      ND: FWBB QUY THANG 4
      Ma GD: FT26042400123
      TK 9021111222333
    `;
    const result = parseTimoEmail(body, "msg-001");
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(150000);
    expect(result!.memo).toBe("FWBB QUY THANG 4");
    expect(result!.transId).toBe("FT26042400123");
    expect(result!.senderAccountNo).toBe("9021111222333");
  });

  it("should parse without diacritics (tang instead of tăng)", () => {
    const body = `So du TK da tang 200.000 VND\nND: BUOI 15/04\nMa GD: FT26041500001`;
    const result = parseTimoEmail(body, "msg-002");
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(200000);
    expect(result!.transId).toBe("FT26041500001");
  });

  it("should handle large amounts (millions)", () => {
    const body = `tăng 3.500.000 VND\nND: dong quy\nMa GD: FT123456789`;
    const result = parseTimoEmail(body, "msg-003");
    expect(result!.amount).toBe(3500000);
  });

  it("should handle small amounts without dots", () => {
    const body = `tăng 10000 VND\nND: test`;
    const result = parseTimoEmail(body, "msg-004");
    expect(result!.amount).toBe(10000);
  });

  it("should extract sender account from 'tu TK' pattern", () => {
    const body = `tăng 100.000 VND\ntu TK 1234567890123`;
    const result = parseTimoEmail(body, "msg-005");
    expect(result!.senderAccountNo).toBe("1234567890123");
  });

  it("should return null for sender account when not present", () => {
    const body = `tăng 100.000 VND\nND: test`;
    const result = parseTimoEmail(body, "msg-006");
    expect(result!.senderAccountNo).toBeNull();
  });

  it("should fallback transId to PUSH-{messageId} when no FT code", () => {
    const body = `tăng 50.000 VND\nND: chuyen tien`;
    const result = parseTimoEmail(body, "msg-fallback");
    expect(result!.transId).toBe("PUSH-msg-fallback");
  });

  it("should return null for empty body", () => {
    expect(parseTimoEmail("", "msg")).toBeNull();
  });

  it("should return null for email without amount pattern", () => {
    const body = `Xin chào! Bạn có 1 giao dịch mới.`;
    expect(parseTimoEmail(body, "msg")).toBeNull();
  });

  it("should return null for zero amount", () => {
    const body = `tăng 0 VND`;
    expect(parseTimoEmail(body, "msg")).toBeNull();
  });

  it("should handle amount with + prefix", () => {
    const body = `+500.000 VND\nND: nop quy`;
    const result = parseTimoEmail(body, "msg-plus");
    expect(result!.amount).toBe(500000);
  });

  it("should handle memo from 'Noi dung:' variant", () => {
    const body = `tăng 100.000 VND\nNoi dung: THANH TOAN BUOI 20/04`;
    const result = parseTimoEmail(body, "msg-nd");
    expect(result!.memo).toBe("THANH TOAN BUOI 20/04");
  });

  // REAL Timo (BVBank) format — nhãn "Mô tả:" + STK sau "tu" (không "TK").
  // Regression cho bug: email thật rơi về pending vì parser cũ chỉ hiểu "ND:".
  it("parses real Timo BVBank email: 'Mô tả:' label + 'tu <acct>' sender", () => {
    const body = `Nguyen Van Luu thân mến,

Tài khoản Spend Account vừa tăng 300.000 VND vào 15/06/2026 21:29. Số dư hiện tại: 356.014 VND.

Mô tả: FWBB QUY 50 FT26167604501015.CT tu 999999090920 DO DUC MANH tai TCB.

Cảm ơn Quý khách đã sử dụng dịch vụ Timo Digital Bank by BVBank!`;
    const result = parseTimoEmail(body, "msg-real-bvbank");
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(300000);
    expect(result!.transId).toBe("FT26167604501015");
    expect(result!.memo).toContain("FWBB QUY 50");
    expect(result!.senderAccountNo).toBe("999999090920");
  });

  it("real BVBank memo resolves to fund_contribution for member 50", () => {
    const intent = parseMemoIntent(
      "FWBB QUY 50 FT26167604501015.CT tu 999999090920 DO DUC MANH tai TCB.",
    );
    expect(intent.type).toBe("fund_contribution");
    expect(intent.memberId).toBe(50);
  });

  it("parses 'Mo ta' label without diacritics", () => {
    const body = `tang 50.000 VND\nMo ta: FWBB NO 7 tu 123456789 tai ACB`;
    const result = parseTimoEmail(body, "msg-mota-plain");
    expect(result!.memo).toContain("FWBB NO 7");
    expect(result!.senderAccountNo).toBe("123456789");
  });

  // CRITICAL: amounts must be integers
  it("rejects malformed amount with too-long final group (1.000.0001)", () => {
    const body = `tang 1.000.0001 VND\nMa GD: FT26042400999`;
    expect(parseTimoEmail(body, "msg-bad-1")).toBeNull();
  });

  it("rejects malformed amount with non-3-digit middle group (1.23.456)", () => {
    const body = `tang 1.23.456 VND\nMa GD: FT26042400999`;
    expect(parseTimoEmail(body, "msg-bad-2")).toBeNull();
  });

  it("accepts well-formed comma-separated amount (1,234,567)", () => {
    const body = `tang 1,234,567 VND\nMa GD: FT123`;
    const r = parseTimoEmail(body, "msg-ok-comma");
    expect(r?.amount).toBe(1_234_567);
  });

  it("rejects amount above 1B VND ceiling", () => {
    const body = `tang 1.000.000.001 VND\nMa GD: FT123`;
    expect(parseTimoEmail(body, "msg-too-big")).toBeNull();
  });

  it("date intent rejects decimal numbers like '1.5'", () => {
    const result = parseMemoIntent("ck 1.5 trieu");
    expect(result.type).toBe("unknown");
    expect(result.sessionDate).toBeNull();
  });

  it("should always produce integer amounts", () => {
    const testBodies = [
      `tăng 1.234.567 VND`,
      `tăng 100.000 VND`,
      `tăng 50000 VND`,
      `tang 999.999 VND`,
    ];
    for (const body of testBodies) {
      const result = parseTimoEmail(body, "msg");
      if (result) {
        expect(Number.isInteger(result.amount)).toBe(true);
        expect(result.amount).toBeGreaterThan(0);
      }
    }
  });
});

// ─── parseMemoIntent ───

describe("parseMemoIntent", () => {
  it("should detect fund contribution from 'QUY' keyword", () => {
    const result = parseMemoIntent("FWBB QUY THANG 4");
    expect(result.type).toBe("fund_contribution");
  });

  it("should detect fund from 'DONG QUY' keyword", () => {
    expect(parseMemoIntent("dong quy thang 5").type).toBe("fund_contribution");
  });

  it("should detect fund from 'NOP QUY' keyword", () => {
    expect(parseMemoIntent("nop quy").type).toBe("fund_contribution");
  });

  it("should detect fund from 'FUND' keyword", () => {
    expect(parseMemoIntent("FWBB FUND").type).toBe("fund_contribution");
  });

  it("should detect fund from 'QUYFWBB' keyword", () => {
    expect(parseMemoIntent("QUYFWBB 500K").type).toBe("fund_contribution");
  });

  it("should detect session debt from session ID (S123)", () => {
    const result = parseMemoIntent("thanh toan S42");
    expect(result.type).toBe("session_debt");
    expect(result.sessionId).toBe(42);
  });

  it("should detect session debt from date pattern DD/MM", () => {
    const result = parseMemoIntent("buoi choi 15/04");
    expect(result.type).toBe("session_debt");
    expect(result.sessionDate).toBe("15/04");
  });

  it("should detect date with single digit day", () => {
    const result = parseMemoIntent("buoi 5/4");
    expect(result.type).toBe("session_debt");
    expect(result.sessionDate).toBe("05/04");
  });

  it("should detect date with dash separator", () => {
    const result = parseMemoIntent("buoi 15-04");
    expect(result.type).toBe("session_debt");
    expect(result.sessionDate).toBe("15/04");
  });

  it("should detect pay-all-debts intent (NO {memberId})", () => {
    const result = parseMemoIntent("FWBB NO 5");
    expect(result.type).toBe("all_debts");
    expect(result.memberId).toBe(5);
  });

  it("should prefer fund keyword over NO pattern", () => {
    const result = parseMemoIntent("QUY NO 5");
    expect(result.type).toBe("fund_contribution");
  });

  it("should detect NO pattern with multi-digit memberId", () => {
    const result = parseMemoIntent("FWBB NO 123");
    expect(result.type).toBe("all_debts");
    expect(result.memberId).toBe(123);
  });

  it("should not confuse 'KHONG' or 'NOI' for NO intent", () => {
    expect(parseMemoIntent("KHONG NO TIEN").type).not.toBe("all_debts");
    expect(parseMemoIntent("NOI DUNG CK").type).toBe("unknown");
  });

  it("should return unknown for generic memo", () => {
    const result = parseMemoIntent("chuyen tien");
    expect(result.type).toBe("unknown");
  });

  it("should return unknown for empty memo", () => {
    const result = parseMemoIntent("");
    expect(result.type).toBe("unknown");
  });

  // Fund keyword takes priority over date
  it("should prioritize fund keyword over date pattern", () => {
    const result = parseMemoIntent("QUY THANG 4 buoi 15/04");
    expect(result.type).toBe("fund_contribution");
  });
});

// ─── validateEmailAuth ───

describe("validateEmailAuth", () => {
  it("should return true when both SPF and DKIM pass", () => {
    const auth = "spf=pass (google.com) dkim=pass header.d=timo.vn";
    expect(validateEmailAuth(auth)).toBe(true);
  });

  it("should return false when SPF fails", () => {
    const auth = "spf=fail dkim=pass";
    expect(validateEmailAuth(auth)).toBe(false);
  });

  it("should return false when DKIM fails", () => {
    const auth = "spf=pass dkim=fail";
    expect(validateEmailAuth(auth)).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(validateEmailAuth("")).toBe(false);
  });

  it("should be case insensitive", () => {
    const auth = "SPF=PASS DKIM=PASS HEADER.D=TIMO.VN";
    expect(validateEmailAuth(auth)).toBe(true);
  });

  it("accepts DKIM aligned via header.i=@subdomain.timo.vn", () => {
    const auth = "spf=pass dkim=pass header.i=@mail.timo.vn header.s=sel";
    expect(validateEmailAuth(auth)).toBe(true);
  });

  it("rejects dkim=pass that is NOT aligned to timo.vn (DMARC-bypass guard)", () => {
    // Attacker DKIM-signs their own domain + forges From: support@timo.vn.
    const auth = "spf=pass (google.com) dkim=pass header.d=attacker.com";
    expect(validateEmailAuth(auth)).toBe(false);
  });

  it("rejects a lookalike domain (timo.vn.evil.com)", () => {
    const auth = "spf=pass dkim=pass header.d=timo.vn.evil.com";
    expect(validateEmailAuth(auth)).toBe(false);
  });
});

// ─── extractEmailFromHeader ───

describe("extractEmailFromHeader", () => {
  it("should extract email from angle bracket format", () => {
    expect(extractEmailFromHeader("Timo <support@timo.vn>")).toBe(
      "support@timo.vn",
    );
  });

  it("should extract email from display name format", () => {
    expect(extractEmailFromHeader('"Timo Bank" <noreply@timo.vn>')).toBe(
      "noreply@timo.vn",
    );
  });

  it("should handle plain email address", () => {
    expect(extractEmailFromHeader("support@timo.vn")).toBe("support@timo.vn");
  });

  it("should lowercase the result", () => {
    expect(extractEmailFromHeader("SUPPORT@TIMO.VN")).toBe("support@timo.vn");
  });

  it("should handle email with spaces", () => {
    expect(extractEmailFromHeader("  support@timo.vn  ")).toBe(
      "support@timo.vn",
    );
  });
});
