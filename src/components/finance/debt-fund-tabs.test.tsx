// @vitest-environment jsdom
/**
 * Cùng bug tiền với `fund-topup-card`, ở component thứ hai.
 *
 * `fundAmount` khởi tạo một lần từ `outstandingTotal` rồi đi thẳng vào mã QR.
 * Trả bớt nợ xong prop giảm mà số trong QR giữ nguyên số cũ → member quét và
 * **chuyển sai số tiền**.
 *
 * Bài này tồn tại vì lần vá đầu tôi chỉ sửa `fund-topup-card` và BỎ SÓT chỗ
 * này; hai component khác file nhưng cùng một lỗi.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

vi.mock("@/components/payment/payment-qr", () => ({
  PaymentQR: ({ amount }: { amount: number }) => (
    <div data-testid="qr-amount">{amount}</div>
  ),
}));
vi.mock("@/actions/finance", () => ({
  confirmPaymentByMember: vi.fn(async () => ({ success: true })),
}));
// Component kéo theo `@/actions/auto-fund` → `@/db`, mà `@/db` dựng client
// libsql ngay lúc import (đọc TURSO_DATABASE_URL). Test component không có env
// đó và cũng không nên chạm DB.
vi.mock("@/actions/auto-fund", () => ({
  autoFundFromBalance: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/db", () => ({ db: {} }));

const { DebtFundTabs } = await import("./debt-fund-tabs");

afterEach(cleanup);

/**
 * Một nguồn duy nhất cho props, để `render` và `rerender` không bao giờ lệch
 * nhau. Bản đầu viết props lặp ở ba chỗ và prettier gộp JSX lại một dòng, làm
 * các lần sửa trượt mất hai chỗ — test khi đó so số này với trạng thái kia.
 *
 * `defaultTab="debt"` là bắt buộc: với `fundBalance={0}` thì heuristic mặc
 * định (`!hasFund && isFundMember && hasDebt`) mở ở tab QUỸ, và ô số tiền là
 * mức nộp mặc định chứ không phải số nợ.
 */
function tabs(outstandingTotal: number) {
  return (
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <DebtFundTabs
        memberId={1}
        outstandingTotal={outstandingTotal}
        fundBalance={0}
        defaultTab="debt"
      />
    </NextIntlClientProvider>
  );
}

const qr = () => Number(screen.getByTestId("qr-amount").textContent);

describe("số tiền QR ở tab nợ/quỹ", () => {
  it("nợ giảm sau khi trả bớt: số trong QR đi theo số nợ MỚI", () => {
    const { rerender } = render(tabs(800_000));
    expect(qr()).toBe(800_000);

    // Member trả 200K, trang revalidate → nợ còn 600K.
    rerender(tabs(600_000));
    expect(qr()).toBe(600_000);
  });

  it("prop không đổi thì không đụng gì", () => {
    const { rerender } = render(tabs(800_000));
    const before = qr();
    rerender(tabs(800_000));
    expect(qr()).toBe(before);
  });
});
