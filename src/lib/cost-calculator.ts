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
  /** Số khách CHƠI của member này — cần để `applyMinDeductionFloor` floor mỗi
   *  khách lên mức tối thiểu (mặc định 60K) độc lập với balance của host. */
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
  /** Đơn giá CHƠI mỗi đầu cho MEMBER. Khi guest-floor redistribute (xem
   *  `calculateSessionCosts` opts.applyGuestFloor), số này thấp hơn naive vì
   *  member gánh phần còn lại sau khi khách trả sàn 60K. */
  playCostPerHead: number;
  /** Đơn giá CHƠI mỗi đầu cho KHÁCH = 60K khi bị floor (perHead < 60K), bằng
   *  `playCostPerHead` khi không floor. Tách riêng để khách trả sàn còn member
   *  trả phần chia lại — KHÔNG cho dư vào quỹ. */
  guestPlayCostPerHead: number;
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
 * Min-deduction floor cho 1 buổi. Áp khi `sessions.use_min_deduction = true`
 * (member có thể miễn qua `session_min_deduction_exemptions`). Floor mặc định
 * 60K — hardcode trước (nếu cần admin đổi sẽ thêm app_setting sau).
 *
 * Hai vế ĐỘC LẬP:
 * - **Member (play của chính mình):** chỉ floor khi member CHƠI + thiếu quỹ
 *   trả play share + share < floor → nâng `playAmount` lên `floor`. Member đủ
 *   quỹ trả per-head thật → không phạt.
 * - **Khách (play):** khách KHÔNG có quỹ riêng → mỗi khách MẶC ĐỊNH tối thiểu
 *   `floor` (60K), KHÔNG phụ thuộc balance của host. perGuest < floor → nâng
 *   từng khách lên floor; perGuest ≥ floor → giữ per-head (admin không lỗ).
 *
 * Scope: chỉ floor PLAY (sân). KHÔNG floor `dineAmount` / `guestDineAmount`
 * (nhậu tự nguyện). Round-up rule giữ nguyên — admin không bao giờ lỗ.
 */
export const MIN_DEDUCTION_PER_HEAD = 60_000;

export function applyMinDeductionFloor(
  debt: MemberDebt,
  balance: number,
  floor: number = MIN_DEDUCTION_PER_HEAD,
): MemberDebt {
  // Vế member: chỉ phạt người chơi, thiếu quỹ, và share < floor.
  const playAmount =
    debt.playAmount > 0 && balance < debt.playAmount && debt.playAmount < floor
      ? floor
      : debt.playAmount;

  // Vế khách: mỗi khách tối thiểu `floor`. perGuest = guestPlayAmount /
  // guestPlayCount; < floor → nâng cả nhóm lên `guestPlayCount × floor`.
  let guestPlayAmount = debt.guestPlayAmount;
  if (debt.guestPlayCount > 0) {
    const perGuest = debt.guestPlayAmount / debt.guestPlayCount;
    if (perGuest < floor) {
      guestPlayAmount = debt.guestPlayCount * floor;
    }
  }

  if (
    playAmount === debt.playAmount &&
    guestPlayAmount === debt.guestPlayAmount
  ) {
    return debt; // không đổi gì
  }
  return {
    ...debt,
    playAmount,
    guestPlayAmount,
    totalAmount:
      playAmount + debt.dineAmount + guestPlayAmount + debt.guestDineAmount,
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
  /** @deprecated KHÔNG còn cộng vào surplus quỹ. Từ khi guest-60K redistribute
   *  (khách trả sàn 60K, phần dư CHIA LẠI cho member chứ không vào quỹ), khách
   *  không tạo surplus quỹ nữa. Giữ field cho caller cũ khỏi vỡ — bị bỏ qua. */
  guestPlayCount?: number;
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
  // Khách KHÔNG còn tạo surplus quỹ: guest-60K redistribute → phần dư của khách
  // giảm cho member (xem calculateSessionCosts.applyGuestFloor), không vào quỹ.
  // Chỉ member nghèo (member-floor) mới tạo surplus vào quỹ admin.
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
export function computePerHeadCharges(input: {
  courtPrice: number;
  shuttlecockCost: number;
  diningBill: number;
  playerCount: number;
  dinerCount: number;
}): { playCostPerHead: number; dineCostPerHead: number } {
  const playCostPerHead =
    input.playerCount > 0
      ? roundToThousand(
          (input.courtPrice + input.shuttlecockCost) / input.playerCount,
        )
      : 0;
  const dineCostPerHead =
    input.dinerCount > 0
      ? roundToThousand(input.diningBill / input.dinerCount)
      : 0;
  return { playCostPerHead, dineCostPerHead };
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
  opts?: { applyGuestFloor?: boolean; floor?: number },
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
  const rawPlayCostPerHead =
    totalPlayers > 0 ? totalPlayCost / totalPlayers : 0;
  const rawDineCostPerHead =
    totalDiners > 0 ? session.diningBill / totalDiners : 0;

  // 4. Round up to the next 1000 VND so the admin is not underpaid.
  const dineCostPerHead = roundToThousand(rawDineCostPerHead);

  // Guest-60K REDISTRIBUTION (opts.applyGuestFloor): khi naive perHead < 60K và
  // có khách, khách trả sàn 60K nhưng phần dư KHÔNG cho vào quỹ — chia lại để
  // MEMBER trả ít đi (member gánh `totalPlayCost − 60K×guestHeads`). Tổng thu =
  // đúng tiền sân, không dư quỹ. Khi không bật / perHead ≥ 60K / không có khách
  // → giữ nguyên (member = guest = naive perHead). Member-floor (member nghèo)
  // vẫn xử lý riêng ở `applyMinDeductionFloor` lúc finalize.
  const floor = opts?.floor ?? MIN_DEDUCTION_PER_HEAD;
  const guestPlayHeads = allPlayers
    .filter((a) => a.isGuest)
    .reduce((s, a) => s + (a.headcount ?? 1), 0);
  const memberPlayHeads = totalPlayers - guestPlayHeads;
  let playCostPerHead: number;
  let guestPlayCostPerHead: number;
  if (
    opts?.applyGuestFloor &&
    guestPlayHeads > 0 &&
    memberPlayHeads > 0 &&
    rawPlayCostPerHead > 0 &&
    rawPlayCostPerHead < floor
  ) {
    guestPlayCostPerHead = floor;
    const memberPlayCost = totalPlayCost - floor * guestPlayHeads;
    // Khách trả nhiều hơn cả tiền sân (hiếm) → member = 0, phần dư của khách
    // không tránh được (giữ sàn để admin không lỗ). Math.max chặn âm.
    playCostPerHead = roundToThousand(
      Math.max(0, memberPlayCost / memberPlayHeads),
    );
  } else {
    playCostPerHead = roundToThousand(rawPlayCostPerHead);
    guestPlayCostPerHead = playCostPerHead;
  }

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
    // Khách dùng guestPlayCostPerHead (= 60K khi floor, host trả thay) — tách
    // khỏi member rate để guest-floor không cho dư vào quỹ mà giảm cho member.
    const guestPlayAmount = guestsPlay * guestPlayCostPerHead;
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
    guestPlayCostPerHead,
    dineCostPerHead,
    memberDebts,
  };
}
