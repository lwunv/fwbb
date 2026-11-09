"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  type PanInfo,
} from "framer-motion";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  nextSnapOnTap,
  settleSnap,
  snapOffsets,
  type SheetSnap,
} from "@/lib/venues/sheet-snap";

const SHEET_SPRING = { type: "spring", stiffness: 420, damping: 42 } as const;

/** Same distance framer-motion needs before a pointer counts as a drag. */
const DRAG_SLOP_PX = 3;

/** How far a finger must pull down from the top of the list at `high` before the sheet takes over. */
const PULL_TO_COLLAPSE_PX = 8;

type Gesture = { x: number; y: number; moved: boolean };

export function VenueSheet({
  snap,
  onSnapChange,
  title,
  children,
  topReserve,
  frozen = false,
  onVisibleHeight,
  onDragClose,
}: {
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  title: ReactNode;
  children: ReactNode;
  /** Px at the top of the frame taken by the floating controls; `high` stops here. */
  topReserve: number;
  /** True while the search box has focus: a keyboard resize must not move the sheet. */
  frozen?: boolean;
  /** Visible sheet height once it rests at a snap or the frame resizes, never per drag frame. */
  onVisibleHeight?: (px: number) => void;
  /** When set, a drag released at `low` calls this instead of `onSnapChange`. */
  onDragClose?: () => void;
}) {
  const t = useTranslations("venues");
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const controls = useDragControls();

  const [rawH, setRawH] = useState(0);
  // While frozen, keep laying out against the height from the moment it froze
  // (state adjusted during render, so the held value is in place on the same pass).
  const [hold, setHold] = useState({ frozen, h: 0 });
  if (hold.frozen !== frozen) setHold({ frozen, h: rawH });
  const containerH = frozen && hold.h > 0 ? hold.h : rawH;
  const measured = containerH > 0;

  const offsets = useMemo(
    () => snapOffsets(containerH, topReserve),
    [containerH, topReserve],
  );
  const target = offsets[snap];

  const y = useMotionValue(target);
  /** Offset the sheet was last sent to; null until it is first placed. */
  const targetRef = useRef<number | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const pullRef = useRef<{ startY: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver((entries) => {
        const last = entries[entries.length - 1];
        if (last) setRawH(last.contentRect.height);
      });
      ro.observe(el);
      return () => ro.disconnect();
    }
    const onResize = () => setRawH(window.innerHeight);
    const raf = requestAnimationFrame(onResize);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Snap changes from the parent and frame resizes both end here. The drag
  // release animates on its own (see handleDragEnd) and records its target,
  // so the parent echoing that snap back does not restart the spring.
  useLayoutEffect(() => {
    if (!measured || targetRef.current === target) return;
    if (targetRef.current === null) {
      y.set(target);
    } else {
      animate(y, target, SHEET_SPRING);
    }
    targetRef.current = target;
  }, [measured, target, y]);

  const reportVisible = useEffectEvent((px: number) => onVisibleHeight?.(px));
  const visible = measured ? containerH - target : null;
  useEffect(() => {
    if (visible !== null) reportVisible(visible);
  }, [visible]);

  // At `high` the list scrolls natively (pan-y). Pulling down from its top
  // would otherwise start an overscroll/pull-to-refresh and cancel our pointer
  // stream in iOS and in-app browsers, so that one case is kept from the browser.
  useEffect(() => {
    const el = listRef.current;
    if (!el || snap !== "high") return;
    let startY = 0;
    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const cy = e.touches[0]?.clientY;
      if (cy !== undefined && el.scrollTop <= 0 && cy - startY > 0) {
        e.preventDefault();
      }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [snap]);

  function beginDrag(e: ReactPointerEvent, alreadyMoved = false) {
    const g: Gesture = { x: e.clientX, y: e.clientY, moved: alreadyMoved };
    gestureRef.current = g;
    controls.start(e);
    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) >= DRAG_SLOP_PX) {
        g.moved = true;
      }
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      // Starting a drag session stops any running snap spring. A plain tap
      // never reaches onDragEnd, so put the sheet back on its snap here.
      const to = targetRef.current;
      if (!g.moved && to !== null && y.get() !== to) {
        animate(y, to, SHEET_SPRING);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

  function handleDragEnd(_: unknown, info: PanInfo) {
    const next = settleSnap(offsets, y.get(), info.velocity.y);
    // Always animate, even back to the snap it started from: a declarative
    // target that did not change would leave the sheet where it was dropped.
    targetRef.current = offsets[next];
    animate(y, offsets[next], SHEET_SPRING);
    if (next === "low" && onDragClose) onDragClose();
    else onSnapChange(next);
  }

  /** True for the click that a pointer drag ends with (keyboard clicks have detail 0). */
  function isDragClick(e: ReactMouseEvent) {
    return e.detail !== 0 && gestureRef.current?.moved === true;
  }

  function onListPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (snap !== "high") {
      beginDrag(e);
      return;
    }
    // A plain scroll or tap at `high`: forget the previous gesture so its
    // drag does not swallow this click.
    gestureRef.current = null;
    const pull = { startY: e.clientY };
    pullRef.current = pull;
    const clear = () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
      if (pullRef.current === pull) pullRef.current = null;
    };
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
  }

  function onListPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const pull = pullRef.current;
    if (snap !== "high" || !pull) return;
    if (
      e.currentTarget.scrollTop <= 0 &&
      e.clientY - pull.startY > PULL_TO_COLLAPSE_PX
    ) {
      pullRef.current = null;
      beginDrag(e, true);
    }
  }

  const panelH = containerH - offsets.high;
  // Only follows the settled snap, never the live drag position.
  const hiddenPx = offsets[snap] - offsets.high;
  const collapsed = snap === "low";

  return (
    <div
      ref={containerRef}
      data-testid="venue-sheet"
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden md:hidden"
    >
      <motion.div
        data-testid="venue-sheet-panel"
        className="bg-card/95 border-border/60 pointer-events-auto absolute inset-x-0 top-0 flex flex-col rounded-t-3xl border border-b-0 shadow-[0_-8px_30px_-12px_rgb(0_0_0/0.25)] backdrop-blur-md"
        style={{
          y,
          height: panelH,
          visibility: measured ? undefined : "hidden",
        }}
        drag="y"
        dragListener={false}
        dragControls={controls}
        dragMomentum={false}
        dragConstraints={{ top: offsets.high, bottom: offsets.low }}
        dragElastic={0.05}
        onDragEnd={handleDragEnd}
      >
        <div
          data-testid="venue-sheet-handle"
          className="flex min-h-14 shrink-0 cursor-grab flex-col items-center select-none active:cursor-grabbing"
          style={{ touchAction: "none" }}
          onPointerDown={(e) => beginDrag(e)}
        >
          <span
            aria-hidden="true"
            className="bg-muted-foreground/40 mt-2 h-1.5 w-10 rounded-full"
          />
          <button
            type="button"
            aria-expanded={snap !== "low"}
            className="text-foreground focus-visible:ring-ring/50 flex min-h-11 w-full items-center justify-center rounded-xl px-4 pb-1 text-base font-semibold outline-none focus-visible:ring-2"
            onClick={(e) => {
              if (isDragClick(e)) return;
              onSnapChange(nextSnapOnTap(snap));
            }}
          >
            {title}
            <span className="sr-only">{t("sheetHandle")}</span>
          </button>
        </div>
        <div
          ref={listRef}
          data-testid="venue-sheet-list"
          inert={collapsed}
          aria-hidden={collapsed ? true : undefined}
          className={cn(
            "min-h-0 flex-1 overscroll-y-contain",
            snap === "high" ? "overflow-y-auto" : "overflow-hidden",
          )}
          style={{
            touchAction: snap === "high" ? "pan-y" : "none",
            paddingBottom: `calc(${hiddenPx}px + env(safe-area-inset-bottom))`,
          }}
          onPointerDown={onListPointerDown}
          onPointerMove={onListPointerMove}
          onClickCapture={(e) => {
            if (!isDragClick(e)) return;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {children}
        </div>
      </motion.div>
    </div>
  );
}
