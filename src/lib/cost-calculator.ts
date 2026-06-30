import { roundToThousand } from "./utils";
import { isDefaultSessionDay } from "./date-format";

/**
 * Tính tổng tiền sân cho 1 buổi.
 *
 * Quy tắc kinh doanh (theo yêu cầu admin tháng 5/2026):
 * - "Buổi mặc định" = chơi đúng `defaultCourtId` VÀO ngày subscription (T2/T4/T6).
 *   Sân thứ 1 ăn giá tháng (`pricePerSession` = 200K), sân thứ 2..N ăn giá lẻ
 *   (`pricePerSessionRetail` = 220K, fallback giá tháng nếu chưa cấu hình).
 * - "Buổi lẻ" = thuê sân khác sân mặc định, HOẶC chơi vào ngày khác T2/T4/T6.
 *   TẤT CẢ sân (kể cả sân thứ 1) đều ăn giá lẻ — admin không được "subsidy"
 *   khi đặt buổi ngoài lịch cố định.
 *
 * Pure function — không đụng DB. Caller pass đầy đủ context.
 */
export function computeCourtTotal(input: {
  monthlyPrice: number;
  retailPrice: number | null;
  courtQuantity: number;
  /** YYYY-MM-DD theo VN local. */
  sessionDate: string;
  selectedCourtId: number;
  defaultCourtId: number | null;
  /**
   * Days of week (0=Sun..6=Sat) considered "regular subscription days".
   * Admin có thể configure qua `getSessionDaysOfWeek()` — server caller
   * BẮT BUỘC truyền cái này; client preview có thể bỏ qua → fallback M/W/F.
   */
  sessionDays?: readonly number[] | number[];
}): number {
  const monthly = input.monthlyPrice;
  const retail = input.retailPrice ?? monthly;
  const qty = Math.max(1, input.courtQuantity);
  const isRegular =
    input.defaultCourtId !== null &&
    input.selectedCourtId === input.defaultCourtId &&
    isDefaultSessionDay(input.sessionDate, input.sessionDays);
  if (isRegular) {
    return monthly + retail * (qty - 1);
  }
  return retail * qty;
}

export interface AttendeeInput {
  memberId: number | null;
  guestName?: string | null;
  invitedById: number | null;
  isGuest: boolean;
  attendsPlay: boolean;
  attendsDine: boolean;
  /** Số đầu người attendee đại diện ở phần của CHÍNH họ (member "đi 2 người" → 2).
   *  Guest = 1. Mặc định 1 nếu không truyền (backward-compat). */
  headcount?: number;
}

export interface ShuttlecockInput {
  quantityUsed: number; // in qua (individual shuttlecocks)
  pricePerTube: number; // snapshot price per tube (12 qua)
}

export interface SessionInput {
  courtPrice: number;
  diningBill: number;
}

export interface MemberDebt {
  memberId: number;
  playAmount: number;
  dineAmount: number;
  guestPlayAmount: number;
  /** Số khách CHƠI của member này (thông tin; khách không còn bị floor riêng). */
  guestPlayCount: number;
  guestDineAmount: number;
  totalAmount: number;
}

export interface CostBreakdown {
  courtPrice: number;
  totalShuttlecockCost: number;
  totalPlayCost: number;
  diningBill: number;
  totalPlayers: number;
  totalDiners: number;
  /** Đơn giá CHƠI mỗi đầu cho NHÓM CHIA ĐỀU = members + khách-của-member.
   *  Khi có khách-của-admin và naive < 60K, số này thấp hơn naive vì nhóm chia
   *  đều gánh phần còn lại sau khi khách-admin trả sàn 60K. */
  playCostPerHead: number;
  /** Đơn giá CHƠI mỗi đầu cho KHÁCH-CỦA-ADMIN = 60K khi bị floor (naive < 60K),
   *  bằng `playCostPerHead` khi không floor. Khách-của-member KHÔNG dùng số này
   *  — họ chia đều theo `playCostPerHead`. */
  adminGuestPlayCostPerHead: number;
  dineCostPerHead: number;
  memberDebts: MemberDebt[];
}

