// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { MotionValue } from "framer-motion";
import viMessages from "@/i18n/messages/vi.json";
import { VenueSheet } from "./venue-sheet";
import type { SheetSnap } from "@/lib/venues/sheet-snap";

type PanelProps = {
  style?: { y?: MotionValue<number> } & Record<string, unknown>;
  onDragEnd?: (e: unknown, info: { velocity: { y: number } }) => void;
};

// jsdom cannot run a real drag (no layout, no frame loop), so the panel is a
// plain div that hands its props back to the test, and `animate` records the
// target it was asked for.
const fm = vi.hoisted(() => ({
  animate: vi.fn(),
  start: vi.fn(),
  panel: { current: null as PanelProps | null },
  reducedMotion: false,
}));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  const React = await import("react");
  const DRAG_PROPS = [
    "drag",
    "dragListener",
    "dragControls",
    "dragMomentum",
    "dragConstraints",
    "dragElastic",
    "onDragEnd",
    "onDragStart",
  ];
  const MotionDiv = React.forwardRef<HTMLDivElement, Record<string, unknown>>(
    function MotionDiv(props, ref) {
      fm.panel.current = props as PanelProps;
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) {
        if (!DRAG_PROPS.includes(k)) rest[k] = v;
      }
      // A MotionValue is not a CSS value: keep it out of the DOM style.
      const style = { ...((props.style ?? {}) as Record<string, unknown>) };
      delete style.y;
      return React.createElement("div", { ...rest, style, ref });
    },
  );
  return {
    ...actual,
    motion: { div: MotionDiv },
    useDragControls: () => ({ start: fm.start }),
    useReducedMotion: () => fm.reducedMotion,
    animate: (mv: MotionValue<number>, to: number, opts: unknown) => {
      fm.animate(mv, to, opts);
      mv.set(to);
      return { stop: () => {} };
    },
  };
});

