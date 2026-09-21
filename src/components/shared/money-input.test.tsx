// @vitest-environment jsdom
/**
 * Ô nhập tiền dùng chung. Ba hành vi dưới đây là ba lỗi thật của bản cũ
 * (`<Input type="number">` ghi thẳng ở onChange trong section-thresholds):
 * số không format kiểu Việt, ghi server theo từng phím, và xoá trắng ô thì
 * `Number("")` = 0 nên ngưỡng âm thầm về 0.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MoneyInput } from "./money-input";

afterEach(cleanup);

function setup(value = 100000) {
  const onCommit = vi.fn();
  render(<MoneyInput value={value} onCommit={onCommit} aria-label="Ngưỡng" />);
  const input = screen.getByLabelText("Ngưỡng") as HTMLInputElement;
  return { input, onCommit };
}

describe("MoneyInput", () => {
  it("hiện số kiểu Việt chứ không phải chuỗi số trần", () => {
    const { input } = setup(100000);
    expect(input.value).toBe("100.000");
  });

  it("gõ tới đâu format tới đó", () => {
    const { input } = setup(0);
    fireEvent.change(input, { target: { value: "1234567" } });
    expect(input.value).toBe("1.234.567");
  });

  it("KHÔNG ghi khi đang gõ, chỉ ghi lúc rời ô", () => {
    const { input, onCommit } = setup(100000);
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.change(input, { target: { value: "200000" } });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(200000);
  });

  it("xoá trắng rồi rời ô: KHÔNG ghi 0, trả về giá trị cũ", () => {
    const { input, onCommit } = setup(100000);
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");

    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("100.000");
  });

  it("nhập lại đúng số cũ thì không ghi gì", () => {
    const { input, onCommit } = setup(100000);
    fireEvent.change(input, { target: { value: "100000" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("số 0 là giá trị hợp lệ, khác hẳn ô trống", () => {
    const { input, onCommit } = setup(100000);
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it("paste '250.000đ' vẫn ra đúng số", () => {
    const { input, onCommit } = setup(0);
    fireEvent.change(input, { target: { value: "250.000đ" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(250000);
  });

  it("Enter cũng chốt giá trị", () => {
    const { input, onCommit } = setup(100000);
    // Phải focus thật: Enter chốt bằng cách gọi blur(), mà blur() trên element
    // đang không focus thì không sinh sự kiện nào (cả jsdom lẫn trình duyệt
    // thật). Ngoài đời bấm được Enter nghĩa là ô đang focus sẵn.
    input.focus();
    fireEvent.change(input, { target: { value: "300000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(300000);
  });

  it("giá trị chốt đổi từ ngoài vào thì ô đồng bộ theo (rollback sau khi ghi hỏng)", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <MoneyInput value={100000} onCommit={onCommit} aria-label="Ngưỡng" />,
    );
    const input = screen.getByLabelText("Ngưỡng") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "999000" } });
    expect(input.value).toBe("999.000");

    rerender(
      <MoneyInput value={100000} onCommit={onCommit} aria-label="Ngưỡng" />,
    );
    // Cùng value nên chưa đổi gì; giờ server trả về giá trị khác:
    rerender(
      <MoneyInput value={123000} onCommit={onCommit} aria-label="Ngưỡng" />,
    );
    expect(input.value).toBe("123.000");
  });
});