/**
 * Calculate cost of shuttlecocks based on quantity and price per tube (12 pieces).
 * Rounded UP to nearest 1000 VND to avoid admin loss if needed,
 * but since we sum first, we'll return the exact float,
 * and round at the very end or where needed.
 * Actually, to be perfectly safe, we should round up the total shuttlecock cost per session.
 */
export function calculateShuttlecockCost(
  quantityUsed: number,
  pricePerTube: number,
): number {
  return roundToThousand((quantityUsed * pricePerTube) / 12);
}

export function calculateExactShuttlecockCost(
  quantityUsed: number,
  pricePerTube: number,
): number {
  return (quantityUsed * pricePerTube) / 12;
}

/**
 * Member-poverty floor cho 1 buổi. Áp khi `sessions.use_min_deduction = true`
 * (member có thể miễn qua `session_min_deduction_exemptions`). Floor mặc định
 * 60K — hardcode trước (nếu cần admin đổi sẽ thêm app_setting sau).
 *
 * CHỈ floor PLAY của CHÍNH member: member CHƠI + thiếu quỹ trả play share +
 * share < floor → nâng `playAmount` lên `floor`. Member đủ quỹ → không phạt.
 *
 * KHÔNG floor khách: khách-của-admin đã được sàn 60K trong `calculateSessionCosts`;
 * khách-của-member chia đều (không có sàn). KHÔNG floor `dineAmount` /
 * `guestDineAmount` (nhậu tự nguyện). Round-up rule giữ nguyên — admin không lỗ.
 */
export const MIN_DEDUCTION_PER_HEAD = 60_000;

export function applyMinDeductionFloor(
  debt: MemberDebt,
  balance: number,
  floor: number = MIN_DEDUCTION_PER_HEAD,
): MemberDebt {
  // Chỉ floor PLAY của CHÍNH member: người chơi, thiếu quỹ, và share < floor.
  // KHÔNG floor khách (khách-admin đã sàn 60K ở calculateSessionCosts; khách-member
  // chia đều, không sàn).
  const playAmount =
    debt.playAmount > 0 && balance < debt.playAmount && debt.playAmount < floor
      ? floor
      : debt.playAmount;

  if (playAmount === debt.playAmount) {
    return debt; // không đổi gì
  }
  return {
    ...debt,
    playAmount,
    totalAmount:
      playAmount +
      debt.dineAmount +
      debt.guestPlayAmount +
      debt.guestDineAmount,
  };
}

/**
 * Predict min-60K penalty surplus that will flow to admin's fund when a
 * session is finalized. For each playing member with balance below
 * `playCostPerHead` (and not exempt), the floor overrides their playAmount
 * to 60K — admin captures the (60K − playPerHead) difference.
 *
 * Returns 0 if floor disabled, playCostPerHead ≥ floor, or no members
 * qualify. Pure function — caller passes member list, balances, exempt set.
 *
 * Used by upcoming/past-pending session UIs to show accurate "Tổng thu
 * dự kiến" instead of plain `playerCount × playPerHead` (which underestimates
 * revenue by Σ penalty surplus).
 *
 * NOTE: does not exclude admin since admin's balance is typically high
 * enough that floor wouldn't fire. If admin's balance happens to be low,
 * `finalizeSession` still skips them via memberId check — predicted slightly
 * overestimates in that edge case.
 */
