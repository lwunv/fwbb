// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useWebGL2Support } from "./webgl";

function mockWebGL(available: boolean) {
  return vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation((() =>
      available ? ({} as WebGL2RenderingContext) : null) as never);
}

function Probe() {
  const supported = useWebGL2Support();
  const [renders, setRenders] = useState(0);
  return (
    <button
      data-supported={String(supported)}
      onClick={() => setRenders(renders + 1)}
    >
      {renders}
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useWebGL2Support", () => {
  it("the server snapshot assumes support, so server HTML never depends on the device", () => {
    mockWebGL(false);
    expect(renderToString(<Probe />)).toContain('data-supported="true"');
  });

  it("reports the real answer on the client", () => {
    mockWebGL(false);
    render(<Probe />);
    expect(screen.getByRole("button").dataset.supported).toBe("false");
    cleanup();
    vi.restoreAllMocks();
    mockWebGL(true);
    render(<Probe />);
    expect(screen.getByRole("button").dataset.supported).toBe("true");
  });

  it("releases the probe context right after probing so it does not count against the browser's live-context limit", () => {
    const loseContext = vi.fn();
    const getExtension = vi.fn((name: string) =>
      name === "WEBGL_lose_context" ? { loseContext } : null,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      (() => ({ getExtension }) as unknown as WebGL2RenderingContext) as never,
    );
    render(<Probe />);
    expect(screen.getByRole("button").dataset.supported).toBe("true");
    expect(getExtension).toHaveBeenCalledWith("WEBGL_lose_context");
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("probes once per mount, not on every render (each probe creates a WebGL context)", () => {
    const getContext = mockWebGL(true);
    render(<Probe />);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("3");
    expect(getContext).toHaveBeenCalledTimes(1);
  });
});
