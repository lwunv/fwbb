/**
 * Timo bank email parser — extracts payment info from Timo notification emails.
 *
 * Timo sends email notifications for incoming transfers with format:
 * - Amount: "tăng 150.000 VND" or "tang 150.000 VND" (no diacritics fallback)
 * - Transaction ID: "FT2607..." (bank reference)
 * - Transfer content (memo): "ND: FWBB QUY THANG 4 ..." line
 * - Sender account: "TK 9021813730236" pattern
 *
 * Security: caller must verify From: support@timo.vn + SPF/DKIM pass before parsing.
 */

export interface ParsedTimoPayment {
  /** Payment amount in VND (integer) */
  amount: number;
  /** Transfer memo / content */
  memo: string;
  /** Bank transaction reference (FTxxxxxxx or fallback PUSH-{messageId}) */
  transId: string;
  /** Sender bank account number (if present in email) */
  senderAccountNo: string | null;
}

/**
 * Parse a Timo notification email body into structured payment data.
 * Returns null if the email doesn't match a valid incoming transfer pattern.
 */
export function parseTimoEmail(
  body: string,
  messageId: string,
): ParsedTimoPayment | null {
  if (!body) return null;

  // 1. Amount: "tăng 150.000 VND" or "tang 150.000 VND" (diacritics-tolerant)
  // Accept either thousand-separated (1.234.567 / 1,234,567) or plain digits;
  // reject malformed tokens like "1.000.0001" that would otherwise be misread.
  const AMOUNT_TOKEN = /(\d{1,3}(?:[.,]\d{3})+|\d{1,12})/;
  const amountMatch =
    body.match(new RegExp(`t[aă]ng\\s+${AMOUNT_TOKEN.source}\\s*VND`, "i")) ||
    body.match(new RegExp(`\\+${AMOUNT_TOKEN.source}\\s*VND`, "i"));

  if (!amountMatch) return null;

  const rawAmount = amountMatch[1];
  // Validate the token is well-formed: either pure digits OR a separated group
  // where every chunk after the first is exactly 3 digits.
  if (rawAmount.includes(".") || rawAmount.includes(",")) {
    const parts = rawAmount.split(/[.,]/);
    if (parts.length < 2) return null;
    if (parts[0].length === 0 || parts[0].length > 3) return null;
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].length !== 3) return null;
    }
  }
  const amount = parseInt(rawAmount.replace(/[.,]/g, ""), 10);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000)
    return null;

  // 2. Transaction ID: "FTxxxxxxx" or "Ma GD: FT..."
  const transIdMatch = body.match(/(?:Ma\s*GD[:\s]*)?(\bFT\w{6,})/i);
  const transId = transIdMatch
    ? transIdMatch[1].toUpperCase()
    : `PUSH-${messageId}`;

  // 3. Transfer memo / content: "ND: ..." line
  const memoMatch =
    body.match(/(?:\n|\r|^)\s*ND[:\s]+(.+?)(?:\n|\r|Ma\s*GD|$)/i) ||
    body.match(/(?:\n|\r|^)\s*Noi\s*dung[:\s]+(.+?)(?:\n|\r|$)/i);
  const memo = memoMatch ? memoMatch[1].trim() : "";

  // 4. Sender account number: "TK 9021813730236" or "tu TK 123..."
  const accountMatch =
    body.match(/(?:tu\s+)?TK\s+(\d{8,20})/i) ||
    body.match(/(?:from\s+)?(?:account|acc)[:\s]*(\d{8,20})/i);
  const senderAccountNo = accountMatch ? accountMatch[1] : null;

  return { amount, memo, transId, senderAccountNo };
}

/**
 * Extract FWBB-specific keywords from a transfer memo.
 * Used to determine if a payment is for fund contribution or session debt.
 */
export interface MemoIntent {
  type: "fund_contribution" | "session_debt" | "all_debts" | "unknown";
  /** Session date if found (e.g. "15/04") */
  sessionDate: string | null;
  /** Session ID if found (e.g. "S123") */
  sessionId: number | null;
  /** Member ID if found (e.g. "FWBB NO 5" → 5) — only set for `all_debts` intent */
  memberId: number | null;
  /** Raw memo for logging */
  rawMemo: string;
}

export function parseMemoIntent(memo: string): MemoIntent {
  const upper = memo.toUpperCase();

  // Fund contribution với memberId: "FWBB QUY 5" hoặc "QUY 5"
  const fundWithIdMatch = upper.match(/\bQUY\s+(\d{1,5})\b/);
  if (fundWithIdMatch) {
    return {
      type: "fund_contribution",
      sessionDate: null,
      sessionId: null,
      memberId: parseInt(fundWithIdMatch[1], 10),
      rawMemo: memo,
    };
  }

  // Fund contribution keywords (legacy, không có memberId)
  if (/\b(QUY|FUND|DONG\s*QUY|NOP\s*QUY|QUYFWBB)\b/.test(upper)) {
    return {
      type: "fund_contribution",
      sessionDate: null,
      sessionId: null,
      memberId: null,
      rawMemo: memo,
    };
  }

  // Pay-all-debts pattern: "NO 5" / "FWBB NO 5" / "TRA NO 5" — must come before
  // session-id check (S\d) so it doesn't get confused with bank reference codes.
  const allDebtsMatch = upper.match(/\bNO\s+(\d{1,5})\b/);
  if (allDebtsMatch) {
    return {
      type: "all_debts",
      sessionDate: null,
      sessionId: null,
      memberId: parseInt(allDebtsMatch[1], 10),
      rawMemo: memo,
    };
  }

  // Session-specific: "BUOI 15/04" or "S123" or date pattern DD/MM
  const sessionIdMatch = upper.match(/\bS(\d{1,5})\b/);
  if (sessionIdMatch) {
    return {
      type: "session_debt",
      sessionDate: null,
      sessionId: parseInt(sessionIdMatch[1], 10),
      memberId: null,
      rawMemo: memo,
    };
  }

  // Tighter date match: only "/" or "-" separators (avoid "1.5" decimals).
  const dateMatch = upper.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  if (dateMatch) {
    return {
      type: "session_debt",
      sessionDate: `${dateMatch[1].padStart(2, "0")}/${dateMatch[2].padStart(2, "0")}`,
      sessionId: null,
      memberId: null,
      rawMemo: memo,
    };
  }

  return {
    type: "unknown",
    sessionDate: null,
    sessionId: null,
    memberId: null,
    rawMemo: memo,
  };
}

/**
 * Validate email security headers.
 * Returns true only if both SPF and DKIM pass.
 */
export function validateEmailAuth(authResults: string): boolean {
  return (
    /\bspf=pass\b/i.test(authResults) && /\bdkim=pass\b/i.test(authResults)
  );
}

/**
 * Extract email address from a "From" header value.
 * e.g. "Timo <support@timo.vn>" → "support@timo.vn"
 */
export function extractEmailFromHeader(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : headerValue.trim().toLowerCase();
}
