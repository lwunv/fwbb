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
  /**
   * `equal` chia đều; `floor` rẻ hơn `amount` thì trả `amount`; `fixed` luôn
   * trả `amount`; `percent` trả `percent`% suất của nhóm nam tương ứng.
   */
  mode: "equal" | "floor" | "fixed" | "percent";
  /** VND, số nguyên. Bỏ qua khi mode = "equal" hoặc "percent". */
  amount: number;
  /** Chỉ có nghĩa khi mode = "fixed": không trả cao hơn suất chia đều. */
  capAtEqual: boolean;
  /**
   * 0..100, chỉ có nghĩa khi mode = "percent" ở một nhóm NỮ.
   *
   * Khuyết thì tính như 100 (trả bằng nam). Chọn hướng thu đủ vì dữ liệu
   * khuyết chỉ xảy ra với bản ghi cũ hoặc object dựng tay trong test; đoán
   * thành một mức giảm giá nào đó là tự làm admin hụt tiền mà không ai báo.
   */
  percent?: number;
}

/**
 * Nhóm nữ ăn theo nhóm nam nào. `percent` chỉ có nghĩa với ba nhóm này; đặt
 * cho nhóm nam thì không có gốc nào để nhân, xem như chia đều.
 */
const FEMALE_BASE: Partial<Record<GroupKey, GroupKey>> = {
  memberFemale: "member",
  guestMemberFemale: "guestMember",
  guestAdminFemale: "guestAdmin",
};

/**
 * Phần trăm của một nhóm nữ, trả về SỐ NGUYÊN 0..100 (không phải 0..1).
 *
 * Giữ dạng số nguyên là có chủ ý. Bản đầu trả 0,8 rồi nhân thẳng vào tiền:
 * 350.000 / 2,8 ra 125000.00000000001, mà `roundToThousand` làm tròn LÊN nên
 * sai số 1e-11 bị đội thành nguyên 1.000đ cho MỖI đầu người (2 nam 1 nữ, sân
 * 350K: thu 353K thay vì 350K). Mọi phép tính bên dưới nhân chia ở thang ×100
 * bằng số nguyên, chỉ chia một lần duy nhất ở bước cuối.
 */
function percentInt(p: GroupPolicy): number {
  const raw =
    typeof p.percent === "number" && Number.isFinite(p.percent)
      ? Math.round(p.percent)
      : 100;
  return Math.min(100, Math.max(0, raw));
}

const EQUAL: GroupPolicy = { mode: "equal", amount: 0, capAtEqual: false };

/**
 * Mặc định = ĐÚNG hành vi đang chạy trước giai đoạn 3: chỉ khách của admin ăn
 * sàn 60K, mọi nhóm khác chia đều. Xem chứng minh tương đương ở spec mục 4.4.
 */
