// @vitest-environment jsdom
/**
 * Số tiền trong mã QR chuyển khoản.
 *
 * `amount` khởi tạo một lần từ prop `debtAmount`. Sau khi member trả bớt nợ và
 * trang revalidate, prop đổi — nếu ô số không đổi theo thì member quét mã cũ và
 * **chuyển sai số tiền**. Đây là tiền thật.
 *
 * Nhưng đồng bộ mù cũng sai: member có thể đã tự gõ số khác, ghi đè là nuốt mất
 * thứ họ vừa nhập. Hai ca dưới khoá đúng hai chiều đó.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

vi.mock("@/components/payment/payment-qr", () => ({
  PaymentQR: ({ amount }: { amount: number }) => (
    <div data-testid="qr-amount">{amount}</div>
  ),
}));

const { FundTopUpCard } = await import("./fund-topup-card");

afterEach(cleanup);

function renderCard(debtAmount: number) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <FundTopUpCard memberId={1} debtAmount={debtAmount} />
    </NextIntlClientProvider>,
  );
}

const qr = () => Number(screen.getByTestId("qr-amount").textContent);

describe("số tiền trong mã QR", () => {
  it("nợ giảm sau khi trả bớt: số trong QR đi theo số nợ MỚI", () => {
    // Phải VƯỢT mức nộp quỹ mặc định (500K) thì component mới mở ở chế độ trả
    // nợ và tự điền số nợ. Lấy đúng 500K là rơi vào chế độ nộp quỹ, test hoá
    // ra kiểm nhầm thứ khác.
    const { rerender } = renderCard(800_000);
    expect(qr()).toBe(800_000);

    // Member trả 200K, trang revalidate → prop còn 600K.
    rerender(
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <FundTopUpCard memberId={1} debtAmount={600_000} />
      </NextIntlClientProvider>,
    );
    expect(qr()).toBe(600_000);
  });

  it("member đã TỰ GÕ số khác: nợ đổi cũng KHÔNG ghi đè số họ nhập", () => {
    const { rerender } = renderCard(800_000);
    expect(qr()).toBe(800_000);

    // Member tự tăng số bằng nút cộng của stepper.
    fireEvent.click(screen.getByRole("button", { name: /^Tăng/ }));
    const typed = qr();
    expect(typed).not.toBe(800_000);

    rerender(
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <FundTopUpCard memberId={1} debtAmount={600_000} />
      </NextIntlClientProvider>,
    );
    // Giữ nguyên số member đã nhập, không nhảy về 600K.
    expect(qr()).toBe(typed);
  });

  it("prop không đổi thì không đụng gì", () => {
    const { rerender } = renderCard(800_000);
    const before = qr();
    rerender(
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <FundTopUpCard memberId={1} debtAmount={800_000} />
      </NextIntlClientProvider>,
    );
    expect(qr()).toBe(before);
  });
});