export function computePredictedMinDeductionSurplus(input: {
  playingMemberIds: ReadonlyArray<number>;
  memberBalances: Readonly<Record<number, number>>;
  exemptMemberIds: ReadonlyArray<number>;
  playCostPerHead: number;
  /** headcount của từng member chơi (memberId → 1|2). Thiếu → coi như 1. */
  playingMemberHeadcounts?: Readonly<Record<number, number>>;
  floor?: number;
}): number {
  const floor = input.floor ?? MIN_DEDUCTION_PER_HEAD;
  if (input.playCostPerHead >= floor) return 0;
  if (input.playCostPerHead <= 0) return 0;
  const exemptSet = new Set(input.exemptMemberIds);
  let surplus = 0;
  for (const memberId of input.playingMemberIds) {
    if (exemptSet.has(memberId)) continue;
    const balance = input.memberBalances[memberId] ?? 0;
    const headcount = input.playingMemberHeadcounts?.[memberId] ?? 1;
    const playAmount = input.playCostPerHead * headcount;
    if (balance < playAmount && playAmount < floor) {
      surplus += floor - playAmount;
    }
  }
  // Khách KHÔNG tạo surplus quỹ: khách-admin trả sàn 60K nhưng phần dư giảm cho
  // nhóm chia đều (xem calculateSessionCosts), khách-member chia đều. Chỉ member
  // nghèo (member-poverty floor) mới tạo surplus vào quỹ admin.
  return surplus;
}

/**
 * Total shuttlecock cost across MULTIPLE brands in a session — exact sum
 * first, then round UP to 1k tổng. Khớp với rule trong `calculateSessionCosts`
 * (finalize) để UI preview KHÔNG drift so với debt thực ghi vào DB.
 *
 * Vì sao tách thành helper: `reduce((sum, b) => sum + calculateShuttlecockCost(b))`
 * round UP per brand rồi mới sum → tổng có thể HIGHER hơn `roundToThousand(sum_exact)`
 * khi nhiều brand. Per-brand round dùng cho hiển thị chi tiết từng brand,
 * nhưng tổng buổi BẮT BUỘC qua helper này.
 *
 * Round UP semantics giữ nguyên — admin không bao giờ underpay.
 */
export function computeShuttlecockTotal(
  shuttlecocks: ReadonlyArray<{
    quantityUsed: number;
    pricePerTube: number;
  }>,
): number {
  const exact = shuttlecocks.reduce(
    (sum, s) =>
      sum + calculateExactShuttlecockCost(s.quantityUsed, s.pricePerTube),
    0,
  );
  return roundToThousand(exact);
}

/**
 * Pure per-head cost helper. Same rounding rules as `calculateSessionCosts`
 * (round UP to next 1k via `roundToThousand`), but exposes only the two
 * per-head numbers — useful for UI summaries where we already know totals
 * and just need to display "ai trả bao nhiêu một suất".
 *
 * Returns `0` when the divisor is 0 to avoid `Infinity` / `NaN` propagating
 * into UI.
 */
/**
 * Pure: tách rate CHƠI khi có khách-của-admin. Khách-admin trả sàn `floor`
 * (mặc định 60K) khi naive perHead < floor VÀ có nhóm chia đều; phần còn lại
 * chia cho nhóm chia đều (members + khách-của-member). Không có khách-admin
 * hoặc naive ≥ floor → mọi người = naive. SINGLE SOURCE: dùng chung bởi
 * `calculateSessionCosts` (finalize) và `computePerHeadCharges` (preview) để
 * preview KHÔNG bao giờ drift so với debt thực ghi vào DB.
 */
export function computeGuestAwarePlayRates(input: {
  totalPlayCost: number;
  totalPlayHeads: number;
  adminGuestPlayHeads: number;
  floor?: number;
}): { playCostPerHead: number; adminGuestPlayCostPerHead: number } {
  const floor = input.floor ?? MIN_DEDUCTION_PER_HEAD;
  const raw =
    input.totalPlayHeads > 0 ? input.totalPlayCost / input.totalPlayHeads : 0;
  const splitHeads = input.totalPlayHeads - input.adminGuestPlayHeads;
  if (
    input.adminGuestPlayHeads > 0 &&
    splitHeads > 0 &&
    raw > 0 &&
    raw < floor
  ) {
    const splitCost = input.totalPlayCost - floor * input.adminGuestPlayHeads;
    // Khách-admin trả > tiền sân (hiếm) → split = 0, Math.max chặn âm.
    return {
      playCostPerHead: roundToThousand(Math.max(0, splitCost / splitHeads)),
      adminGuestPlayCostPerHead: floor,
    };
  }
  const rate = roundToThousand(raw);
  return { playCostPerHead: rate, adminGuestPlayCostPerHead: rate };
}

