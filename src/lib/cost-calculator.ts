import { roundToThousand } from "./utils";
import { isDefaultSessionDay } from "./date-format";
import {
  computeGroupPlayRates,
  DEFAULT_GROUP_POLICIES,
  type GroupKey,
  type GroupPolicy,
} from "./group-policy";

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
  /** Dùng để xếp nhóm khi `genderPricingEnabled` bật (giai đoạn 3). Không khai
   *  → coi như không nữ, trả suất đầy đủ (thà tính đủ còn hơn ưu đãi nhầm). */
  gender?: "male" | "female";
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
  /** Suất CHƠI của cả 6 nhóm (Task 1 group-policy). `playCostPerHead` /
   *  `adminGuestPlayCostPerHead` ở trên là 2 lát cắt (member/guestAdmin,
   *  không giới tính) của chính bảng này, giữ cho code cũ đọc 2 trường đó
   *  không vỡ. Ai cần chi tiết nữ/nam thì đọc `ratesByGroup`. */
  ratesByGroup: Record<GroupKey, number>;
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
 * 60K, admin đổi được qua setting `minDeductionAmount` (giai đoạn 3, Task 4) —
 * `finalizeSession` đọc setting rồi truyền vào tham số `floor`, KHÔNG còn ăn
 * hằng số `MIN_DEDUCTION_PER_HEAD` bên dưới trong đường chốt sổ thật (hằng số
 * này giờ chỉ còn là giá trị mặc định của tham số).
 *
 * CHỈ floor PLAY của CHÍNH member: member CHƠI + thiếu quỹ trả play share +
 * share < floor → nâng `playAmount` lên `floor`. Member đủ quỹ → không phạt.
 *
 * KHÔNG floor khách: khách-của-admin đã được sàn riêng (`groupPolicies.guestAdmin`)
 * trong `calculateSessionCosts`; khách-của-member chia đều (không có sàn).
 * KHÔNG floor `dineAmount` / `guestDineAmount` (nhậu tự nguyện). Round-up rule
 * giữ nguyên — admin không lỗ.
 *
 * ⚠️ HAI SÀN KHÁC NHAU, VÀ CHÚNG ĐỤNG NHAU CÓ CHỦ Ý (quyết định admin
 * 13/8/2026, xem `cost-calculator.test.ts` describe "luật hai sàn khi đụng
 * nhau"): sàn khách (`groupPolicies.guestAdmin.amount`) chỉ quyết định suất
 * CHIA của nhóm, còn `floor` ở đây quyết định sàn khi MEMBER THIẾU QUỸ. Khi
 * `playAmount` một member (dù đến từ suất ưu đãi nhóm nào, kể cả fixed thấp
 * hơn floor) mà member đó thiếu quỹ, floor LUÔN ĐÈ LÊN ưu đãi — member phải
 * trả đủ sàn tối thiểu, không được hưởng ưu đãi nhóm khi đang thiếu quỹ. Ưu
 * đãi nhóm chỉ có tác dụng thật với người CÒN quỹ. Đây là hành vi ĐÚNG Ý ADMIN,
 * ĐỪNG "sửa" thành tôn trọng ưu đãi nhóm vô điều kiện — nhìn từ ngoài code này
 * rất giống bug nhưng không phải.
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
 * Pure: tách rate CHƠI khi có khách-của-admin — lát cắt 2-nhóm (member vs
 * guestAdmin, KHÔNG phân biệt giới) của `computeGroupPlayRates`. Không có
 * khách-admin hoặc naive ≥ floor → mọi người = naive.
 *
 * ĐÃ NỐI LẠI THÀNH SINGLE SOURCE (Task 4, giai đoạn 3): hàm này không tự tính
 * toán nữa, nó gọi thẳng `computeGroupPlayRates` — CÙNG engine với
 * `calculateSessionCosts` (finalize) — bằng cách gộp mọi đầu không-phải-khách-
 * của-admin vào 1 bucket "member" (`headsByGroup.member = splitHeads`), khách-
 * của-admin vào bucket "guestAdmin". Khi truyền `policies` (đọc từ
 * `getSettings().groupPolicies`), số ra đây LUÔN khớp debt thực ghi vào DB nếu
 * admin chỉ đổi sàn/chính sách của khách-của-admin hoặc của "member" nói
 * chung — đúng đúng những gì UI settings hiện cho sửa (Task 5, giai đoạn 3
 * chặng 1 chưa build UI riêng cho `guestMember`/`memberFemale`).
 *
 * GIỚI HẠN CÒN LẠI (không phải regression — data này chưa tồn tại): hàm gộp
 * khách-của-MEMBER (không phải admin) vào CHUNG bucket "member" với chính chủ,
 * nên nếu tương lai có UI cho `groupPolicies.guestMember` một chính sách khác
 * hẳn `member`, số preview ở đây sẽ lệch — phải truyền thêm 1 bucket riêng lúc
 * đó. Tương tự, `genderPricingEnabled`/`memberFemale` không có tác dụng ở đây
 * vì các call site preview (session-list, admin-vote-manager, …) không có dữ
 * liệu gender theo đầu người — `members` chưa có cột gender (đó là chặng 2,
 * Task 6-9, có migration riêng), nên field này hoàn toàn dormant ở CẢ hai
 * đường (preview và finalize) cho tới khi chặng đó xong.
 */
export function computeGuestAwarePlayRates(input: {
  totalPlayCost: number;
  totalPlayHeads: number;
  adminGuestPlayHeads: number;
  /** @deprecated Dùng `policies` (sàn khách nằm ở `policies.guestAdmin.amount`).
   *  Chỉ được đọc khi `policies` KHÔNG truyền — giữ cho call site cũ chưa
   *  migrate ra đúng số cũ (sàn cố định `floor`, mọi nhóm khác chia đều). */
  floor?: number;
  /** Không truyền → `DEFAULT_GROUP_POLICIES` (đúng hành vi cũ: mọi nhóm chia
   *  đều trừ khách-admin ăn sàn `floor`). Truyền `getSettings().groupPolicies`
   *  để preview khớp đúng cấu hình admin đã đổi. */
  policies?: Record<GroupKey, GroupPolicy>;
}): { playCostPerHead: number; adminGuestPlayCostPerHead: number } {
  const policies = input.policies ?? buildTwoGroupPolicies(input.floor);
  // Kẹp về 0 (KHÁC với calculateSessionCosts/computeGroupPlayRates — nơi đó
  // throw cho heads âm vì đầu vào là attendee rows thật, âm = lỗi lập trình).
  // Ở đây input là 2 con số rời (`totalPlayHeads`, `adminGuestPlayHeads`) do
  // UI preview tự cộng dồn từ state optimistic — 1 lần cập nhật lệch nhịp
  // (stepper tăng adminGuestPlayHeads trước khi playerCount kịp đồng bộ) có
  // thể tạo `adminGuestPlayHeads > totalPlayHeads` NHẤT THỜI. Hành vi cũ của
  // hàm này (trước khi nối `computeGroupPlayRates`) đã lặng lẽ rơi về chia
  // đều naive trong đúng tình huống đó — throw ở đây sẽ làm cả preview vỡ
  // trắng màn hình vì 1 render lệch nhịp, tệ hơn hiển thị tạm 1 số sai.
  const splitHeads = Math.max(
    0,
    input.totalPlayHeads - input.adminGuestPlayHeads,
  );
  const rates = computeGroupPlayRates({
    totalPlayCost: input.totalPlayCost,
    headsByGroup: {
      member: splitHeads,
      memberFemale: 0,
      guestMember: 0,
      guestMemberFemale: 0,
      guestAdmin: input.adminGuestPlayHeads,
      guestAdminFemale: 0,
    },
    policies,
  });
  return {
    playCostPerHead: rates.member,
    adminGuestPlayCostPerHead: rates.guestAdmin,
  };
}

/** Dựng policies 2-nhóm tương đương hành vi cũ của `computeGuestAwarePlayRates`
 *  từ 1 tham số `floor` duy nhất — chỉ dùng khi caller chưa migrate sang
 *  `policies` đầy đủ. */
function buildTwoGroupPolicies(floor?: number): Record<GroupKey, GroupPolicy> {
  if (floor === undefined) return DEFAULT_GROUP_POLICIES;
  const guestAdminFloor: GroupPolicy = {
    mode: "floor",
    amount: floor,
    capAtEqual: false,
  };
  return {
    ...DEFAULT_GROUP_POLICIES,
    guestAdmin: guestAdminFloor,
    guestAdminFemale: guestAdminFloor,
  };
}

export function computePerHeadCharges(input: {
  courtPrice: number;
  shuttlecockCost: number;
  diningBill: number;
  playerCount: number;
  dinerCount: number;
  /** Số đầu khách-của-admin (host = admin). Mặc định 0 → naive equal split.
   *  Truyền vào để preview phản ánh sàn khách-admin + chia lại cho member. */
  adminGuestPlayHeads?: number;
  /** @deprecated dùng `policies`. */
  floor?: number;
  /** Đọc từ `getSettings().groupPolicies` để preview khớp finalize. */
  policies?: Record<GroupKey, GroupPolicy>;
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
      policies: input.policies,
    });
  const dineCostPerHead =
    input.dinerCount > 0
      ? roundToThousand(input.diningBill / input.dinerCount)
      : 0;
  return { playCostPerHead, adminGuestPlayCostPerHead, dineCostPerHead };
}

