import { roundToThousand } from "./utils";

/**
 * Sáu nhóm đầu người khi chia tiền CHƠI. Tách nam/nữ để admin có thể cho nữ
 * trả ít hơn; mặc định cả hai giới cùng chính sách nên không đổi hành vi.
 *
 * Đầu thứ hai của member "đi 2 mình" xếp vào `guestMember` (quyết định
 * 27/7/2026: không tạo nhóm riêng, không khai giới tính người đi kèm).
 * Member chưa khai giới tính xếp vào `member` — trả suất đầy đủ, thà tính đủ
 * còn hơn ưu đãi nhầm.
 */
export type GroupKey =
  | "member"
  | "memberFemale"
  | "guestMember"
  | "guestMemberFemale"
  | "guestAdmin"
  | "guestAdminFemale";

export const GROUP_KEYS: readonly GroupKey[] = [
  "member",
  "memberFemale",
  "guestMember",
  "guestMemberFemale",
  "guestAdmin",
  "guestAdminFemale",
] as const;

export interface GroupPolicy {
  /** `equal` chia đều; `floor` rẻ hơn `amount` thì trả `amount`; `fixed` luôn trả `amount`. */
  mode: "equal" | "floor" | "fixed";
  /** VND, số nguyên. Bỏ qua khi mode = "equal". */
  amount: number;
  /** Chỉ có nghĩa khi mode = "fixed": không trả cao hơn suất chia đều. */
  capAtEqual: boolean;
}

const EQUAL: GroupPolicy = { mode: "equal", amount: 0, capAtEqual: false };

/**
 * Mặc định = ĐÚNG hành vi đang chạy trước giai đoạn 3: chỉ khách của admin ăn
 * sàn 60K, mọi nhóm khác chia đều. Xem chứng minh tương đương ở spec mục 4.4.
 */
export const DEFAULT_GROUP_POLICIES: Record<GroupKey, GroupPolicy> = {
  member: EQUAL,
  memberFemale: EQUAL,
  guestMember: EQUAL,
  guestMemberFemale: EQUAL,
  guestAdmin: { mode: "floor", amount: 60_000, capAtEqual: false },
  guestAdminFemale: { mode: "floor", amount: 60_000, capAtEqual: false },
};

/**
 * Chặn cứng phòng lỗi lập trình — PHẢI theo `GROUP_KEYS.length`, không phải số
 * cứng. Mỗi nhóm chỉ dời vào rổ tối đa 1 lần (đơn điệu, không bao giờ rời rổ
 * lại), nên tối đa `GROUP_KEYS.length` vòng là đủ cho MỌI lượt dời; +1 vòng
 * nữa để LẶP LẠI xác nhận không còn ai dời (equalRate lúc đó mới thật sự ổn
 * định theo rổ cuối cùng). Thiếu vòng xác nhận này, `equalRate` dùng để tính
 * `pooled` có thể là số CŨ từ trước khi nhóm cuối dời vào — mọi người trong rổ
 * bị tính sai suất mà không có lỗi nào báo ra. Nếu sau này thêm nhóm thứ 7 mà
 * quên sửa hằng số này thì sẽ sai ngầm đúng kiểu đó — nên đừng thay lại bằng
 * số cứng.
 */
const MAX_ROUNDS = GROUP_KEYS.length + 1;

/**
 * Suất CHƠI của từng nhóm. Ai chia đều thì vào một rổ chung, ai có số riêng thì
 * trả số đó trước, phần còn lại chia cho rổ. Sau đó kiểm lại: nhóm ăn sàn mà
 * suất chia đều đã cao hơn sàn thì thực chất đang chia đều, cho vào rổ rồi tính
 * lại; nhóm cố định có cap mà số cố định cao hơn suất chia đều cũng vào rổ.
 * Lặp tới khi không ai chuyển nữa.
 *
 * Hàm THUẦN. Dùng chung bởi cả đường chốt sổ và đường xem trước trên giao diện
 * để hai bên không bao giờ lệch nhau.
 */
export function computeGroupPlayRates(input: {
  totalPlayCost: number;
  headsByGroup: Record<GroupKey, number>;
  policies: Record<GroupKey, GroupPolicy>;
}): Record<GroupKey, number> {
  const { totalPlayCost, headsByGroup, policies } = input;

  // Đầu người âm là lỗi lập trình phía gọi hàm, không phải dữ liệu hợp lệ
  // (không có buổi tập nào có "-2 người"). `heads || 0` chỉ chặn 0/undefined,
  // KHÔNG chặn số âm (`-2 || 0` vẫn ra -2) nên nếu không throw ở đây, số âm sẽ
  // chảy thẳng vào totalHeads/fixedTotal và cho ra một số tiền — SAI nhưng
  // không có lỗi nào báo, đúng kiểu "thu sai ngầm"/"miễn phí ngầm" app này đã
  // dính trước đây. Throw để lỗi lộ ra ở test và ở nhánh {error} của server
  // action, không âm thầm tính ra một số.
  for (const k of GROUP_KEYS) {
    const h = headsByGroup[k];
    if (h < 0) {
      throw new Error(
        `computeGroupPlayRates: headsByGroup.${k} âm (${h}) — lỗi lập trình ở phía gọi hàm.`,
      );
    }
  }

  const totalHeads = GROUP_KEYS.reduce((s, k) => s + (headsByGroup[k] || 0), 0);

  const rates = {} as Record<GroupKey, number>;
  if (totalHeads <= 0 || totalPlayCost <= 0) {
    for (const k of GROUP_KEYS) rates[k] = 0;
    return rates;
  }

  const naive = roundToThousand(totalPlayCost / totalHeads);

  // Nhóm 0 đầu người coi như trong rổ: nó không ảnh hưởng phép chia nào.
  const inPool = new Set<GroupKey>(
    GROUP_KEYS.filter(
      (k) => policies[k].mode === "equal" || (headsByGroup[k] || 0) === 0,
    ),
  );

  let equalRate = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const poolHeads = GROUP_KEYS.filter((k) => inPool.has(k)).reduce(
      (s, k) => s + (headsByGroup[k] || 0),
      0,
    );

    // Rổ rỗng: không có ai để gánh phần còn lại. Bỏ qua chính sách và chia đều
    // naive, thà thu đủ còn hơn để ai gánh số âm.
    if (poolHeads === 0) {
      for (const k of GROUP_KEYS) rates[k] = naive;
      return rates;
    }

    const fixedTotal = GROUP_KEYS.filter((k) => !inPool.has(k)).reduce(
      (s, k) => s + policies[k].amount * (headsByGroup[k] || 0),
      0,
    );
    equalRate = Math.max(0, (totalPlayCost - fixedTotal) / poolHeads);

    let moved = false;
    for (const k of GROUP_KEYS) {
      if (inPool.has(k)) continue;
      const p = policies[k];
      const shouldMove =
        (p.mode === "floor" && p.amount <= equalRate) ||
        (p.mode === "fixed" && p.capAtEqual && p.amount > equalRate);
      if (shouldMove) {
        inPool.add(k);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const pooled = roundToThousand(equalRate);
  for (const k of GROUP_KEYS) {
    rates[k] = inPool.has(k) ? pooled : roundToThousand(policies[k].amount);
  }
  return rates;
}