export function computePerHeadCharges(input: {
  courtPrice: number;
  shuttlecockCost: number;
  diningBill: number;
  playerCount: number;
  dinerCount: number;
  /** Số đầu khách-của-admin (host = admin). Mặc định 0 → naive equal split.
   *  Truyền vào để preview phản ánh sàn 60K khách-admin + chia lại cho member. */
  adminGuestPlayHeads?: number;
  floor?: number;
}): {
  playCostPerHead: number;
  adminGuestPlayCostPerHead: number;
  dineCostPerHead: number;
} {
  const { playCostPerHead, adminGuestPlayCostPerHead } =
    computeGuestAwarePlayRates({
      totalPlayCost: input.courtPrice + input.shuttlecockCost,
      totalPlayHeads: input.playerCount,
      adminGuestPlayHeads: input.adminGuestPlayHeads ?? 0,
      floor: input.floor,
    });
  const dineCostPerHead =
    input.dinerCount > 0
      ? roundToThousand(input.diningBill / input.dinerCount)
      : 0;
  return { playCostPerHead, adminGuestPlayCostPerHead, dineCostPerHead };
}

/**
 * Predicted PLAY revenue cho preview: nhóm chia đều × splitRate + khách-của-admin
 * × sàn. KHÔNG gồm nhậu / penalty surplus (caller cộng riêng). Tách helper để
 * session-list + dashboard không hand-roll công thức (tránh drift khi đổi rule).
 */
export function computePredictedPlayRevenue(input: {
  totalPlayHeads: number;
  adminGuestPlayHeads: number;
  playCostPerHead: number;
  adminGuestPlayCostPerHead: number;
}): number {
  const splitHeads = input.totalPlayHeads - input.adminGuestPlayHeads;
  return (
    splitHeads * input.playCostPerHead +
    input.adminGuestPlayHeads * input.adminGuestPlayCostPerHead
  );
}

/**
 * Pure cost calculation function.
 *
 * Algorithm (from spec 5.5):
 * 1. Count all players (members + guests) and diners (members + guests)
 * 2. play_cost_per_head = (court_price + total_shuttlecock_cost) / total_players
 * 3. dine_cost_per_head = dining_bill / total_diners
 * 4. Round per-head costs up to the next 1000 VND
 * 5. For each member: own play + own dine + (guests_play * play_cost) + (guests_dine * dine_cost)
 *
 * Shuttlecock cost = SUM(quantity_used * price_per_tube / 12) per brand
 */