class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  constructor(private cb: ResizeObserverCallback) {
    FakeResizeObserver.all.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    FakeResizeObserver.all = FakeResizeObserver.all.filter((o) => o !== this);
  }
  fire(height: number) {
    this.cb(
      [{ contentRect: { height } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

function resize(height: number) {
  act(() => {
    FakeResizeObserver.all.forEach((o) => o.fire(height));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fm.reducedMotion = false;
  FakeResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Props = {
  snap: SheetSnap;
  onSnapChange?: (s: SheetSnap) => void;
  frozen?: boolean;
  onVisibleHeight?: (px: number) => void;
  onDragClose?: () => void;
  topReserve?: number;
};

function ui(p: Props): ReactNode {
  return (
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <VenueSheet
        snap={p.snap}
        onSnapChange={p.onSnapChange ?? (() => {})}
        title={<span>12 sân</span>}
        topReserve={p.topReserve ?? 150}
        frozen={p.frozen}
        onVisibleHeight={p.onVisibleHeight}
        onDragClose={p.onDragClose}
      >
        <button type="button">Sân A</button>
      </VenueSheet>
    </NextIntlClientProvider>
  );
}

/** Render, measure the frame at 800px and forget the placement calls. */
function setup(p: Props) {
  const r = render(ui(p));
  resize(800);
  fm.animate.mockClear();
  return r;
}

function y(): MotionValue<number> {
  const mv = fm.panel.current?.style?.y;
  if (!mv) throw new Error("panel has no y motion value");
  return mv;
}

function release(at: number, velocity = 0) {
  act(() => {
    y().set(at);
    fm.panel.current?.onDragEnd?.({}, { velocity: { y: velocity } });
  });
}

const list = () => screen.getByTestId("venue-sheet-list");
const panel = () => screen.getByTestId("venue-sheet-panel");

describe("VenueSheet", () => {
  it("places the panel at the snap without animating on first measure", () => {
    render(ui({ snap: "mid" }));
    resize(800);
    expect(fm.animate).not.toHaveBeenCalled();
    expect(y().get()).toBe(440);
  });

  it("release at the same snap still animates back to that snap's offset", () => {
    const onSnapChange = vi.fn();
    setup({ snap: "mid", onSnapChange });
    release(470);
    expect(fm.animate).toHaveBeenCalledTimes(1);
    expect(fm.animate).toHaveBeenCalledWith(y(), 440, expect.anything());
    expect(y().get()).toBe(440);
    expect(onSnapChange).toHaveBeenCalledWith("mid");
  });

  it("release elsewhere animates to the settled snap then calls onSnapChange", () => {
    const onSnapChange = vi.fn();
    setup({ snap: "mid", onSnapChange });
    release(700);
    expect(fm.animate).toHaveBeenCalledWith(y(), 728, expect.anything());
    expect(onSnapChange).toHaveBeenCalledWith("low");
    expect(fm.animate.mock.invocationCallOrder[0]).toBeLessThan(
      onSnapChange.mock.invocationCallOrder[0],
    );
  });

  it("a fast flick jumps one snap in the swipe direction", () => {
    const onSnapChange = vi.fn();
    setup({ snap: "mid", onSnapChange });
    release(430, -900);
    expect(fm.animate).toHaveBeenCalledWith(y(), 150, expect.anything());
    expect(onSnapChange).toHaveBeenCalledWith("high");
  });

  it("onDragClose replaces onSnapChange when released at low", () => {
    const onSnapChange = vi.fn();
    const onDragClose = vi.fn();
    setup({ snap: "mid", onSnapChange, onDragClose });
    release(700);
    expect(fm.animate).toHaveBeenCalledWith(y(), 728, expect.anything());
    expect(onDragClose).toHaveBeenCalledTimes(1);
    expect(onSnapChange).not.toHaveBeenCalled();
    // released anywhere else, onSnapChange still runs
    release(160);
    expect(onSnapChange).toHaveBeenCalledWith("high");
    expect(onDragClose).toHaveBeenCalledTimes(1);
  });

  it("does not re-animate when the parent confirms the snap it was released at", () => {
    const { rerender } = setup({ snap: "mid" });
    release(700);
    expect(fm.animate).toHaveBeenCalledTimes(1);
    rerender(ui({ snap: "low" }));
    expect(fm.animate).toHaveBeenCalledTimes(1);
  });

  it("a snap change from outside animates to the new offset", () => {
    const { rerender } = setup({ snap: "low" });
    rerender(ui({ snap: "high" }));
    expect(fm.animate).toHaveBeenCalledWith(y(), 150, expect.anything());
  });

  it("outer layer is pointer-events-none, only the panel takes pointer events, and it has md:hidden", () => {
    setup({ snap: "low" });
    const outer = screen.getByTestId("venue-sheet");
    expect(outer.className).toContain("pointer-events-none");
    expect(outer.className).toContain("md:hidden");
    expect(outer.className).toContain("absolute");
    expect(outer.className).toContain("inset-0");
    expect(outer.className).toContain("overflow-hidden");
    expect(outer.className).toContain("z-10");
    expect(outer.className).not.toContain("pointer-events-auto");
    expect(panel().className).toContain("pointer-events-auto");
  });

  it("at low the list is inert and aria-hidden; at mid it is interactive", () => {
    const { rerender } = setup({ snap: "low" });
    expect(list().hasAttribute("inert")).toBe(true);
    expect(list().getAttribute("aria-hidden")).toBe("true");
    rerender(ui({ snap: "mid" }));
    expect(list().hasAttribute("inert")).toBe(false);
    expect(list().hasAttribute("aria-hidden")).toBe(false);
    expect(screen.getByRole("button", { name: "Sân A" })).toBeTruthy();
  });

  it("panel height is the same at every snap", () => {
    const { rerender } = setup({ snap: "low" });
    const heights: string[] = [];
    for (const s of ["low", "mid", "high"] as const) {
      rerender(ui({ snap: s }));
      heights.push(panel().style.height);
    }
    expect(heights).toEqual(["650px", "650px", "650px"]);
  });

  it("list padding covers the hidden part of the settled snap plus the safe area", () => {
    const { rerender } = setup({ snap: "mid" });
    expect(list().style.paddingBottom).toContain("290px");
    expect(list().style.paddingBottom).toContain("safe-area-inset-bottom");
    rerender(ui({ snap: "high" }));
    expect(list().style.paddingBottom).toContain("0px");
  });

  it("title tap calls onSnapChange with the next snap and sets aria-expanded", () => {
    const onSnapChange = vi.fn();
    const { rerender } = setup({ snap: "low", onSnapChange });
    const title = screen.getByRole("button", { expanded: false });
    expect(title.textContent).toContain("12 sân");
    fireEvent.click(title);
    expect(onSnapChange).toHaveBeenCalledWith("mid");
    rerender(ui({ snap: "high", onSnapChange }));
    const expanded = screen.getByRole("button", { expanded: true });
    fireEvent.click(expanded);
    expect(onSnapChange).toHaveBeenLastCalledWith("low");
  });

  it("a drag that starts on the title does not also cycle the snap", () => {
    const onSnapChange = vi.fn();
    setup({ snap: "low", onSnapChange });
    const title = screen.getByRole("button", { expanded: false });
    fireEvent.pointerDown(title, { clientX: 100, clientY: 700 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 600 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 600 });
    // a pointer-generated click carries detail >= 1 (keyboard clicks are 0)
    fireEvent.click(title, { detail: 1 });
    expect(onSnapChange).not.toHaveBeenCalled();
    // the next plain tap works again
    fireEvent.pointerDown(title, { clientX: 100, clientY: 700 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 700 });
    fireEvent.click(title, { detail: 1 });
    expect(onSnapChange).toHaveBeenCalledWith("mid");
  });

  it("a click on a card that ends a list drag is swallowed", () => {
    const onCard = vi.fn();
    render(
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <VenueSheet
          snap="mid"
          onSnapChange={() => {}}
          title="12 sân"
          topReserve={150}
        >
          <button type="button" onClick={onCard}>
            Sân A
          </button>
        </VenueSheet>
      </NextIntlClientProvider>,
    );
    resize(800);
    const card = screen.getByRole("button", { name: "Sân A" });
    fireEvent.pointerDown(card, { clientX: 50, clientY: 500 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 420 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 420 });
    fireEvent.click(card, { detail: 1 });
    expect(onCard).not.toHaveBeenCalled();
    fireEvent.pointerDown(card, { clientX: 50, clientY: 500 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 500 });
    fireEvent.click(card, { detail: 1 });
    expect(onCard).toHaveBeenCalledTimes(1);
  });

  it("pointerdown on the handle starts a drag", () => {
    setup({ snap: "high" });
    fireEvent.pointerDown(screen.getByTestId("venue-sheet-handle"), {
      clientY: 160,
    });
    expect(fm.start).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("venue-sheet-handle").style.touchAction).toBe(
      "none",
    );
  });

  it("at mid a pointerdown on the list starts a drag", () => {
    setup({ snap: "mid" });
    expect(list().style.touchAction).toBe("none");
    fireEvent.pointerDown(list(), { clientY: 500 });
    expect(fm.start).toHaveBeenCalledTimes(1);
  });

  it("at high the list starts a drag only when scrolled to top and moving down", () => {
    setup({ snap: "high" });
    const el = list();
    expect(el.style.touchAction).toBe("pan-y");

    fireEvent.pointerDown(el, { clientY: 300 });
    expect(fm.start).not.toHaveBeenCalled();

    // scrolled into the list: pulling down scrolls, no drag
    el.scrollTop = 40;
    fireEvent.pointerMove(el, { clientY: 330 });
    expect(fm.start).not.toHaveBeenCalled();

    // at the top, moving up or only a little down: still no drag
    el.scrollTop = 0;
    fireEvent.pointerMove(el, { clientY: 280 });
    fireEvent.pointerMove(el, { clientY: 306 });
    expect(fm.start).not.toHaveBeenCalled();

    fireEvent.pointerMove(el, { clientY: 320 });
    expect(fm.start).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(el, { clientY: 340 });
    expect(fm.start).toHaveBeenCalledTimes(1);
  });

  it("at high a finished pull gesture does not start a drag on a later move", () => {
    setup({ snap: "high" });
    const el = list();
    el.scrollTop = 0;
    fireEvent.pointerDown(el, { clientY: 300 });
    fireEvent.pointerUp(window, { clientY: 302 });
    fireEvent.pointerMove(el, { clientY: 340 }); // mouse hover, no button down
    expect(fm.start).not.toHaveBeenCalled();
  });

  it("at high a card tap after an earlier drag still clicks", () => {
    const onCard = vi.fn();
    const sheet = (snap: SheetSnap) => (
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <VenueSheet
          snap={snap}
          onSnapChange={() => {}}
          title="12 sân"
          topReserve={150}
        >
          <button type="button" onClick={onCard}>
            Sân A
          </button>
        </VenueSheet>
      </NextIntlClientProvider>
    );
    const { rerender } = render(sheet("mid"));
    resize(800);
    const card = () => screen.getByRole("button", { name: "Sân A" });
    fireEvent.pointerDown(card(), { clientX: 50, clientY: 500 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 300 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 300 });
    rerender(sheet("high"));
    fireEvent.pointerDown(card(), { clientX: 50, clientY: 300 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 300 });
    fireEvent.click(card(), { detail: 1 });
    expect(onCard).toHaveBeenCalledTimes(1);
  });

  it("at high a downward touchmove from the top is not left to the browser", () => {
    setup({ snap: "high" });
    const el = list();
    el.scrollTop = 0;
    fireEvent.touchStart(el, { touches: [{ clientY: 300 }] });
    const down = fireEvent.touchMove(el, { touches: [{ clientY: 320 }] });
    expect(down).toBe(false); // default prevented
    fireEvent.touchStart(el, { touches: [{ clientY: 300 }] });
    const up = fireEvent.touchMove(el, { touches: [{ clientY: 280 }] });
    expect(up).toBe(true);
  });

  it("a tap that interrupts a snap animation snaps back instead of stopping mid-way", () => {
    setup({ snap: "mid" });
    fireEvent.pointerDown(list(), { clientX: 50, clientY: 500 });
    act(() => y().set(520)); // the drag session stopped the spring here
    fireEvent.pointerUp(window, { clientX: 50, clientY: 500 });
    expect(fm.animate).toHaveBeenCalledWith(y(), 440, expect.anything());
  });

  it("frozen ignores a container resize", () => {
    const onVisibleHeight = vi.fn();
    const { rerender } = setup({ snap: "mid", onVisibleHeight });
    onVisibleHeight.mockClear();
    rerender(ui({ snap: "mid", frozen: true, onVisibleHeight }));
    resize(500); // keyboard opened
    expect(fm.animate).not.toHaveBeenCalled();
    expect(panel().style.height).toBe("650px");
    expect(onVisibleHeight).not.toHaveBeenCalled();
    // keyboard closed at a new size: the sheet catches up
    rerender(ui({ snap: "mid", frozen: false, onVisibleHeight }));
    // 500px frame: high 150, mid 275, low 428
    expect(fm.animate).toHaveBeenCalledWith(y(), 275, expect.anything());
    expect(onVisibleHeight).toHaveBeenCalledWith(225);
  });

  it("onVisibleHeight reports once per settled snap", () => {
    const onVisibleHeight = vi.fn();
    const { rerender } = render(ui({ snap: "low", onVisibleHeight }));
    resize(800);
    expect(onVisibleHeight).toHaveBeenCalledTimes(1);
    expect(onVisibleHeight).toHaveBeenLastCalledWith(72);

    // dragging moves y frame by frame without reporting
    act(() => {
      y().set(600);
      y().set(500);
    });
    expect(onVisibleHeight).toHaveBeenCalledTimes(1);

    release(450);
    rerender(ui({ snap: "mid", onVisibleHeight }));
    expect(onVisibleHeight).toHaveBeenCalledTimes(2);
    expect(onVisibleHeight).toHaveBeenLastCalledWith(360);

    // re-rendering at the same snap does not report again
    rerender(ui({ snap: "mid", onVisibleHeight }));
    expect(onVisibleHeight).toHaveBeenCalledTimes(2);

    // a container resize does
    resize(700);
    expect(onVisibleHeight).toHaveBeenCalledTimes(3);
  });

  describe("fix round 1", () => {
    it("at low a pointerdown anywhere on the visible panel starts a drag", () => {
      setup({ snap: "low" });
      // the strip of inert list below the handle is not a hit target in a
      // browser, so the event lands on the panel itself
      fireEvent.pointerDown(panel(), { clientY: 790 });
      expect(fm.start).toHaveBeenCalledTimes(1);
      expect(panel().style.touchAction).toBe("none");
    });

    it("at mid a pointerdown on the panel outside the list starts a drag", () => {
      setup({ snap: "mid" });
      fireEvent.pointerDown(panel(), { clientY: 450 });
      expect(fm.start).toHaveBeenCalledTimes(1);
    });

    it("at high the panel leaves touch-action to the list", () => {
      setup({ snap: "high" });
      expect(panel().style.touchAction).toBe("");
      fireEvent.pointerDown(list(), { clientY: 300 });
      expect(fm.start).not.toHaveBeenCalled();
    });

    it("a target change during a drag does not animate until release", () => {
      const onSnapChange = vi.fn();
      const { rerender } = setup({ snap: "high", onSnapChange });
      fireEvent.pointerDown(screen.getByTestId("venue-sheet-handle"), {
        clientX: 10,
        clientY: 160,
      });
      fireEvent.pointerMove(window, { clientX: 10, clientY: 220 });
      act(() => y().set(210));
      rerender(ui({ snap: "high", onSnapChange, topReserve: 200 }));
      expect(fm.animate).not.toHaveBeenCalled();
      fireEvent.pointerUp(window, { clientX: 10, clientY: 220 });
      release(210);
      expect(fm.animate).toHaveBeenCalledTimes(1);
      expect(fm.animate).toHaveBeenCalledWith(y(), 200, expect.anything());
    });

    it("a tap that spans a target change snaps to the new target", () => {
      const { rerender } = setup({ snap: "high" });
      fireEvent.pointerDown(screen.getByTestId("venue-sheet-handle"), {
        clientX: 10,
        clientY: 160,
      });
      rerender(ui({ snap: "high", topReserve: 200 }));
      expect(fm.animate).not.toHaveBeenCalled();
      fireEvent.pointerUp(window, { clientX: 10, clientY: 160 });
      expect(fm.animate).toHaveBeenCalledWith(y(), 200, expect.anything());
    });

    it("with reduced motion every snap is instant instead of a spring", () => {
      fm.reducedMotion = true;
      const { rerender } = setup({ snap: "low" });
      rerender(ui({ snap: "high" }));
      expect(fm.animate).toHaveBeenLastCalledWith(y(), 150, { duration: 0 });
      release(470);
      expect(fm.animate).toHaveBeenLastCalledWith(y(), 440, { duration: 0 });
    });

    it("without reduced motion the snap uses a spring", () => {
      const { rerender } = setup({ snap: "low" });
      rerender(ui({ snap: "high" }));
      expect(fm.animate).toHaveBeenLastCalledWith(
        y(),
        150,
        expect.objectContaining({ type: "spring" }),
      );
    });

    it("the title button names its action and controls the list", () => {
      setup({ snap: "mid" });
      const title = screen.getByRole("button", { expanded: true });
      expect(title.getAttribute("aria-controls")).toBe(list().id);
      expect(list().id).not.toBe("");
      expect(title.textContent).toBe("12 sân, Mở rộng hoặc thu gọn danh sách");
    });

    it("leaving high scrolls the list back to the top", () => {
      const { rerender } = setup({ snap: "high" });
      list().scrollTop = 240;
      rerender(ui({ snap: "mid" }));
      expect(list().scrollTop).toBe(0);
    });
  });
});
