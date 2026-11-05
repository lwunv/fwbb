import { HOLDING_STATUSES } from "./constants";

/** Thông tin sự kiện cần để đếm slot. `reserveReleaseAt` là ISO UTC (có `Z`) hoặc null. */
export type SlotEvent = {
  slotsTotal: number;
  femaleReservedSlots: number;
  /** null = suất dành cho nữ không bao giờ mở cho nam. */
  reserveReleaseAt: string | null;
};

export type SlotReg = {
  id: number;
  status: string;
  maleCount: number;
  femaleCount: number;
  waitlistPos: number | null;
};

export type SlotState = {
  usedTotal: number;
  usedMale: number;
  maleCap: number;
  freeTotal: number;
  freeForMale: number;
  freeFemaleOnly: number;
  full: boolean;
};

const isHolding = (status: string): boolean =>
  (HOLDING_STATUSES as readonly string[]).includes(status);

/**
 * Đếm slot đang giữ (pending/approved; waitlist không giữ). Host không phải
 * đăng ký nên không được tính ở đây. Sự kiện chỉ "full" khi không còn slot
 * nào, kể cả slot chỉ dành cho nữ.
 */
export function slotState(
  ev: SlotEvent,
  regs: readonly SlotReg[],
  now: Date,
): SlotState {
  let usedTotal = 0;
  let usedMale = 0;
  for (const r of regs) {
    if (!isHolding(r.status)) continue;
    usedTotal += r.maleCount + r.femaleCount;
    usedMale += r.maleCount;
  }
  // So sánh bằng Date, không so chuỗi.
  const released =
    ev.reserveReleaseAt !== null &&
    new Date(ev.reserveReleaseAt).getTime() <= now.getTime();
  const maleCap = released
    ? ev.slotsTotal
    : ev.slotsTotal - ev.femaleReservedSlots;
  const freeTotal = Math.max(0, ev.slotsTotal - usedTotal);
  const freeForMale = Math.max(0, Math.min(freeTotal, maleCap - usedMale));
  return {
    usedTotal,
    usedMale,
    maleCap,
    freeTotal,
    freeForMale,
    freeFemaleOnly: freeTotal - freeForMale,
    full: freeTotal === 0,
  };
}

/** Một nhóm chỉ vào khi đủ chỗ cho cả nhóm, không nhận một phần. */
export function fits(
  state: Pick<SlotState, "freeTotal" | "freeForMale">,
  r: Pick<SlotReg, "maleCount" | "femaleCount">,
): boolean {
  return (
    r.maleCount + r.femaleCount <= state.freeTotal &&
    r.maleCount <= state.freeForMale
  );
}

/**
 * Duyệt danh sách chờ theo `waitlistPos`, cho lên người nào vừa chỗ (first-fit)
 * và cập nhật state sau mỗi lần để người sau thấy chỗ đã bị giữ. Không đổi mảng vào.
 */
export function promoteFirstFit(
  ev: SlotEvent,
  regs: readonly SlotReg[],
  now: Date,
): number[] {
  const queue = regs
    .filter((r) => r.status === "waitlist")
    .sort((a, b) => (a.waitlistPos ?? 0) - (b.waitlistPos ?? 0));
  const working: SlotReg[] = regs.map((r) => ({ ...r }));
  const promoted: number[] = [];
  for (const q of queue) {
    const state = slotState(ev, working, now);
    if (!fits(state, q)) continue;
    const w = working.find((r) => r.id === q.id);
    if (w) w.status = "approved";
    promoted.push(q.id);
  }
  return promoted;
}

/** Vị trí kế tiếp trong danh sách chờ. */
export function nextWaitlistPos(regs: readonly SlotReg[]): number {
  let max = 0;
  for (const r of regs) {
    if (r.waitlistPos !== null && r.waitlistPos > max) max = r.waitlistPos;
  }
  return max + 1;
}
