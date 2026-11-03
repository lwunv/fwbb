// @vitest-environment jsdom
/**
 * Form đăng nhập giao lưu (g2a, Task 11). Mấy điều dễ hỏng im lặng:
 * 1. Token Turnstile dùng một lần: sau mỗi lần gọi Google (thành công, lỗi hay
 *    ném lỗi mạng) phải xin token mới, và callback của nút Google phải đọc
 *    token MỚI NHẤT (không phải token lúc nút được vẽ).
 * 2. `next` đi qua `safeNextPath` ở mọi chỗ, kể cả input ẩn của form Zalo.
 * 3. Một widget duy nhất với action "exchange_login", server của cả Zalo lẫn
 *    Google kiểm cùng action đó. Widget ở ngoài nhánh Google nên vẫn còn khi
 *    phần Google bị ẩn (trình duyệt Facebook/Zalo, SDK lỗi).
 *
 * Mock widget giả lập đúng widget thật: đổi `resetKey` thì gọi `onToken(null)`.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const widget = vi.hoisted(
  () =>
    ({}) as {
      action: string;
      onToken: (t: string | null) => void;
      resetKey: number;
    },
);
const google = vi.hoisted(() => ({
  initGoogleSDK: vi.fn(async () => {}),
  renderGoogleButton:
    vi.fn<(node: HTMLElement, cb: (idToken: string) => void) => void>(),
}));
const actions = vi.hoisted(() => ({
  googleLogin:
    vi.fn<
      (
        idToken: string,
        opts?: { intent?: "exchange"; turnstileToken?: string },
      ) => Promise<{ error?: string; success?: boolean }>
    >(),
}));
const browser = vi.hoisted(() => ({ facebook: false, zalo: false }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/security/turnstile-widget", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    TurnstileWidget: (p: {
      action: string;
      onToken: (t: string | null) => void;
      resetKey: number;
    }) => {
      widget.action = p.action;
      widget.onToken = p.onToken;
      widget.resetKey = p.resetKey;
      const last = useRef(p.resetKey);
      useEffect(() => {
        if (last.current === p.resetKey) return;
        last.current = p.resetKey;
        p.onToken(null);
      });
      return <div data-testid="turnstile" />;
    },
  };
});
vi.mock("@/lib/google-sdk", () => google);
vi.mock("@/lib/facebook-sdk", () => ({
  isInFacebookBrowser: () => browser.facebook,
  isInZaloBrowser: () => browser.zalo,
}));
vi.mock("@/actions/google-auth", () => actions);

const { ExchangeLoginForm } = await import("./exchange-login-form");

function renderForm(props: { next?: string; error?: string } = {}) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <ExchangeLoginForm {...props} />
    </NextIntlClientProvider>,
  );
}

function give(token: string | null) {
  act(() => widget.onToken(token));
}

function zaloButton() {
  return screen.getByRole("button", {
    name: "Đăng nhập bằng Zalo",
  }) as HTMLButtonElement;
}

function hidden(form: HTMLFormElement, name: string) {
  return (form.elements.namedItem(name) as HTMLInputElement).value;
}

/** Chờ nút Google được vẽ, trả về callback mà SDK sẽ gọi khi có credential. */
async function googleCredentialCallback() {
  await waitFor(() => expect(google.renderGoogleButton).toHaveBeenCalled());
  return google.renderGoogleButton.mock.calls.at(-1)![1];
}

beforeEach(() => {
  widget.action = "";
  widget.resetKey = 0;
  router.replace.mockClear();
  router.refresh.mockClear();
  google.initGoogleSDK.mockReset().mockResolvedValue(undefined);
  google.renderGoogleButton.mockReset();
  actions.googleLogin.mockReset();
  browser.facebook = false;
  browser.zalo = false;
});
afterEach(cleanup);

describe("ExchangeLoginForm: widget Turnstile", () => {
  it("chỉ một widget, action exchange_login, kể cả khi phần Google đã hiện", async () => {
    renderForm();
    await waitFor(() => expect(google.renderGoogleButton).toHaveBeenCalled());
    expect(screen.getAllByTestId("turnstile")).toHaveLength(1);
    expect(widget.action).toBe("exchange_login");
  });
});