export const DEFAULT_GROUP_POLICIES: Record<GroupKey, GroupPolicy> = {
  member: EQUAL,
  // `percent: 80` chỉ là số điền sẵn cho ô nhập; mode vẫn `equal` nên nó
  // KHÔNG tác động đồng nào cho tới khi admin chọn cách tính phần trăm.
  memberFemale: { ...EQUAL, percent: 80 },
  guestMember: EQUAL,
  guestMemberFemale: { ...EQUAL, percent: 80 },
  guestAdmin: { mode: "floor", amount: 60_000, capAtEqual: false },
  guestAdminFemale: {
    mode: "floor",
    amount: 60_000,
    capAtEqual: false,
    percent: 80,
  },
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

  /** Nhóm này có thật sự tính theo phần trăm không (phải là nhóm nữ). */
  const byPercent = (k: GroupKey) =>
    policies[k].mode === "percent" && FEMALE_BASE[k] !== undefined;

  /**
   * Trọng số của nhóm khi nằm trong rổ chia đều, ở thang ×100. Nhóm thường là
   * 100, nhóm nữ tính phần trăm là chính số phần trăm đó. Cùng một rổ mà nữ
   * trả ít hơn nam đúng tỷ lệ, phần thiếu tự dồn sang nam qua mẫu số.
   */
  const weight100 = (k: GroupKey) =>
    byPercent(k) ? percentInt(policies[k]) : 100;

  /**
   * Số tiền một người nhóm này trả khi nhóm nằm NGOÀI rổ, ở thang ×100. Nhóm
   * nữ tính phần trăm mà nhóm nam gốc cũng ngoài rổ (đang trả số cố định hoặc
   * đang ăn sàn) thì lấy phần trăm của chính số đó — nữ ăn theo cái nam thật
   * sự trả, không ăn theo suất rổ.
   */
  const outAmount100 = (k: GroupKey) => {
    if (!byPercent(k)) return 100 * policies[k].amount;
    const base = FEMALE_BASE[k] as GroupKey;
    return percentInt(policies[k]) * policies[base].amount;
  };

  // Nhóm 0 đầu người coi như trong rổ: nó không ảnh hưởng phép chia nào.
  // Nhóm nam lỡ đặt cách tính phần trăm cũng vào rổ: không có nhóm gốc để
  // nhân thì phần trăm vô nghĩa, và để nó nằm ngoài rổ sẽ khiến nó trả
  // `amount` = 0, tức cả nhóm chơi miễn phí mà không ai báo.
  const inPool = new Set<GroupKey>(
    GROUP_KEYS.filter(
      (k) =>
        policies[k].mode === "equal" ||
        (headsByGroup[k] || 0) === 0 ||
        (policies[k].mode === "percent" && FEMALE_BASE[k] === undefined),
    ),
  );

  /** Nhóm nữ tính phần trăm đi theo nhóm nam gốc vào rổ. */
  const syncPercentGroups = () => {
    for (const k of GROUP_KEYS) {
      if (!byPercent(k) || inPool.has(k)) continue;
      if (inPool.has(FEMALE_BASE[k] as GroupKey)) inPool.add(k);
    }
  };

  // Cả hai biến đều là SỐ NGUYÊN ở thang ×100, giữ ngoài vòng lặp để dùng lại
  // sau khi vòng lặp ổn định.
  let poolWeight100 = 0;
  let remaining100 = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Chạy TRƯỚC khi tính suất: vòng trước có thể vừa đẩy một nhóm nam vào rổ
    // (sàn hết tác dụng), nhóm nữ ăn theo phải vào cùng lúc, nếu không mẫu số
    // thiếu trọng số của nó và cả rổ bị tính cao lên.
    syncPercentGroups();

    poolWeight100 = GROUP_KEYS.filter((k) => inPool.has(k)).reduce(
      (s, k) => s + (headsByGroup[k] || 0) * weight100(k),
      0,
    );

    // Rổ rỗng, hoặc cả rổ đều là nhóm 0%: không có ai để gánh phần còn lại.
    // Bỏ qua chính sách và chia đều naive, thà thu đủ còn hơn để ai gánh số âm.
    if (poolWeight100 <= 0) {
      for (const k of GROUP_KEYS) rates[k] = naive;
      return rates;
    }

    const fixedTotal100 = GROUP_KEYS.filter((k) => !inPool.has(k)).reduce(
      (s, k) => s + outAmount100(k) * (headsByGroup[k] || 0),
      0,
    );
    remaining100 = Math.max(0, totalPlayCost * 100 - fixedTotal100);

    let moved = false;
    for (const k of GROUP_KEYS) {
      if (inPool.has(k)) continue;
      const p = policies[k];
      // So sánh `amount` với suất rổ mà KHÔNG chia: nhân chéo nên phép so
      // sánh là số nguyên, không có sai số dấu phẩy động ở đúng mốc bằng nhau.
      const amountVsPool = p.amount * poolWeight100;
      const shouldMove =
        (p.mode === "floor" && amountVsPool <= remaining100) ||
        (p.mode === "fixed" && p.capAtEqual && amountVsPool > remaining100);
      if (shouldMove) {
        inPool.add(k);
        moved = true;
      }
    }
    if (!moved) break;
  }

  for (const k of GROUP_KEYS) {
    rates[k] = inPool.has(k)
      ? // Một phép chia DUY NHẤT, tử và mẫu đều nguyên: chia chẵn thì ra đúng
        // số chẵn, không dư 1e-11 để `roundToThousand` đội lên.
        roundToThousand((remaining100 * weight100(k)) / (poolWeight100 * 100))
      : roundToThousand(outAmount100(k) / 100);
  }
  return rates;
}
