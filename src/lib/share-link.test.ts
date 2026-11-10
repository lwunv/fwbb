// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { shareOrCopy } from "./share-link";

const item = { title: "Sân A", url: "https://x.test/venues/1" };

function setNav(v: Record<string, unknown>) {
  for (const k of ["share", "clipboard"]) {
    Object.defineProperty(navigator, k, { value: v[k], configurable: true });
  }
}

afterEach(() => {
  setNav({});
  vi.restoreAllMocks();
});

describe("shareOrCopy", () => {
  it("uses navigator.share, then clipboard, then execCommand, maps AbortError to cancelled and total failure to failed", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNav({ share });
    expect(await shareOrCopy(item)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "Sân A", url: item.url });

    setNav({
      share: vi.fn().mockRejectedValue(new DOMException("x", "AbortError")),
    });
    expect(await shareOrCopy(item)).toBe("cancelled");

    const writeText = vi.fn().mockResolvedValue(undefined);
    setNav({ clipboard: { writeText } });
    expect(await shareOrCopy(item)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(item.url);

    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      value: exec,
      configurable: true,
    });
    setNav({
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
    });
    expect(await shareOrCopy(item)).toBe("copied");
    expect(exec).toHaveBeenCalledWith("copy");

    exec.mockReturnValue(false);
    expect(await shareOrCopy(item)).toBe("failed");
    setNav({});
    exec.mockImplementation(() => {
      throw new Error("x");
    });
    expect(await shareOrCopy(item)).toBe("failed");
  });
});
