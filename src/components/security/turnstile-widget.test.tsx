// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, act } from "@testing-library/react";
import { TurnstileWidget } from "./turnstile-widget";

type RenderOpts = {
  sitekey: string;
  action: string;
  size?: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
  "timeout-callback": () => void;
};

let opts: RenderOpts | undefined;
const turnstile = {
  render: vi.fn((_el: HTMLElement, o: RenderOpts) => {
    opts = o;
    return "widget-1";
  }),
  reset: vi.fn(),
  remove: vi.fn(),
};

beforeEach(() => {
  opts = undefined;
  turnstile.render.mockClear();
  turnstile.reset.mockClear();
  turnstile.remove.mockClear();
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
  (window as unknown as { turnstile: typeof turnstile }).turnstile = turnstile;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  delete (window as unknown as { turnstile?: unknown }).turnstile;
});

async function mount(onToken = vi.fn(), resetKey = 0, action = "login") {
  const utils = render(
    <TurnstileWidget action={action} onToken={onToken} resetKey={resetKey} />,
  );
  // Script load is promise-based: wait for the explicit render to happen.
  await act(async () => {});
  return { onToken, ...utils };
}

describe("TurnstileWidget", () => {
  it("render explicit với sitekey và action, onToken nhận token khi script gọi callback", async () => {
    const { onToken } = await mount(undefined, 0, "zalo_login");
    expect(turnstile.render).toHaveBeenCalledTimes(1);
    expect(opts?.sitekey).toBe("1x00000000000000000000AA");
    expect(opts?.action).toBe("zalo_login");
    act(() => opts?.callback("tok-abc"));
    expect(onToken).toHaveBeenLastCalledWith("tok-abc");
  });

  it("hết hạn, lỗi hay timeout -> onToken(null)", async () => {
    const { onToken } = await mount();
    for (const key of [
      "expired-callback",
      "error-callback",
      "timeout-callback",
    ] as const) {
      onToken.mockClear();
      act(() => opts?.[key]());
      expect(onToken).toHaveBeenCalledWith(null);
    }
  });

  it("đổi resetKey -> gọi turnstile.reset và onToken(null)", async () => {
    const onToken = vi.fn();
    const { rerender } = await mount(onToken, 0);
    expect(turnstile.reset).not.toHaveBeenCalled();
    rerender(<TurnstileWidget action="login" onToken={onToken} resetKey={1} />);
    expect(turnstile.reset).toHaveBeenCalledWith("widget-1");
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it("đổi onToken không dựng lại widget", async () => {
    const { rerender } = await mount();
    rerender(<TurnstileWidget action="login" onToken={vi.fn()} resetKey={0} />);
    expect(turnstile.render).toHaveBeenCalledTimes(1);
    expect(turnstile.remove).not.toHaveBeenCalled();
  });

  it("unmount -> turnstile.remove", async () => {
    const { unmount } = await mount();
    unmount();
    expect(turnstile.remove).toHaveBeenCalledWith("widget-1");
  });

  it("thiếu site key -> không render widget, onToken(null)", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const onToken = vi.fn();
    await mount(onToken);
    expect(turnstile.render).not.toHaveBeenCalled();
    expect(onToken).toHaveBeenCalledWith(null);
  });
});