describe("ExchangeLoginForm: nút Zalo", () => {
  it("khoá khi chưa có token, mở khi có token, input ẩn chứa token", () => {
    renderForm({ next: "/giao-luu" });
    expect(zaloButton().disabled).toBe(true);

    give("tok-zalo-1");

    expect(zaloButton().disabled).toBe(false);
    const form = zaloButton().closest("form")!;
    expect(form.getAttribute("method")?.toLowerCase()).toBe("post");
    expect(form.getAttribute("action")).toBe("/api/auth/zalo/start");
    expect(hidden(form, "cf-turnstile-response")).toBe("tok-zalo-1");
  });

  it("token hết hạn (null) → khoá lại", () => {
    renderForm();
    give("tok");
    give(null);
    expect(zaloButton().disabled).toBe(true);
  });

  it("next=//evil.com → input next=/giao-luu", () => {
    renderForm({ next: "//evil.com" });
    expect(hidden(zaloButton().closest("form")!, "next")).toBe("/giao-luu");
  });

  it("next hợp lệ được giữ nguyên", () => {
    renderForm({ next: "/san?r=5" });
    expect(hidden(zaloButton().closest("form")!, "next")).toBe("/san?r=5");
  });

  it("gửi form → xin token mới SAU khi form đã lấy token (không xoá token lúc đang gửi)", () => {
    renderForm();
    give("tok-zalo-1");
    const form = zaloButton().closest("form")!;
    const before = widget.resetKey;
    // Đồng hồ giả để tự chạy nhịp setTimeout(0) bên trong act(). Chờ bằng
    // waitFor với đồng hồ thật thì flaky khi máy tải nặng: mock widget ghi
    // resetKey ngay lúc render, còn nút chỉ khoá sau khi useEffect của widget
    // gọi onToken(null) và render lại, tức một nhịp sau. waitFor có thể bắt
    // đúng khe giữa hai việc đó. act() thì xả hết render + effect rồi mới trả.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fireEvent.submit(form);

      // Ngay lúc submit, input vẫn phải chứa token để trình duyệt gửi đi.
      expect(widget.resetKey).toBe(before);
      expect(hidden(form, "cf-turnstile-response")).toBe("tok-zalo-1");

      act(() => {
        vi.advanceTimersByTime(0);
      });

      // Sau đó token đã tiêu: quay lại bằng bfcache không được còn nút mở.
      expect(widget.resetKey).toBe(before + 1);
      expect(zaloButton().disabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ExchangeLoginForm: nút Google", () => {
  it("credential → googleLogin với intent exchange và token MỚI NHẤT (qua ref)", async () => {
    actions.googleLogin.mockResolvedValue({ success: true });
    renderForm({ next: "/san" });
    give("tok-A");
    const cb = await googleCredentialCallback();
    // Token đổi SAU khi nút đã vẽ: callback phải thấy token B.
    give("tok-B");

    cb("g".repeat(32));

    await waitFor(() =>
      expect(actions.googleLogin).toHaveBeenCalledWith("g".repeat(32), {
        intent: "exchange",
        turnstileToken: "tok-B",
      }),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/san"));
  });

  it("googleLogin trả lỗi → hiện lỗi, resetKey tăng, nút Zalo khoá lại, không điều hướng", async () => {
    actions.googleLogin.mockResolvedValue({
      error: "Google verification failed",
    });
    renderForm();
    give("tok-A");
    expect(zaloButton().disabled).toBe(false);
    const before = widget.resetKey;
    const cb = await googleCredentialCallback();

    cb("g".repeat(32));

    expect(await screen.findByText("Google verification failed")).toBeTruthy();
    expect(widget.resetKey).toBe(before + 1);
    await waitFor(() => expect(zaloButton().disabled).toBe(true));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("googleLogin ném lỗi (mạng/5xx) → báo lỗi chung, vẫn xin token mới, không điều hướng", async () => {
    actions.googleLogin.mockRejectedValue(new Error("network down"));
    renderForm();
    give("tok-A");
    const before = widget.resetKey;
    const cb = await googleCredentialCallback();

    cb("g".repeat(32));

    expect(
      await screen.findByText(viMessages.exchangeLogin.errors.server),
    ).toBeTruthy();
    expect(widget.resetKey).toBe(before + 1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("thành công cũng tăng resetKey (token đã dùng)", async () => {
    actions.googleLogin.mockResolvedValue({ success: true });
    renderForm();
    give("tok-A");
    const before = widget.resetKey;
    const cb = await googleCredentialCallback();

    cb("g".repeat(32));

    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(widget.resetKey).toBe(before + 1);
  });

  it("chưa có token Turnstile → không gọi googleLogin, báo chờ kiểm tra", async () => {
    renderForm();
    const cb = await googleCredentialCallback();

    cb("g".repeat(32));

    expect(
      await screen.findByText(viMessages.exchangeLogin.googleNeedsCheck),
    ).toBeTruthy();
    expect(actions.googleLogin).not.toHaveBeenCalled();
  });

  it.each([
    ["Facebook", "facebook"],
    ["Zalo", "zalo"],
  ] as const)(
    "trong trình duyệt %s: ẩn nút Google, widget và nút Zalo vẫn dùng được",
    async (_name, flag) => {
      browser[flag] = true;
      renderForm();
      give("tok");
      expect(zaloButton().disabled).toBe(false);
      // Chờ hết nhịp khởi tạo để chắc phần Google không hiện muộn.
      await act(async () => {});
      expect(screen.getAllByTestId("turnstile")).toHaveLength(1);
      expect(google.initGoogleSDK).not.toHaveBeenCalled();
      expect(google.renderGoogleButton).not.toHaveBeenCalled();
    },
  );

  it("SDK Google lỗi tải → widget và nút Zalo vẫn dùng được", async () => {
    google.initGoogleSDK.mockRejectedValue(new Error("boom"));
    renderForm();
    give("tok");
    await waitFor(() => expect(google.initGoogleSDK).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getAllByTestId("turnstile")).toHaveLength(1);
    expect(google.renderGoogleButton).not.toHaveBeenCalled();
    expect(zaloButton().disabled).toBe(false);
  });
});

describe("ExchangeLoginForm: ?error=", () => {
  it("region → khuyên dùng Google", () => {
    renderForm({ error: "region" });
    expect(screen.getByRole("alert").textContent).toBe(
      "Đăng nhập Zalo tạm thời không dùng được, hãy dùng Google",
    );
  });

  it.each([
    "origin",
    "config",
    "captcha",
    "rate",
    "state",
    "denied",
    "exchange",
    "profile",
    "region",
    "blocked",
    "server",
  ])("mã %s có thông báo riêng", (code) => {
    renderForm({ error: code });
    expect(screen.getByRole("alert").textContent).toBe(
      (viMessages.exchangeLogin.errors as Record<string, string>)[code],
    );
  });

  it("mã lạ → thông báo chung, không in nguyên mã ra màn hình", () => {
    renderForm({ error: "<script>x</script>" });
    expect(screen.getByRole("alert").textContent).toBe(
      viMessages.exchangeLogin.errors.server,
    );
  });

  it("không có ?error= → không có alert", () => {
    renderForm();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