/**
 * Xếp 1 ĐẦU (member chính chủ hoặc khách — KHÔNG gồm đầu-đi-kèm của member
 * "đi 2 người", cái đó luôn cố định về `guestMember` bất kể hàm này, xem
 * `calculateSessionCosts`) vào 1 trong 6 `GroupKey`. Trước đây map
 * isGuest+invitedById+gender → nhóm bị viết lặp 3 chỗ trong
 * `calculateSessionCosts` (dựng headsByGroup, tính suất riêng của member,
 * tính guestPlayAmount) — 3 bản có thể lệch nhau ở lần sửa sau mà chỉ đụng
 * 1-2 chỗ. Gom về đây để chỉ còn 1 chỗ giữ đúng.
 */
function classifyHead(
  attendee: Pick<AttendeeInput, "isGuest" | "invitedById" | "gender">,
  adminMemberId: number | null,
  genderPricingEnabled: boolean,
): GroupKey {
  const isFemale = genderPricingEnabled && attendee.gender === "female";
  if (attendee.isGuest) {
    const isAdminGuest =
      adminMemberId !== null && attendee.invitedById === adminMemberId;
    if (isAdminGuest) {
      return isFemale ? "guestAdminFemale" : "guestAdmin";
    }
    return isFemale ? "guestMemberFemale" : "guestMember";
  }
  return isFemale ? "memberFemale" : "member";
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
  opts?: {
    adminMemberId?: number | null;
    /** Không truyền → `DEFAULT_GROUP_POLICIES` (đúng hành vi trước giai đoạn 3). */
    policies?: Record<GroupKey, GroupPolicy>;
    /** Tắt (mặc định) → mọi người vào nhóm không-nữ, không đọc `gender` của ai. */
    genderPricingEnabled?: boolean;
  },
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

  const adminMemberId = opts?.adminMemberId ?? null;
  const policies = opts?.policies ?? DEFAULT_GROUP_POLICIES;
  const genderPricingEnabled = opts?.genderPricingEnabled ?? false;

  // Xếp từng ĐẦU đang chơi vào 1 trong 6 nhóm (Task 1 — group-policy.ts).
  // Khách của admin → guestAdmin*; khách của member khác → guestMember*;
  // không phải khách → member*. Đuôi Female CHỈ khi genderPricingEnabled bật
  // VÀ gender === "female" — tắt thì không đọc `gender` của ai, mọi người vào
  // nhóm không-nữ (đúng yêu cầu "tắt thì bỏ qua hoàn toàn giới tính").
  // Đầu thứ 2 của member "đi 2 người" (headcount > 1) luôn vào guestMember,
  // không giới tính riêng (quyết định 27/7/2026) — người đi kèm không tách
  // nhóm và không "hưởng" ưu đãi nữ dù member đó khai nữ.
  const headsByGroup: Record<GroupKey, number> = {
    member: 0,
    memberFemale: 0,
    guestMember: 0,
    guestMemberFemale: 0,
    guestAdmin: 0,
    guestAdminFemale: 0,
  };
  for (const a of allPlayers) {
    const heads = a.headcount ?? 1;
    const group = classifyHead(a, adminMemberId, genderPricingEnabled);
    if (a.isGuest) {
      headsByGroup[group] += heads;
    } else {
      headsByGroup[group] += 1;
      // Đầu đi-kèm không chạy qua classifyHead — luật cố định (27/7/2026),
      // không phụ thuộc gender/host của member chính chủ.
      headsByGroup.guestMember += Math.max(0, heads - 1);
    }
  }

  // Hàm THUẦN dùng chung với đường xem trước (khi task sau nối UI) — 1 nguồn
  // sự thật cho suất từng nhóm, không tính lại bằng tay ở đây.
  const ratesByGroup = computeGroupPlayRates({
    totalPlayCost,
    headsByGroup,
    policies,
  });
  // 2 trường cũ = 2 lát cắt không-giới-tính của ratesByGroup, giữ cho code
  // đang đọc playCostPerHead/adminGuestPlayCostPerHead không vỡ.
  const playCostPerHead = ratesByGroup.member;
  const adminGuestPlayCostPerHead = ratesByGroup.guestAdmin;

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

    // Guests invited by this member, còn nguyên row (cần gender + headcount
    // riêng từng khách để tính đúng nhóm khi genderPricingEnabled bật).
    const guestsPlayRows = attendees.filter(
      (a) => a.isGuest && a.invitedById === memberId && a.attendsPlay,
    );
    const guestsDine = attendees.filter(
      (a) => a.isGuest && a.invitedById === memberId && a.attendsDine,
    ).length;

    // headcount + gender lấy từ row ĐẠI DIỆN đầu tiên của member (không phải
    // guest) — giữ đúng cách chọn cũ (test "does not double-count..." dựng
    // 2 row trùng memberId, chỉ row đầu quyết định headcount/gender).
    const ownRow = attendees.find((a) => a.memberId === memberId && !a.isGuest);
    const memberHeadcount = ownRow?.headcount ?? 1;
    // ownRow undefined chỉ xảy ra khi memberPlays cũng false (không có row
    // non-guest nào cho member này) — fallback "member" không ảnh hưởng vì
    // playAmount dưới đây đã ép 0 trong trường hợp đó.
    const ownRate = ownRow
      ? ratesByGroup[classifyHead(ownRow, adminMemberId, genderPricingEnabled)]
      : ratesByGroup.member;
    // Đầu thứ 2 ("đi 2 người") luôn ăn suất guestMember, không giới tính riêng.
    const extraHeads = Math.max(0, memberHeadcount - 1);
    const playAmount = memberPlays
      ? ownRate + ratesByGroup.guestMember * extraHeads
      : 0;
    const dineAmount = memberDines ? dineCostPerHead * memberHeadcount : 0;

    let guestPlayAmount = 0;
    for (const g of guestsPlayRows) {
      const heads = g.headcount ?? 1;
      const rate =
        ratesByGroup[classifyHead(g, adminMemberId, genderPricingEnabled)];
      guestPlayAmount += rate * heads;
    }
    const guestDineAmount = guestsDine * dineCostPerHead;
    const totalAmount =
      playAmount + dineAmount + guestPlayAmount + guestDineAmount;

    if (totalAmount > 0) {
      memberDebts.push({
        memberId,
        playAmount,
        dineAmount,
        guestPlayAmount,
        guestPlayCount: guestsPlayRows.length,
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
    ratesByGroup,
  };
}
