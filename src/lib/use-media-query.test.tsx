// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useMediaQuery } from "./use-media-query";

type Listener = () => void;

function installMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<Listener>();
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn(() => mql),
    configurable: true,
    writable: true,
  });
  return {
    set(next: boolean) {
      matches = next;
      listeners.forEach((l) => l());
    },
    listeners,
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

function Probe() {
  const v = useMediaQuery("(min-width: 768px)");
  return <span>{String(v)}</span>;
}

describe("useMediaQuery", () => {
  it("is null in the server render", () => {
    installMatchMedia(true);
    expect(renderToString(<Probe />)).toContain("null");
  });

  it("follows the media query on the client and unsubscribes on unmount", () => {
    const mm = installMatchMedia(false);
    const { result, unmount } = renderHook(() =>
      useMediaQuery("(min-width: 768px)"),
    );
    expect(result.current).toBe(false);
    act(() => mm.set(true));
    expect(result.current).toBe(true);
    unmount();
    expect(mm.listeners.size).toBe(0);
  });

  it("falls back to false when matchMedia is missing", () => {
    Reflect.deleteProperty(window, "matchMedia");
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);
  });
});
