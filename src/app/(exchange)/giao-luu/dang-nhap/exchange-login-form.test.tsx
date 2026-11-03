// @vitest-environment jsdom
/**
 * Form đăng nhập giao lưu (g2a, Task 11). Hai điều dễ hỏng im lặng:
 * 1. Token Turnstile dùng một lần: sau mỗi lần gọi Google phải xin token mới,
 *    và callback của nút Google phải đọc token MỚI NHẤT (không phải token lúc
 *    nút được vẽ), nếu không lần bấm thứ hai bị server từ chối.
 * 2. `next` đi qua `safeNextPath` ở mọi chỗ, kể cả input ẩn của form Zalo.
 *
 * Mỗi nút có widget Turnstile riêng vì server kiểm `action` của token
 * ("zalo_login" ở route start, "google_login" ở googleLogin).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const widgets = vi.hoisted(
  () =>
    ({}) as Record<
      string,
      { onToken: (t: string | null) => void; resetKey: number }
    >,
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
const iab = vi.hoisted(() => ({ on: false }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/security/turnstile-widget", () => ({
  TurnstileWidget: (p: {
    action: string;
    onToken: (t: string | null) => void;
    resetKey: number;
  }) => {
    widgets[p.action] = { onToken: p.onToken, resetKey: p.resetKey };
    return <div data-testid={`turnstile-${p.action}`} />;
  },
}));
vi.mock("@/lib/google-sdk", () => google);
vi.mock("@/lib/facebook-sdk", () => ({
  isInFacebookBrowser: () => iab.on,
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

function give(action: string, token: string | null) {
  act(() => widgets[action].onToken(token));
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
  for (const k of Object.keys(widgets)) delete widgets[k];
  router.replace.mockClear();
  router.refresh.mockClear();
  google.initGoogleSDK.mockReset().mockResolvedValue(undefined);
  google.renderGoogleButton.mockReset();
  actions.googleLogin.mockReset();
  iab.on = false;
});
afterEach(cleanup);

describe("ExchangeLoginForm: nút Zalo", () => {
  it("khoá khi chưa có token, mở khi có token, input ẩn chứa token", () => {
    renderForm({ next: "/giao-luu" });
    expect(zaloButton().disabled).toBe(true);

    give("zalo_login", "tok-zalo-1");

    expect(zaloButton().disabled).toBe(false);
    const form = zaloButton().closest("form")!;
    expect(form.getAttribute("method")?.toLowerCase()).toBe("post");
    expect(form.getAttribute("action")).toBe("/api/auth/zalo/start");
    expect(hidden(form, "cf-turnstile-response")).toBe("tok-zalo-1");
  });

  it("token hết hạn (null) → khoá lại", () => {
    renderForm();
    give("zalo_login", "tok");
    give("zalo_login", null);
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
});

describe("ExchangeLoginForm: nút Google", () => {
  it("credential → googleLogin với intent exchange và token MỚI NHẤT (qua ref)", async () => {
    actions.googleLogin.mockResolvedValue({ success: true });
    renderForm({ next: "/san" });
    await screen.findByTestId("turnstile-google_login");
    give("google_login", "tok-A");
    const cb = await googleCredentialCallback();
    // Token đổi SAU khi nút đã vẽ: callback phải thấy token B.
    give("google_login", "tok-B");

    cb("g".repeat(32));

    await waitFor(() =>
      expect(actions.googleLogin).toHaveBeenCalledWith("g".repeat(32), {
        intent: "exchange",
        turnstileToken: "tok-B",
      }),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/san"));
  });

  it("googleLogin trả lỗi → hiện lỗi, resetKey của widget Google tăng, không điều hướng", async () => {
    actions.googleLogin.mockResolvedValue({
      error: "Google verification failed",
    });
    renderForm();
    await screen.findByTestId("turnstile-google_login");
    give("google_login", "tok-A");
    const before = widgets["google_login"].resetKey;
    const cb = await googleCredentialCallback();

    cb("g".repeat(32));

    expect(await screen.findByText("Google verification failed")).toBeTruthy();
    expect(widgets["google_login"].resetKey).toBe(before + 1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("thành công cũng tăng resetKey (token đã dùng)", async () => {
    actions.googleLogin.mockResolvedValue({ success: true });
    renderForm();
    await screen.findByTestId("turnstile-google_login");
    give("google_login", "tok-A");
    const before = widgets["google_login"].resetKey;
    const cb = await googleCredentialCallback();

    cb("g".repeat(32));

    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(widgets["google_login"].resetKey).toBe(before + 1);
  });

  it("chưa có token Turnstile → không gọi googleLogin, báo chờ kiểm tra", async () => {
    renderForm();
    await screen.findByTestId("turnstile-google_login");
    const cb = await googleCredentialCallback();

    cb("g".repeat(32));

    expect(
      await screen.findByText(viMessages.exchangeLogin.googleNeedsCheck),
    ).toBeTruthy();
    expect(actions.googleLogin).not.toHaveBeenCalled();
  });

  it("trong trình duyệt Facebook: không có phần Google, Zalo vẫn dùng được", async () => {
    iab.on = true;
    renderForm();
    give("zalo_login", "tok");
    expect(zaloButton().disabled).toBe(false);
    await waitFor(() =>
      expect(screen.queryByTestId("turnstile-google_login")).toBeNull(),
    );
    expect(google.initGoogleSDK).not.toHaveBeenCalled();
  });

  it("SDK Google lỗi tải → không có phần Google, Zalo vẫn dùng được", async () => {
    google.initGoogleSDK.mockRejectedValue(new Error("boom"));
    renderForm();
    give("zalo_login", "tok");
    await waitFor(() => expect(google.initGoogleSDK).toHaveBeenCalled());
    expect(screen.queryByTestId("turnstile-google_login")).toBeNull();
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
