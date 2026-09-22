// @vitest-environment jsdom
/**
 * Báo cáo thu chi quỹ: gom theo tháng / năm / toàn thời gian.
 *
 * Ràng buộc đáng khoá nhất là phép cộng: "Đã chi" phải gồm ĐỦ hoàn trả + tiền
 * sân + tiền cầu. Thiếu một khoản là admin tưởng quỹ còn nhiều hơn thực tế —
 * đúng thứ đang xảy ra ngoài đời vì tiền sân chưa được nhập.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import { FundCashflowReport } from "./fund-cashflow-report";
import type { FundCashFlowMonth } from "@/actions/fund";

afterEach(cleanup);

const thang = (
  key: string,
  v: Partial<Omit<FundCashFlowMonth, "key">> = {},
): FundCashFlowMonth => ({
  key,
  contributions: 0,
  guestIncome: 0,
  refunds: 0,
  courtRent: 0,
  shuttlecock: 0,
  ...v,
});

/** Đọc các số trong thẻ của một kỳ. */
function card(label: string) {
  const heading = screen.getByText(label);
  const li = heading.closest("li");
  if (!li) throw new Error(`khong thay the "${label}"`);
  return within(li);
}

describe("báo cáo thu chi quỹ", () => {
  const data = [
    thang("2026-09", {
      contributions: 10_000_000,
      guestIncome: 500_000,
      refunds: 200_000,
      courtRent: 2_400_000,
      shuttlecock: 1_000_000,
    }),
    thang("2026-08", { contributions: 5_000_000, courtRent: 2_400_000 }),
    thang("2025-12", { contributions: 3_000_000 }),
  ];

  it("theo tháng: thu, chi, tiền sân, tiền cầu tách bạch", () => {
    render(<FundCashflowReport months={data} />);
    const c = card("Tháng 9/2026");
    // Thu = nộp quỹ + thu khách admin.
    expect(c.getByText("10.500.000")).toBeTruthy();
    // Chi = hoàn trả + sân + cầu = 200.000 + 2.400.000 + 1.000.000.
    expect(c.getByText("3.600.000")).toBeTruthy();
    expect(c.getByText("2.400.000")).toBeTruthy();
    expect(c.getByText("1.000.000")).toBeTruthy();
  });

  it("gom theo NĂM cộng đúng các tháng trong năm đó", () => {
    render(<FundCashflowReport months={data} />);
    fireEvent.click(screen.getByRole("tab", { name: "Năm" }));

    const c = card("Năm 2026");
    // Thu 2026 = 10.000.000 + 500.000 + 5.000.000
    expect(c.getByText("15.500.000")).toBeTruthy();
    // Tiền sân 2026 = 2.400.000 × 2 tháng
    expect(c.getByText("4.800.000")).toBeTruthy();
    // Năm 2025 phải là thẻ riêng, không bị gộp vào.
    expect(screen.getByText("Năm 2025")).toBeTruthy();
  });

  it("toàn thời gian gộp tất cả vào MỘT thẻ", () => {
    render(<FundCashflowReport months={data} />);
    fireEvent.click(screen.getByRole("tab", { name: "Tất cả" }));

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    const c = card("Toàn thời gian");
    // 10.000.000 + 500.000 + 5.000.000 + 3.000.000
    expect(c.getByText("18.500.000")).toBeTruthy();
  });

  it("chưa có khoản nào thì nói rõ, không hiện bảng rỗng", () => {
    render(<FundCashflowReport months={[]} />);
    expect(screen.getByText(/Chưa có khoản thu chi nào/)).toBeTruthy();
  });
});