export function calculateSessionCosts(
  session: SessionInput,
  attendees: AttendeeInput[],
  shuttlecocks: ShuttlecockInput[],
  opts?: { floor?: number; adminMemberId?: number | null },
): CostBreakdown {
  // 1. Separate players and diners (all, including guests)
  const allPlayers = attendees.filter((a) => a.attendsPlay);
  const allDiners = attendees.filter((a) => a.attendsDine);

  const totalPlayers = allPlayers.reduce((s, a) => s + (a.headcount ?? 1), 0);
  const totalDiners = allDiners.reduce((s, a) => s + (a.headcount ?? 1), 0);

  // 2. Calculate shuttlecock cost: each qua costs price_per_tube / 12
  const totalShuttlecockCostExact = shuttlecocks.reduce((sum, s) => {
    return sum + calculateExactShuttlecockCost(s.quantityUsed, s.pricePerTube);
  }, 0);
  const totalShuttlecockCost = roundToThousand(totalShuttlecockCostExact);

  // 3. Calculate per-head costs
  const totalPlayCost = session.courtPrice + totalShuttlecockCost;
  const rawDineCostPerHead =
    totalDiners > 0 ? session.diningBill / totalDiners : 0;

  // 4. Round up to the next 1000 VND so the admin is not underpaid.
  const dineCostPerHead = roundToThousand(rawDineCostPerHead);

  // KHÁCH-CỦA-ADMIN trả sàn 60K; KHÁCH-CỦA-MEMBER chia đều như member.
  // Rate tính qua helper dùng chung `computeGuestAwarePlayRates` (cũng dùng cho
  // preview ở computePerHeadCharges) → finalize và preview không bao giờ drift.
  // Member-poverty floor vẫn xử lý riêng ở `applyMinDeductionFloor`.
  const floor = opts?.floor ?? MIN_DEDUCTION_PER_HEAD;
  const adminMemberId = opts?.adminMemberId ?? null;
  const adminGuestPlayHeads = allPlayers
    .filter((a) => a.isGuest && a.invitedById === adminMemberId)
    .reduce((s, a) => s + (a.headcount ?? 1), 0);
  const { playCostPerHead, adminGuestPlayCostPerHead } =
    computeGuestAwarePlayRates({
      totalPlayCost,
      totalPlayHeads: totalPlayers,
      adminGuestPlayHeads,
      floor,
    });

  // 5. Calculate per-member debts
  // Include both: members attending directly, AND hosts who invited guests
  // (kể cả khi host không play/dine, vẫn phải tạo debt row cho khách).
  // Trước đây chỉ collect từ non-guest attendees → admin chỉ có khách (không
  // play) bị bỏ qua → session.totalDebt thiếu phần khách → display LỖ.
  const memberIds = new Set<number>();
  for (const a of attendees) {
    if (!a.isGuest && a.memberId !== null) {
      memberIds.add(a.memberId);
    } else if (a.isGuest && a.invitedById !== null) {
      memberIds.add(a.invitedById);
    }
  }

  const memberDebts: MemberDebt[] = [];

  for (const memberId of memberIds) {
    // Does this member play? (not as a guest)
    const memberPlays = attendees.some(
      (a) => a.memberId === memberId && !a.isGuest && a.attendsPlay,
    );
    // Does this member dine? (not as a guest)
    const memberDines = attendees.some(
      (a) => a.memberId === memberId && !a.isGuest && a.attendsDine,
    );

    // Count guests invited by this member
    const guestsPlay = attendees.filter(
      (a) => a.isGuest && a.invitedById === memberId && a.attendsPlay,
    ).length;
    const guestsDine = attendees.filter(
      (a) => a.isGuest && a.invitedById === memberId && a.attendsDine,
    ).length;

    // headcount của row member (không phải guest). Người đi cùng = +1 đầu do
    // member tự trả → gộp vào playAmount/dineAmount của member, KHÔNG vào guest.
    const memberHeadcount =
      attendees.find((a) => a.memberId === memberId && !a.isGuest)?.headcount ??
      1;
    const playAmount = memberPlays ? playCostPerHead * memberHeadcount : 0;
    const dineAmount = memberDines ? dineCostPerHead * memberHeadcount : 0;
    // Khách-của-admin trả sàn (adminGuestPlayCostPerHead); khách-của-member chia
    // đều theo playCostPerHead. Mỗi host chỉ có 1 loại khách (admin → khách-admin,
    // member khác → khách-member) nên phân loại theo host là đủ.
    const guestPlayRate =
      memberId === adminMemberId ? adminGuestPlayCostPerHead : playCostPerHead;
    const guestPlayAmount = guestsPlay * guestPlayRate;
    const guestDineAmount = guestsDine * dineCostPerHead;
    const totalAmount =
      playAmount + dineAmount + guestPlayAmount + guestDineAmount;

    if (totalAmount > 0) {
      memberDebts.push({
        memberId,
        playAmount,
        dineAmount,
        guestPlayAmount,
        guestPlayCount: guestsPlay,
        guestDineAmount,
        totalAmount,
      });
    }
  }

  return {
    courtPrice: session.courtPrice,
    totalShuttlecockCost,
    totalPlayCost,
    diningBill: session.diningBill,
    totalPlayers,
    totalDiners,
    playCostPerHead,
    adminGuestPlayCostPerHead,
    dineCostPerHead,
    memberDebts,
  };
}
