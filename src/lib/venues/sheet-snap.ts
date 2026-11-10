/**
 * Pure snap math for the venues bottom sheet. Offsets are the y of the sheet's
 * top edge measured from the top of the map frame, so a bigger offset means a
 * lower (more collapsed) sheet.
 */

export type SheetSnap = "low" | "mid" | "high";

/** How much of the sheet stays visible at `low`: the handle and the title. */
export const SHEET_PEEK_PX = 72;

/** Release speed (px/s) above which a swipe jumps one snap instead of settling to the nearest. */
export const SNAP_VELOCITY = 500;

/** Minimum gap between `mid` and either end, so each snap is a distinct position. */
const MID_MARGIN_PX = 48;

/** Snaps ordered from top (smallest offset) to bottom. */
const TOP_DOWN: readonly SheetSnap[] = ["high", "mid", "low"];

/**
 * Top-edge offsets for each snap in a frame `containerH` tall, with the
 * floating controls taking `topReserve` px at the top.
 *
 * The values are kept ordered and non-negative even for a frame that is not
 * measured yet (0) or too short for both margins, so drag constraints never
 * invert.
 */
export function snapOffsets(
  containerH: number,
  topReserve: number,
): Record<SheetSnap, number> {
  const low = Math.max(0, containerH - SHEET_PEEK_PX);
  const high = Math.min(Math.max(0, topReserve), low);
  const lo = high + MID_MARGIN_PX;
  const hi = low - MID_MARGIN_PX;
  const mid =
    lo > hi
      ? Math.round((high + low) / 2)
      : Math.min(Math.max(Math.round(containerH * 0.55), lo), hi);
  return { high, mid, low };
}

/**
 * Where a released sheet should come to rest. A fast swipe (|v| above
 * {@link SNAP_VELOCITY}) moves one snap past the one nearest to `y` in the
 * swipe direction, stopping at either end; otherwise the nearest snap wins.
 */
export function settleSnap(
  offsets: Record<SheetSnap, number>,
  y: number,
  velocityY: number,
): SheetSnap {
  let nearest = 0;
  for (let i = 1; i < TOP_DOWN.length; i++) {
    if (
      Math.abs(offsets[TOP_DOWN[i]] - y) <
      Math.abs(offsets[TOP_DOWN[nearest]] - y)
    ) {
      nearest = i;
    }
  }
  if (Math.abs(velocityY) <= SNAP_VELOCITY) return TOP_DOWN[nearest];
  const step = velocityY < 0 ? -1 : 1;
  const next = Math.min(Math.max(nearest + step, 0), TOP_DOWN.length - 1);
  return TOP_DOWN[next];
}

/** Tapping the sheet title cycles low → mid → high → low. */
export function nextSnapOnTap(s: SheetSnap): SheetSnap {
  if (s === "low") return "mid";
  if (s === "mid") return "high";
  return "low";
}
