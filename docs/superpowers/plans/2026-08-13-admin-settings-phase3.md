# Giai đoạn 3: chính sách chia tiền theo nhóm, giới tính, đóng băng cấu hình

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa cách chia tiền cho khách và sàn tối thiểu ra thành cấu hình admin sửa được, thêm phân biệt nam nữ như một tùy chọn, và đóng băng cấu hình của buổi tại lúc chốt sổ để chốt lại không làm đổi tiền lịch sử.

**Architecture:** Tổng quát hóa `computeGuestAwarePlayRates` hiện có thành một bảng sáu nhóm đầu người, mỗi nhóm chọn một trong ba cách tính (chia đều, sàn, cố định). Thuật toán là hàm thuần, lặp tới điểm bất động, và với cấu hình mặc định phải cho ra đúng số hiện tại. Giới tính lưu ở `session_attendees` vì tiền tính từ đó chứ không từ số đếm trong phiếu vote. Snapshot cấu hình ghi vào `sessions.settings_snapshot` (cột đã tạo ở giai đoạn 1, chưa ai ghi).

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle ORM trên Turso (SQLite), zod v4, next-intl, vitest, Playwright.

## Global Constraints

- Spec gốc: `docs/superpowers/specs/2026-07-27-admin-settings-page-design.md`, mục 4, 5.6 và 7. Mâu thuẫn thì spec thắng.
- **Đây là code tiền thật.** Mỗi task đụng tiền phải chạy skill `reconcile-check` trước khi coi là xong, và trước khi merge phải cho reviewer bất biến tài chính soát.
- **Mặc định phải cho ra ĐÚNG số hiện tại.** `src/lib/cost-calculator.test.ts` phải xanh mà **không sửa một dòng nào**. Nếu phải sửa test cũ thì thuật toán sai, không phải test sai. Đây là cổng quan trọng nhất của cả giai đoạn.
- Tiền là số nguyên VND. Không `parseFloat`, không số thực. Làm tròn lên 1K qua `roundToThousand`, áp cho từng suất.
- Không bao giờ đặt `memberConfirmed` / `adminConfirmed` = true mà không ghi một dòng ledger tương ứng (bất biến I8).
- Không `any`. Không `console.log`. Không màu ghi cứng.
- Vùng chạm tối thiểu 44px (`min-h-11`). Cập nhật lạc quan qua `fireAction`. State client phản chiếu prop server phải đồng bộ lại bằng `useEffect`.
- Chuỗi hiển thị phải đủ cả ba file `src/i18n/messages/{vi,en,zh}.json`, có test chặn lệch khoá.
- Commit theo Conventional Commits, một dòng, không phần thân, không dòng ghi công AI.
- **Không chạy `pnpm db:push` hay `pnpm db:seed`.** `.env.local` trỏ database production. Migration chỉ sinh file bằng `pnpm db:generate`; áp lên prod là việc riêng, làm sau khi mọi cổng xanh.
- E2E dùng `file:e2e/local.db`. **Đừng chạy `pnpm db:clone-local`**, nó ghi đè file đó bằng bản prod và làm mất migration đã áp tay.

## Hiện trạng đã verify (13/8/2026)

- `MIN_DEDUCTION_PER_HEAD = 60_000` tại `src/lib/cost-calculator.ts:130`, đang phục vụ **hai luật khác nhau**: sàn khách của admin (dùng ở dòng 255) và sàn member thiếu quỹ (dùng ở dòng 135). Phải tách thành hai setting độc lập.
- `finalizeSession` gọi `calculateSessionCosts` (`src/actions/finance.ts:146`) và `applyMinDeductionFloor` (`:360`) mà **không truyền `floor`**, nên đang ăn hằng số mặc định.
- Chỗ bung số đếm khách thành từng dòng attendee nằm trong `finalizeSessionAuto`, `src/actions/finance.ts:541-630`.
- Registry hiện có 17 setting, **chưa có** setting nào cho tiền. Cột `sessions.settings_snapshot` đã tồn tại từ migration 0023 nhưng chưa ai ghi vào.
- Schema vote hiện tại: `guestPlayCount` / `guestDineCount` giới hạn 0..20 (`src/lib/validators.ts:43-44,108-109`), `headcount` 1..2 (`:93`).

## Cấu trúc file

| File                                                     | Trách nhiệm                                                                                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/group-policy.ts` (tạo)                          | Kiểu `GroupPolicy`, `GroupKey`, và hàm thuần `computeGroupPlayRates`. Tách khỏi `cost-calculator.ts` vì file đó đã lớn, và thuật toán này tự đứng được, test được độc lập. |
| `src/lib/cost-calculator.ts` (sửa)                       | Gọi `computeGroupPlayRates` thay cho nhánh khách-admin hiện tại. Phân loại attendee vào nhóm.                                                                              |
| `src/lib/settings-registry.ts` (sửa)                     | Thêm setting cho sàn member, bảng sáu nhóm, công tắc nam nữ.                                                                                                               |
| `src/actions/finance.ts` (sửa)                           | Đọc setting rồi truyền vào hàm tính tiền. Ghi và đọc snapshot. Gán giới tính khi bung khách thành attendee.                                                                |
| `src/db/schema.ts` (sửa)                                 | Bốn cột giới tính và số đếm khách nữ.                                                                                                                                      |
| `src/app/(admin)/admin/settings/section-money.tsx` (tạo) | Section chia tiền trên trang Cài đặt, gồm bảng nhóm và khối xem thử.                                                                                                       |

## Ba chặng

Chặng 1 (task 1-5) là phần tiền, không đụng schema, không đụng màn vote. Chặng 2 (task 6-9) là giới tính, có migration. Chặng 3 (task 10-11) là đóng băng cấu hình. Mỗi chặng tự đứng được và phải xanh hết cổng trước khi sang chặng sau. Task 6 trở đi mô tả ngắn hơn vì chữ ký hàm phụ thuộc kết quả chặng 1; khi tới lượt sẽ chi tiết hoá dựa trên code thật thay vì đoán trước.

---

### Task 1: Hàm thuần tính suất theo nhóm

**Files:**

- Create: `src/lib/group-policy.ts`
- Test: `src/lib/group-policy.test.ts`

**Interfaces:**

- Consumes: `roundToThousand` từ `src/lib/utils.ts`.
- Produces: `type GroupKey`, `interface GroupPolicy`, `DEFAULT_GROUP_POLICIES`, `computeGroupPlayRates(input): Record<GroupKey, number>`.

- [ ] **Step 1: Viết test trước**

Tạo `src/lib/group-policy.test.ts`. Ba ca đầu lấy nguyên từ spec mục 4.3 (tổng sân cộng cầu 700K, nữ cố định 50K có cap, khách admin sàn 60K):

```ts
import { describe, expect, it } from "vitest";
import {
  computeGroupPlayRates,
  DEFAULT_GROUP_POLICIES,
  type GroupPolicy,
  type GroupKey,
} from "./group-policy";

const equal: GroupPolicy = { mode: "equal", amount: 0, capAtEqual: false };
const floor60: GroupPolicy = {
  mode: "floor",
  amount: 60_000,
  capAtEqual: false,
};
const fixed50Cap: GroupPolicy = {
  mode: "fixed",
  amount: 50_000,
  capAtEqual: true,
};
const fixed50: GroupPolicy = {
  mode: "fixed",
  amount: 50_000,
  capAtEqual: false,
};

function heads(
  partial: Partial<Record<GroupKey, number>>,
): Record<GroupKey, number> {
  return {
    member: 0,
    memberFemale: 0,
    guestMember: 0,
    guestMemberFemale: 0,
    guestAdmin: 0,
    guestAdminFemale: 0,
    ...partial,
  };
}

describe("computeGroupPlayRates — ba ví dụ trong spec", () => {
  const policies = {
    ...DEFAULT_GROUP_POLICIES,
    memberFemale: fixed50Cap,
    guestAdmin: floor60,
  };

  it("buổi đông vừa: 6 nam, 2 nữ, 2 khách admin", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({ member: 6, memberFemale: 2, guestAdmin: 2 }),
      policies,
    });
    expect(r.member).toBe(75_000);
    expect(r.guestAdmin).toBe(75_000); // suất chia đều đã vượt sàn nên sàn không kích hoạt
    expect(r.memberFemale).toBe(50_000);
    // Thu đúng tổng chi: 8 × 75K + 2 × 50K = 700K
    expect(6 * r.member + 2 * r.guestAdmin + 2 * r.memberFemale).toBe(700_000);
  });

  it("buổi vắng: 2 nam, 2 nữ — nam gánh phần còn lại", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({ member: 2, memberFemale: 2 }),
      policies,
    });
    expect(r.memberFemale).toBe(50_000);
    expect(r.member).toBe(300_000);
  });

  it("buổi rất đông: tick cap kéo nữ về suất chia đều", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({ member: 20, memberFemale: 2 }),
      policies,
    });
    expect(r.member).toBe(32_000);
    expect(r.memberFemale).toBe(32_000);
  });

  it("bỏ tick cap thì nữ trả đúng số cố định dù cao hơn suất chia đều", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({ member: 20, memberFemale: 2 }),
      policies: { ...DEFAULT_GROUP_POLICIES, memberFemale: fixed50 },
    });
    expect(r.memberFemale).toBe(50_000);
    expect(r.member).toBe(30_000);
  });
});

describe("computeGroupPlayRates — biên", () => {
  it("không ai chơi thì mọi suất bằng 0", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({}),
      policies: DEFAULT_GROUP_POLICIES,
    });
    expect(Object.values(r).every((v) => v === 0)).toBe(true);
  });

  it("mọi nhóm đều cố định (rổ chia đều rỗng) thì bỏ qua chính sách, chia đều naive", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({ member: 2, memberFemale: 2 }),
      policies: {
        ...DEFAULT_GROUP_POLICIES,
        member: fixed50,
        memberFemale: fixed50,
      },
    });
    // 700K / 4 đầu = 175K, làm tròn lên 1K
    expect(r.member).toBe(175_000);
    expect(r.memberFemale).toBe(175_000);
  });

  it("nhóm cố định đòi nhiều hơn cả tổng chi phí thì suất chia đều không âm", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 50_000,
      headsByGroup: heads({ member: 1, memberFemale: 2 }),
      policies: { ...DEFAULT_GROUP_POLICIES, memberFemale: fixed50 },
    });
    expect(r.member).toBe(0);
    expect(r.memberFemale).toBe(50_000);
  });

  it("nhóm 0 đầu người không ảnh hưởng suất của nhóm khác", () => {
    const a = computeGroupPlayRates({
      totalPlayCost: 300_000,
      headsByGroup: heads({ member: 3 }),
      policies: { ...DEFAULT_GROUP_POLICIES, guestAdmin: floor60 },
    });
    expect(a.member).toBe(100_000);
  });
});

describe("DEFAULT_GROUP_POLICIES — giữ hành vi hôm nay", () => {
  it("chỉ hai nhóm khách của admin ăn sàn 60K, còn lại chia đều", () => {
    expect(DEFAULT_GROUP_POLICIES.guestAdmin).toEqual({
      mode: "floor",
      amount: 60_000,
      capAtEqual: false,
    });
    expect(DEFAULT_GROUP_POLICIES.guestAdminFemale).toEqual({
      mode: "floor",
      amount: 60_000,
      capAtEqual: false,
    });
    expect(DEFAULT_GROUP_POLICIES.member.mode).toBe("equal");
    expect(DEFAULT_GROUP_POLICIES.memberFemale.mode).toBe("equal");
    expect(DEFAULT_GROUP_POLICIES.guestMember.mode).toBe("equal");
    expect(DEFAULT_GROUP_POLICIES.guestMemberFemale.mode).toBe("equal");
  });
});

describe("tương đương hành vi cũ (chứng minh ở spec mục 4.4)", () => {
  // Với cấu hình mặc định, kết quả phải khớp computeGuestAwarePlayRates:
  // sàn kích hoạt khi totalPlayCost / tổngĐầu < 60K.
  it("sàn KHÔNG kích hoạt khi suất chia đều đã vượt sàn", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 700_000,
      headsByGroup: heads({ member: 6, guestAdmin: 2 }),
      policies: DEFAULT_GROUP_POLICIES,
    });
    // naive = 700/8 = 87.5K ≥ 60K → mọi người cùng suất
    expect(r.member).toBe(88_000);
    expect(r.guestAdmin).toBe(88_000);
  });

  it("sàn kích hoạt khi suất chia đều thấp hơn sàn", () => {
    const r = computeGroupPlayRates({
      totalPlayCost: 300_000,
      headsByGroup: heads({ member: 8, guestAdmin: 2 }),
      policies: DEFAULT_GROUP_POLICIES,
    });
    // naive = 30K < 60K → khách admin trả 60K, còn (300 - 120)/8 = 22.5K → 23K
    expect(r.guestAdmin).toBe(60_000);
    expect(r.member).toBe(23_000);
  });
});
```

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npx vitest run src/lib/group-policy.test.ts`
Expected: FAIL, không tìm thấy module `./group-policy`.

- [ ] **Step 3: Viết thuật toán**

Tạo `src/lib/group-policy.ts`. Thuật toán theo spec mục 4.2:

```ts
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

/** Chặn cứng phòng lỗi lập trình; vòng lặp chỉ có chiều vào rổ nên tối đa 6 vòng là dư. */
const MAX_ROUNDS = 6;

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
```

- [ ] **Step 4: Chạy lại test cho xanh**

Run: `npx vitest run src/lib/group-policy.test.ts`
Expected: PASS toàn bộ.

Run: `pnpm test`
Expected: PASS như mốc hiện tại (984), file mới chỉ thêm test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/group-policy.ts src/lib/group-policy.test.ts
git commit -m "feat(finance): add group-based play rate policy calculator"
```

---

### Task 2: Setting cho tiền

**Files:**

- Modify: `src/lib/settings-registry.ts`
- Test: `src/lib/settings-registry.test.ts`

**Interfaces:**

- Consumes: `GroupPolicy`, `GroupKey`, `DEFAULT_GROUP_POLICIES` từ Task 1.
- Produces: ba setting mới — `minDeductionAmount` (số, mặc định 60000), `genderPricingEnabled` (bool, mặc định false), `groupPolicies` (object sáu nhóm, mặc định `DEFAULT_GROUP_POLICIES`).

- [ ] **Step 1: Viết test trước**

Thêm vào `src/lib/settings-registry.test.ts`:

```ts
describe("setting tiền (giai đoạn 3)", () => {
  it("mặc định giữ đúng hành vi hôm nay", () => {
    const d = defaultSettings();
    expect(d.minDeductionAmount).toBe(60_000);
    expect(d.genderPricingEnabled).toBe(false);
    expect(d.groupPolicies.guestAdmin).toEqual({
      mode: "floor",
      amount: 60_000,
      capAtEqual: false,
    });
    expect(d.groupPolicies.member.mode).toBe("equal");
  });

  it("ba setting tiền đều override được theo từng buổi", () => {
    expect(isPerSession("minDeductionAmount")).toBe(true);
    expect(isPerSession("genderPricingEnabled")).toBe(true);
    expect(isPerSession("groupPolicies")).toBe(true);
  });

  it("chặn chế độ lạ và số tiền âm", () => {
    expect(() =>
      SETTINGS.groupPolicies.schema.parse({
        ...DEFAULT_GROUP_POLICIES,
        member: { mode: "khong-ton-tai", amount: 0, capAtEqual: false },
      }),
    ).toThrow();
    expect(() => SETTINGS.minDeductionAmount.schema.parse(-1)).toThrow();
    expect(() => SETTINGS.minDeductionAmount.schema.parse(1.5)).toThrow();
  });

  it("thiếu nhóm trong bảng thì bị chặn, không âm thầm điền khuyết", () => {
    expect(() =>
      SETTINGS.groupPolicies.schema.parse({ member: EQUAL_FIXTURE }),
    ).toThrow();
  });
});
```

Khai `EQUAL_FIXTURE` ở đầu file test là `{ mode: "equal", amount: 0, capAtEqual: false }`, và import `DEFAULT_GROUP_POLICIES` từ `./group-policy`.

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npx vitest run src/lib/settings-registry.test.ts`
Expected: FAIL ở các ca mới.

- [ ] **Step 3: Thêm ba entry vào registry**

Trong `src/lib/settings-registry.ts`, thêm mục "Chia tiền". Lưu ý `perSession: true` — đây là ba setting đầu tiên có giá trị này, nên đường override theo buổi ở `resolveForSession` (viết từ giai đoạn 1, hiện chưa có key nào dùng) lần đầu chạy thật.

```ts
const groupPolicySchema = z.object({
  mode: z.enum(["equal", "floor", "fixed"]),
  amount: z.number().int().nonnegative(),
  capAtEqual: z.boolean(),
});

// ...trong SETTINGS:
  minDeductionAmount: def({
    key: "minDeductionAmount",
    schema: moneyVnd,
    default: 60_000,
    perSession: true,
    revalidate: ["/admin/sessions", "/admin/dashboard", "/"],
  }),
  genderPricingEnabled: def({
    key: "genderPricingEnabled",
    schema: z.boolean(),
    default: false,
    perSession: true,
    revalidate: ["/admin/sessions", "/admin/dashboard", "/", "/admin/members"],
  }),
  groupPolicies: def({
    key: "groupPolicies",
    schema: z.object({
      member: groupPolicySchema,
      memberFemale: groupPolicySchema,
      guestMember: groupPolicySchema,
      guestMemberFemale: groupPolicySchema,
      guestAdmin: groupPolicySchema,
      guestAdminFemale: groupPolicySchema,
    }),
    default: DEFAULT_GROUP_POLICIES,
    perSession: true,
    revalidate: ["/admin/sessions", "/admin/dashboard", "/"],
  }),
```

Import `DEFAULT_GROUP_POLICIES` từ `./group-policy`. Kiểm chiều import: `group-policy.ts` không được import `settings-registry.ts`, nếu không sẽ thành vòng.

- [ ] **Step 4: Chạy lại test**

Run: `npx vitest run src/lib/settings-registry.test.ts src/lib/settings-resolve.test.ts`
Expected: PASS. Chú ý test cũ trong `settings-resolve.test.ts` có bài khẳng định "bỏ qua ô không cho override theo buổi" dùng `appName`; bài đó vẫn phải xanh vì `appName` vẫn `perSession: false`.

Run: `npx tsc --noEmit` rồi `pnpm test`
Expected: exit 0, và số test tăng đúng số ca mới.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings-registry.ts src/lib/settings-registry.test.ts
git commit -m "feat(settings): add money policy settings with per-session override"
```

---

### Task 3: Nối bảng nhóm vào công thức chia tiền

**Files:**

- Modify: `src/lib/cost-calculator.ts`
- Test: `src/lib/cost-calculator.test.ts` (chỉ THÊM ca mới, không sửa ca cũ)

**Interfaces:**

- Consumes: `computeGroupPlayRates`, `GroupKey`, `DEFAULT_GROUP_POLICIES` từ Task 1.
- Produces: `calculateSessionCosts` nhận thêm `opts.policies` và `opts.genderPricingEnabled`; `AttendeeInput` nhận thêm `gender?: "male" | "female"`; `CostBreakdown` trả thêm `ratesByGroup`.

- [ ] **Step 1: Viết test trước**

Thêm vào cuối `src/lib/cost-calculator.test.ts` một khối mới. **Không sửa bất kỳ ca hiện có nào** — chúng là bằng chứng không đổi hành vi.

```ts
describe("calculateSessionCosts với chính sách nhóm (giai đoạn 3)", () => {
  it("không truyền policies thì kết quả y hệt trước đây", () => {
    // Dựng lại đúng một ca đã có ở phần trên của file này, gọi KHÔNG có
    // opts.policies, và so với con số ca đó đang khẳng định.
  });

  it("nữ cố định 50K: member nữ trả 50K, nam gánh phần còn lại", () => {
    // attendees có gender, genderPricingEnabled: true
  });

  it("tắt phân biệt nam nữ thì gender bị bỏ qua hoàn toàn", () => {
    // cùng attendees như ca trên nhưng genderPricingEnabled: false
    // → mọi member cùng suất, đúng như khi không có gender
  });

  it("khách của member ăn sàn riêng, khác sàn khách của admin", () => {
    // guestMember floor 40K, guestAdmin floor 60K
  });

  it("tổng thu bằng tổng chi cộng phần dư làm tròn, không bao giờ thiếu", () => {
    // với nhiều cấu hình khác nhau, Σ(suất × đầu) >= totalPlayCost
  });
});
```

Người thực thi task này phải viết đầy đủ phần thân từng ca, dùng đúng khuôn dựng `attendees` mà các ca cũ trong file đang dùng. Con số kỳ vọng tính tay theo thuật toán ở Task 1, ghi phép tính vào comment để người sau kiểm lại được.

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npx vitest run src/lib/cost-calculator.test.ts`
Expected: FAIL ở các ca mới, PASS ở toàn bộ ca cũ.

- [ ] **Step 3: Nối vào công thức**

Trong `calculateSessionCosts`:

- Thêm vào `opts`: `policies?: Record<GroupKey, GroupPolicy>` và `genderPricingEnabled?: boolean`.
- Phân loại từng đầu người chơi vào một trong sáu nhóm. Quy tắc: khách có `invitedById === adminMemberId` vào nhóm `guestAdmin*`, khách khác vào `guestMember*`, member vào `member*`. Đuôi `Female` chỉ khi `genderPricingEnabled` bật **và** `gender === "female"`; tắt thì mọi người vào nhóm nam. Đầu thứ hai của member đi 2 mình (phần `headcount` vượt 1) vào `guestMember`.
- Gọi `computeGroupPlayRates` một lần, lấy `ratesByGroup`.
- Tính `playAmount` của member theo suất nhóm của chính họ, `guestPlayAmount` theo suất nhóm khách tương ứng.
- Giữ `playCostPerHead` và `adminGuestPlayCostPerHead` trong `CostBreakdown` để mọi nơi đang đọc hai trường đó không vỡ: `playCostPerHead` = suất nhóm `member`, `adminGuestPlayCostPerHead` = suất nhóm `guestAdmin`. Thêm `ratesByGroup` cho ai cần chi tiết.
- Không truyền `policies` thì dùng `DEFAULT_GROUP_POLICIES`, và khi đó kết quả phải khớp nhánh cũ.

Giữ nguyên `computeGuestAwarePlayRates` (đừng xoá) vì `computePerHeadCharges` và các nơi xem trước đang dùng; task sau sẽ chuyển chúng dần.

- [ ] **Step 4: Chạy lại test và cổng**

Run: `npx vitest run src/lib/cost-calculator.test.ts`
Expected: PASS toàn bộ, **kể cả mọi ca cũ không sửa dòng nào**. Nếu một ca cũ đỏ thì dừng lại, đó là dấu hiệu thuật toán lệch chứ không phải test lỗi thời.

Run: `npx tsc --noEmit` rồi `pnpm test` rồi `pnpm build`
Expected: cả ba exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cost-calculator.ts src/lib/cost-calculator.test.ts
git commit -m "feat(finance): apply group policies in session cost calculation"
```

---

### Task 4: Chốt sổ đọc setting thay vì hằng số

**Files:**

- Modify: `src/actions/finance.ts` (quanh dòng 146 và 360)
- Test: `src/actions/finalize-group-policy.integration.test.ts` (tạo)

**Interfaces:**

- Consumes: `getSettings` từ `src/actions/settings.ts`; `calculateSessionCosts` sau Task 3.
- Produces: không có gì cho task sau, nhưng từ đây `finalizeSession` là nơi duy nhất quyết định cấu hình nào áp cho một buổi.

- [ ] **Step 1: Viết test trước**

Tạo `src/actions/finalize-group-policy.integration.test.ts`, chép phần dựng database thử từ một file `*.integration.test.ts` sẵn có trong `src/actions/`.

Bốn ca:

1. Không đổi setting: nợ và ledger ra đúng số như trước (lấy một ca từ `finalize-edge-cases.integration.test.ts` làm mốc).
2. Đổi `minDeductionAmount` lên 70K: member thiếu quỹ bị sàn 70K thay vì 60K.
3. Đổi `groupPolicies.guestAdmin` thành cố định 80K: khách của admin trả 80K, phần dư giảm cho nhóm chia đều.
4. Với cả ba ca trên: `Σ fund_deduction` khớp `Σ debt.totalAmount` (bất biến I1), và không dòng nợ nào mang cờ confirmed mà thiếu dòng ledger (bất biến I8).

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npx vitest run src/actions/finalize-group-policy.integration.test.ts`
Expected: FAIL ở ca 2 và 3 (setting chưa được đọc nên vẫn ăn hằng số).

- [ ] **Step 3: Đọc setting rồi truyền vào**

Trong `finalizeSession`, gọi `getSettings()` một lần ở đầu, rồi:

- Truyền `floor: settings.minDeductionAmount`, `policies: settings.groupPolicies`, `genderPricingEnabled: settings.genderPricingEnabled` vào `calculateSessionCosts`.
- Truyền `settings.minDeductionAmount` vào `applyMinDeductionFloor` (dòng 360) thay vì để nó dùng mặc định.

Chú ý hai cái sàn giờ là hai setting khác nhau: sàn khách nằm trong `groupPolicies.guestAdmin.amount`, sàn member thiếu quỹ là `minDeductionAmount`. Đừng dùng lẫn.

Lưu ý `opts.floor` của `calculateSessionCosts` đã bị bỏ ở fix round của Task 3 (nó không còn được đọc), nên đừng truyền nó.

- [ ] **Step 3b: Chốt luật khi hai loại sàn đụng nhau**

Admin đã quyết (13/8): **thiếu quỹ là phải trả đủ sàn tối thiểu, kể cả khi nhóm của họ đang được ưu đãi.** Ưu đãi chỉ có tác dụng với người còn quỹ.

Nghĩa là hành vi hiện tại của `applyMinDeductionFloor` đã đúng ý admin, **không sửa logic của nó**. Nhưng phải khoá luật lại bằng test, vì nhìn từ ngoài nó rất giống một lỗi:

Thêm hai ca cạnh nhau. Ca một: `groupPolicies.memberFemale` = cố định 50K, một member nữ có số dư KHÔNG đủ, chạy qua `calculateSessionCosts` rồi qua `applyMinDeductionFloor`, khẳng định kết quả là **60K chứ không phải 50K**. Ca hai (đối chứng): cùng cấu hình nhưng member nữ còn đủ quỹ thì trả đúng 50K. Chỉ một ca thì không thể hiện được luật.

Thêm comment ngay trên `applyMinDeductionFloor` nói rõ sàn này CỐ Ý đè lên mức ưu đãi theo nhóm khi member thiếu quỹ, đây là quyết định của admin ngày 13/8/2026, đừng "sửa" thành tôn trọng ưu đãi. Không có comment đó thì người sau sẽ đọc và tưởng là bug.

- [ ] **Step 3c: Đồng bộ đường xem trước, nếu không admin thấy một số mà bị trừ số khác**

Reviewer tài chính phát hiện `src/components/sessions/admin-vote-manager.tsx:429` **đang render thật** và gọi `computePerHeadCharges`, tức mô hình hai nhóm cũ, không biết gì về giới tính hay bảng sáu nhóm. Ngay khi Step 3 nối setting vào chốt sổ, admin sẽ thấy số xem trước khác số thực bị trừ quỹ.

Rà hết các nơi còn dùng đường cũ: `admin-session-card.tsx:353`, `session-list.tsx:649` và `:825`, `history-client.tsx:558`. (`finalize-session.tsx` là code chết, bỏ qua.)

Đây đều là client component nên không đọc được setting; server page phải lấy `getSettings()` rồi truyền xuống. Giai đoạn 1 đã dựng `SettingsProvider` cho đúng việc này, kiểm xem dùng lại được không trước khi thêm prop mới.

**Không được merge Step 3 mà thiếu Step 3c.** Một mình Step 3 đủ để tạo ra tình huống admin xem trước một con số rồi hệ thống trừ một con số khác, không cảnh báo gì.

- [ ] **Step 4: Chạy lại test và đối soát**

Run: `npx vitest run src/actions/finalize-group-policy.integration.test.ts`
Expected: PASS.

Run: `pnpm test`
Expected: PASS. Nếu `finalize-min-deduction.integration.test.ts` hay `finalize-admin-guest-income.integration.test.ts` đỏ, đọc kỹ: chúng chốt cứng 60K, 23K, 37K, 47K, 201K. Chỉ được sửa nếu giá trị mặc định vẫn cho ra đúng số cũ mà test chỉ cần đổi cách lấy hằng số; nếu số thay đổi thật thì thuật toán sai.

Chạy skill `reconcile-check`.
Expected: không báo lệch.

- [ ] **Step 5: Commit**

```bash
git add src/actions/finance.ts src/actions/finalize-group-policy.integration.test.ts
git commit -m "feat(finance): read money policy from settings when finalizing"
```

---

### Task 5: Section chia tiền trên trang Cài đặt

> **⛔ TASK NÀY BỊ CHẶN cho tới khi hai việc dưới đây xong. Đổi thứ tự so với bản plan đầu, lý do từ hai reviewer ngày 13/8.**
>
> Task 5 là thứ đầu tiên cho admin THỰC SỰ đổi được chính sách tiền. Trước khi có nó, mọi setting tiền đều nằm ở giá trị mặc định nên mọi rủi ro bên dưới đều ngủ. Ship Task 5 mà thiếu hai cái này là mở cửa cho hai kiểu sai tiền im lặng:
>
> **Cập nhật 14/8:** điều kiện 1 ĐÃ THOẢ (Task 10 xong, commits 559d4fa và e4d93f7). Điều kiện 2 đã đóng phần khách-của-member ở Task 4 fix round 2; phần ba nhóm nữ vẫn hở nhưng thực sự đang ngủ vì chưa có cột giới tính nào trong database, nên nó tự đóng ở chặng 2. Điều kiện 3 tách thành Task 14 ở trên. Nghĩa là Task 5 chỉ còn chờ Task 14, và khi làm Task 5 thì **chỉ hiện ba nhóm không phân biệt giới** (member, khách-của-member, khách-của-admin), ẩn ba nhóm nữ cho tới khi chặng 2 xong.
>
> 1. **Task 10 (đóng băng cấu hình lúc chốt sổ) phải xong TRƯỚC.** `finalizeSession` hiện luôn đọc setting HIỆN TẠI, kể cả khi chốt lại một buổi đã xong. Admin đổi sàn rồi bấm chốt lại buổi tháng trước là tiền đã settled bị tính lại theo cấu hình mới, không cảnh báo gì. Cột `sessions.settings_snapshot` đã tồn tại từ giai đoạn 1 nhưng chưa ai đọc hay ghi.
> 2. **Đường xem trước phải phân nhóm thật.** `computeGuestAwarePlayRates` đang gộp `guestMember`, `memberFemale`, `guestMemberFemale` vào chung rổ `member`. Hôm nay trùng số vì các nhóm đó đều ở chế độ chia đều. Ngay khi Task 5 hiện ô cho đặt `guestMember` khác `member`, bốn màn xem trước sẽ hiện số mà hệ thống không tính. Khách-của-member là dữ liệu có thật đang phát sinh hàng buổi, không phải trường hợp lý thuyết như giới tính (giới tính còn chưa có cột).
> 3. **Khách do chính admin mời qua phiếu vote của họ phải được phân loại đúng.** Lúc chốt sổ, quy tắc là `invitedById === adminMemberId`, nên khách admin mời qua dòng vote của chính mình cũng tính là khách-của-admin. Nhưng ba màn xem trước đang đếm nó vào khách-của-member: `admin-vote-manager.tsx` không nhận `adminMemberId` nên không thể tách, còn `admin-session-card.tsx` và `session-list.tsx` lấy `guestPlayCount − adminGuestPlayCount` nên phần khách trong phiếu vote của admin vẫn nằm lại. Lỗi này có từ trước (trước fix round 2 nó bị gộp vào `member`, cũng sai), đang ngủ vì chưa có ô nào cho đổi chính sách `guestMember`. Đóng nó cần thread `adminMemberId` xuống `admin-vote-manager` và tách được phần khách trong phiếu của admin ở hai màn kia — đúng những component Task 5 dù sao cũng phải chạm.
>
> Nếu vì lý do gì phải ship Task 5 sớm, thì bắt buộc chỉ hiện ô cho `member` và `guestAdmin`, ẩn hẳn bốn nhóm còn lại, và ghi rõ trong giao diện là chúng chưa dùng được. Cách đó cũng vô hiệu hoá luôn cả ba rủi ro trên, vì cả ba chỉ phát sinh khi `guestMember` hoặc các nhóm nữ rời khỏi chế độ chia đều.

**Files:**

- Create: `src/app/(admin)/admin/settings/section-money.tsx`
- Modify: `src/app/(admin)/admin/settings/settings-client.tsx`, ba file `src/i18n/messages/*.json`

**Interfaces:**

- Consumes: `AppSettings`, `updateSetting`, `computeGroupPlayRates`, `SectionCard`, `fireAction`.
- Produces: component `SectionMoney`.

- [ ] **Step 1: Dựng section**

Một ô số cho sàn member thiếu quỹ. Một công tắc phân biệt nam nữ (tắt thì ba dòng nữ trong bảng ẩn đi). Bảng sáu nhóm, mỗi dòng có bộ chọn cách tính (chia đều / sàn / cố định), ô số tiền (ẩn khi chọn chia đều), và tick "không trả cao hơn suất chia đều" (chỉ hiện khi chọn cố định).

Theo mẫu `section-thresholds.tsx` và `section-operations.tsx`: cập nhật lạc quan qua `fireAction`, `useEffect` đồng bộ khi prop đổi, ô số dùng `inputMode="numeric"` chứ không `type="number"`, mọi thứ bấm được cao tối thiểu `min-h-11`, chuỗi qua `useTranslations` và đủ ba file ngôn ngữ.

Ghi setting `groupPolicies` là ghi cả object, nên phải gộp thay đổi của một dòng lên object hiện tại rồi gửi trọn gói, đừng gửi từng dòng rời.

- [ ] **Step 2: Khối xem thử**

Dưới bảng, một khối cho admin nhập số người từng nhóm và tổng tiền giả định, rồi hiện suất từng nhóm. Nó gọi đúng `computeGroupPlayRates` mà đường chốt sổ dùng, nên không bao giờ lệch. Đây là chỗ admin tự kiểm hiểu đúng chưa trước khi áp lên tiền thật.

- [ ] **Step 3: Cắm vào trang**

Trong `settings-client.tsx`, render `<SectionMoney settings={settings} />` lên **đầu tiên**, trước các section khác, vì đây là phần quan trọng nhất.

- [ ] **Step 4: Chạy cổng**

Run: `npx tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`
Expected: cả bốn exit 0. `locale-parity.test.ts` phải xanh.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/settings" src/i18n/messages
git commit -m "feat(settings): add money policy section with live preview"
```

---

### Chặng 2: giới tính (task 6-9)

**Cái gì đã có sẵn, đừng làm lại.** `src/lib/cost-calculator.ts` đã gender-aware trọn vẹn và đang ngủ: `AttendeeInput.gender` có sẵn (dòng 63), `classifyHead` đã xếp ba nhóm nữ (dòng 564-575), `genderPricingEnabled` mặc định false nên tắt thì không ai đọc `gender` của ai. Chặng 2 KHÔNG sửa công thức. Nó chỉ làm ba việc: thêm cột vào DB, rót dữ liệu giới tính thật vào chỗ công thức đang đọc, và mở UI cho admin khai.

**Sửa một chỗ sai trong bản nháp trước (7/9, phát hiện khi đọc code thật).** Bản nháp viết ô "trong đó nữ" nằm ở màn vote của member. SAI. Member KHÔNG còn thêm được khách từ 7/7/2026: `vote-buttons.tsx:103` gọi `submitVote(sessionId, play, dine, 0, 0, partner)` với hai số 0 cứng, và server CỐ TÌNH bỏ qua hai tham số đó (comment ở `votes.ts:81-83`: ép 0 ở server để member không set khách qua RPC dù client không còn UI). Ô "trong đó nữ" phải nằm đúng chỗ khách được nhập thật:

- khách CỦA MEMBER: `admin-vote-manager.tsx` (`handleGuestChange` dòng 495-509 gọi `adminSetGuestCount`)
- khách CỦA ADMIN: control gọi `setAdminGuestCount` (`src/actions/sessions.ts:1430`)

**Năm đường ghi số đếm khách, task 7 phải đi hết cả năm.** Bỏ sót một đường là để lại khách nữ ma, hoặc số nữ vượt tổng khách:

| Đường                                          | Vai trò                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `votes.ts:114-134` (`submitVote`)              | member tự vote. Ghi cứng 0 cho khách, nên phải ghi cứng 0 cho cả hai cột nữ            |
| `votes.ts:180-205` (`adminSetVote`)            | admin bật/tắt cờ chơi/nhậu. Đang zero khách khi cờ tắt, phải zero cột nữ cùng câu lệnh |
| `votes.ts:253-295` (`adminSetGuestCount`)      | admin nhập khách của member. Đây là đường nhập thật                                    |
| `sessions.ts:1430-1470` (`setAdminGuestCount`) | admin nhập khách của chính mình                                                        |
| `votes.ts:299` (`adminRemoveVote`)             | xoá cả dòng vote nên không cần đụng, nhưng phải kiểm lại đúng là xoá dòng              |

---

### Task 6: Migration sáu cột cho giới tính

**Files:**

- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/0024_*.sql` và cập nhật `src/db/migrations/meta/_journal.json` (sinh bằng drizzle-kit, KHÔNG viết tay journal)

- [ ] **Step 1: Khai cột trong schema**

Sáu cột, toàn bộ nullable hoặc có default, để `ALTER TABLE ... ADD COLUMN` chạy được trên bảng đang có dữ liệu:

- `members.gender`: `text("gender", { enum: ["male", "female"] })`, nullable. Null = chưa khai, và calculator coi chưa khai là không-nữ (doc comment dòng 61-63: thà tính đủ còn hơn ưu đãi nhầm).
- `votes.guest_play_female_count`: integer, default 0
- `votes.guest_dine_female_count`: integer, default 0
- `sessions.admin_guest_play_female_count`: integer, default 0
- `sessions.admin_guest_dine_female_count`: integer, default 0
- `session_attendees.gender`: `text("gender", { enum: ["male", "female"] })`, nullable

Ràng buộc "số nữ không vượt tổng khách" giữ ở tầng app (zod), KHÔNG thêm `check()` vào DB. Lý do đã ghi sẵn trong schema cho cột `headcount` (`schema.ts:310-313`): thêm CHECK làm drizzle-kit sinh migration recreate-table, mà recreate-table trên Turso prod đã từng âm thầm làm rớt index.

- [ ] **Step 2: Sinh migration rồi ĐỌC file .sql bằng mắt**

Sinh bằng `pnpm db:generate`. TUYỆT ĐỐI không chạy `db:push`, `db:seed`, `db:clone-local`: `.env.local` trỏ DB PROD.

Mở file `.sql` vừa sinh, đọc từng dòng. Phải thấy đúng sáu câu `ALTER TABLE ... ADD ...` và không có bất kỳ câu nào trong nhóm: `CREATE TABLE __new_`, `DROP TABLE`, `INSERT INTO ... SELECT`, `PRAGMA`. Thấy một câu thuộc nhóm đó thì DỪNG, báo lại, không commit. Đối chiếu `0023_lean_storm.sql` để biết migration cộng cột thuần trông thế nào.

- [ ] **Step 3: Test lược đồ**

Chạy `pnpm test` để chắc mọi test tích hợp dựng DB từ schema vẫn xanh. Thêm một ca vào file integration sẵn có: ghi rồi đọc lại một member có `gender = "female"`, và một vote có `guestPlayFemaleCount = 2`. Ca này rẻ nhưng bắt được lỗi lệch tên cột giữa schema và migration.

- [ ] **Step 4: Verify và commit**

`npx tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`. Đọc mã thoát thật từng lệnh.

```bash
git commit -m "feat(db): add gender columns for members, guest counters and attendees"
```

⚠️ **Thứ tự deploy, ghi vào đây để lúc deploy không phải nhớ lại:** migration áp lên Turso prod TRƯỚC khi deploy code. Schema Drizzle khai cột mới thì mọi query `sessions`/`votes`/`members` sẽ liệt kê cột đó, nên code mới trên DB cũ là lỗi ngay từ request đầu. Đúng thứ tự đã chạy hôm 5/8: `node scripts/backup-db.mjs`, `node scripts/apply-migration.mjs`, kiểm `sqlite_master`, rồi mới deploy.

---

### Task 7: Rót giới tính thật vào đường chốt sổ

**Files:**

- Modify: `src/actions/finance.ts` (`FinalizeAttendee` dòng 41-49, insert attendee dòng 346-355, bung khách dòng 640-685)
- Modify: `src/actions/votes.ts` (bốn chỗ ở bảng đầu chặng)
- Modify: `src/actions/sessions.ts` (`setAdminGuestCount`)
- Modify: `src/lib/validators.ts`
- Create: `src/actions/finalize-gender.integration.test.ts`

- [ ] **Step 1: Ràng buộc số nữ trong zod**

Thêm cột nữ vào `voteSchema` và `adminGuestCountSchema` (`validators.ts:43-44, 106-110`), rồi thêm `.refine` trên cả hai object: số nữ chơi không vượt tổng khách chơi, số nữ nhậu không vượt tổng khách nhậu. Đặt `.refine` ở tầng object chứ không phải từng field, vì đây là ràng buộc giữa hai field.

Thông báo lỗi phải nói được số nào sai, đừng để lộ "invalid input" trần.

- [ ] **Step 2: `FinalizeAttendee` mang giới tính**

Thêm `gender?: "male" | "female"` vào `FinalizeAttendee` (finance.ts:41). Optional để mọi caller cũ và mọi test cũ biên dịch y nguyên.

Ghi nó vào DB ở câu insert attendee (finance.ts:346): thêm `gender: a.gender ?? null`. Đây là mắt xích quyết định, vì `session_attendees.gender` chính là chỗ calculator đọc lại khi tính từ attendee rows. Thiếu dòng này thì mọi thứ khác vô nghĩa.

- [ ] **Step 3: Bung số đếm khách thành dòng, có giới tính**

Ở `finalizeSessionAuto` (finance.ts:640-685):

- Dòng member: `gender: v.member?.gender ?? undefined`.
- Khách của member: có `gp` khách chơi, trong đó `gpf` nữ. Bung `gpf` dòng đầu với `gender: "female"`, `gp - gpf` dòng còn lại `gender: "male"`. Làm y hệt cho khách nhậu.
- Khách của admin: y hệt, đọc hai cột `admin_guest_*_female_count` của session.

Kẹp `gpf` bằng `Math.min(gpf, gp)` ngay tại đây, đừng chỉ tin zod. Zod chặn đường ghi mới, nhưng dòng dữ liệu cũ hoặc một đường ghi bị bỏ sót vẫn có thể cho `gpf > gp`, và khi đó vòng lặp sinh ra nhiều khách hơn số khách thật, tức là chia tiền cho người không tồn tại. Đây là lỗi tiền, phải chặn ở chỗ dùng.

Query `session.votes` trong `finalizeSessionAuto` (finance.ts:597-599) dùng `with: { member: true }` nên đã có `gender`, không cần sửa query. Kiểm lại bằng mắt trước khi code, đừng tin dòng này.

- [ ] **Step 4: Zero cột nữ ở mọi đường ghi**

Đi hết năm đường ở bảng đầu chặng 2. `submitVote` ghi cứng 0 cho hai cột nữ. `adminSetVote` zero cột nữ trong CÙNG câu `onConflictDoUpdate` đang zero cột khách (`votes.ts:201-202`), không thêm câu update thứ hai.

- [ ] **Step 5: Test tích hợp qua DB thật**

Tạo `src/actions/finalize-gender.integration.test.ts`. Năm ca:

1. **Công tắc TẮT (mặc định): tiền y hệt trước khi có chặng 2.** Dựng buổi có member nữ và khách nữ, chốt sổ, khẳng định từng `totalAmount` khớp số tính tay theo cách chia cũ. Đây là ca chống hồi quy quan trọng nhất của cả chặng.
2. Công tắc BẬT, nhóm nữ đặt mức cố định: member nữ trả đúng mức đó, phần thiếu chia lại cho nhóm chia đều.
3. Khách nữ của member và khách nữ của admin vào đúng hai nhóm khác nhau (`guestMemberFemale` và `guestAdminFemale`), không lẫn.
4. `members.gender` null thì tính như không-nữ: không lỗi, không suất ưu đãi.
5. Sau mọi ca: `Σ fund_deduction` khớp `Σ debt.totalAmount` (I1), và không dòng nợ nào có cờ confirmed mà thiếu dòng ledger (I8).

Thêm một ca cho đường zero: bật cờ chơi, đặt 3 khách trong đó 2 nữ, tắt cờ chơi, đọc lại dòng vote, cả `guest_play_count` lẫn `guest_play_female_count` phải về 0.

- [ ] **Step 6: Verify và commit**

Bốn cổng tĩnh, `pnpm test:e2e`, và skill `reconcile-check` (bắt buộc, task này đụng đường chốt sổ).

```bash
git commit -m "feat(finance): carry member and guest gender into session attendees"
```

---

### Task 8: Admin khai giới tính cho member

**Files:**

- Modify: trang thành viên `src/app/(admin)/admin/members/member-list.tsx` và action tạo/sửa member trong `src/actions/members.ts`
- Modify: `src/app/(admin)/admin/settings/section-money.tsx` (cảnh báo còn ai chưa khai)
- Modify: `src/i18n/messages/{vi,en,zh}.json`

- [ ] **Step 1: Ô chọn giới tính ở form member**

Ba trạng thái: chưa khai (mặc định, giữ null), nam, nữ. KHÔNG ép admin chọn. Bắt buộc chọn sẽ chặn admin sửa việc khác trên member cũ chỉ vì thiếu một field họ chưa cần.

Server action validate qua zod enum, cho phép null. Optimistic và rollback theo `fireAction` như mọi control khác trên trang này.

- [ ] **Step 2: Cảnh báo trên trang Cài đặt**

Trong section chia tiền, và chỉ khi `genderPricingEnabled` bật: hiện dòng "còn N thành viên chưa khai giới tính, họ đang được tính như nam", kèm link sang trang thành viên. Tắt công tắc thì không hiện gì.

Đếm ở server (trang Cài đặt là Server Component), truyền xuống một con số. Không truyền danh sách tên: đó là dữ liệu cá nhân không cần thiết để hiển thị một con số.

- [ ] **Step 3: Test, verify, commit**

Test component cho ô chọn (ba trạng thái, rollback khi action lỗi) và cho cảnh báo (tắt công tắc thì không render; bật mà N=0 thì không render; bật và N>0 thì render đúng số). Bốn cổng tĩnh.

```bash
git commit -m "feat(members): let admin declare member gender"
```

---

### Task 9: Ô "trong đó nữ" cho khách, và mở ba nhóm nữ trên trang Cài đặt

**Files:**

- Modify: `src/components/sessions/admin-vote-manager.tsx`
- Modify: control khách-của-admin (chỗ gọi `setAdminGuestCount`)
- Modify: `src/lib/cost-calculator.ts` (`classifyGuestPlayHeads`, dòng 448-470)
- Modify: `src/app/(admin)/admin/settings/section-money.tsx` (`VISIBLE_GROUPS`)
- Modify: `src/i18n/messages/{vi,en,zh}.json`

- [ ] **Step 1: Ô nhập số khách nữ**

Mọc ngay dưới ô đếm khách đang có, chỉ khi `genderPricingEnabled` bật. Tắt thì màn quản lý vote không đổi một chữ, và phải có test khẳng định điều đó.

Chặn trên là tổng khách của chính ô đó. Giảm tổng khách xuống dưới số nữ thì kẹp số nữ xuống theo, ngay trên client. Đừng để server trả lỗi cho một thao tác mà admin không hiểu vì sao sai.

Vùng chạm tối thiểu 44px. Giữ optimistic và rollback đang có.

- [ ] **Step 2: Đường xem trước phải tách được khách nữ**

`classifyGuestPlayHeads` hiện trả hai số (`guestMemberPlayHeads`, `adminGuestPlayHeads`). Mở rộng thành bốn, tách phần nữ ra. Đây chính là hàm Task 14 vừa tạo để màn xem trước khớp lúc chốt sổ; không mở rộng nó thì xem trước hiện một số, chốt sổ ra số khác, đúng cái bệnh Task 14 vừa chữa.

Test hàm thuần trước, rồi mới nối vào UI.

- [ ] **Step 3: Mở ba nhóm nữ trên trang Cài đặt**

Task 5 để ba nhóm nữ ngoài `VISIBLE_GROUPS` (`section-money.tsx:26`) trong khi giá trị vẫn round-trip nguyên vẹn. Giờ cho chúng vào danh sách, nhưng chỉ render khi `genderPricingEnabled` bật.

Kiểm lại hai thứ sau khi sửa: chỗ ghi vẫn gửi trọn sáu nhóm (ràng buộc chặn của Task 5), và cách xếp hàng ghi mà Task 5 vừa thêm vẫn còn nguyên.

- [ ] **Step 4: Mở rộng e2e**

Thêm vào `e2e/admin-money-policy.spec.ts` một luồng: bật công tắc, đặt nhóm nữ mức cố định, khai một member là nữ, nhập một khách nữ, chốt sổ, khẳng định số tiền từng người bằng số tính tay. Đây là ca đầu cuối duy nhất chứng minh cả chặng 2 chạy thật.

Giữ ca cũ (công tắc tắt) trong cùng file. Hai ca cạnh nhau mới chứng minh bật tắt đúng cả hai chiều.

- [ ] **Step 5: Verify và commit**

Bốn cổng tĩnh, `pnpm test:e2e` chạy MỘT MÌNH, và skill `reconcile-check`.

```bash
git commit -m "feat(sessions): add female guest count and reveal female money groups"
```

### Chặng 3: đóng băng cấu hình (task 10-11)

### Task 10: Đóng băng cấu hình lúc chốt sổ

> **Task này đã được ĐẨY LÊN TRƯỚC Task 5** (quyết định 13/8, sau review Task 4). Lý do ở phần cảnh báo đầu Task 5.

**Files:**

- Create: `src/lib/session-money-settings.ts`
- Modify: `src/actions/finance.ts`
- Test: `src/lib/session-money-settings.test.ts`, `src/actions/finalize-snapshot.integration.test.ts`

**Interfaces:**

- Consumes: `AppSettings` và `SETTINGS` từ registry, `resolveForSession` từ `src/lib/settings-resolve.ts` (hàm này viết từ giai đoạn 1 và tới nay CHƯA có caller thật nào ngoài test, Task 10 là chỗ đầu tiên dùng nó thật), `getSettings` từ `src/actions/settings.ts`.
- Produces: `resolveSessionSettings({ global, override, snapshot })` trả `{ settings: AppSettings; fromSnapshot: boolean }`, và `serializeSnapshot(settings): string`.

**Vấn đề đang có:** `finalizeSession` gọi `getSettings()` (`src/actions/finance.ts:138`) và luôn lấy cấu hình **hiện tại**, kể cả khi chốt lại một buổi đã xong. Chốt lại được phép (`finance.ts:81-84` cho phép re-finalize, và nó đảo khoản trừ cũ rồi ghi mới). Nên admin đổi sàn rồi bấm chốt lại buổi tháng trước là tiền đã settled bị tính lại theo cấu hình mới, không cảnh báo gì. Cột `sessions.settings_snapshot` tồn tại từ migration 0023 nhưng chưa ai đọc hay ghi.

- [ ] **Step 1: Viết test cho hàm thuần trước**

Tạo `src/lib/session-money-settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  resolveSessionSettings,
  serializeSnapshot,
} from "./session-money-settings";
import { defaultSettings } from "./settings-registry";

describe("resolveSessionSettings", () => {
  const global = { ...defaultSettings(), minDeductionAmount: 70_000 };

  it("chưa có snapshot thì dùng setting hiện tại, và báo là cần ghi snapshot", () => {
    const r = resolveSessionSettings({
      global,
      override: null,
      snapshot: null,
    });
    expect(r.settings.minDeductionAmount).toBe(70_000);
    expect(r.fromSnapshot).toBe(false);
  });

  it("có snapshot thì dùng snapshot, KHÔNG dùng setting hiện tại", () => {
    const frozen = serializeSnapshot({
      ...defaultSettings(),
      minDeductionAmount: 60_000,
    });
    const r = resolveSessionSettings({
      global,
      override: null,
      snapshot: frozen,
    });
    // global đang 70K nhưng buổi này đã đóng băng ở 60K
    expect(r.settings.minDeductionAmount).toBe(60_000);
    expect(r.fromSnapshot).toBe(true);
  });

  it("snapshot hỏng thì rơi về setting hiện tại chứ không ném lỗi, và báo chưa có snapshot", () => {
    const r = resolveSessionSettings({
      global,
      override: null,
      snapshot: "{{{",
    });
    expect(r.settings.minDeductionAmount).toBe(70_000);
    expect(r.fromSnapshot).toBe(false);
  });

  it("snapshot thắng cả override của buổi", () => {
    const frozen = serializeSnapshot({
      ...defaultSettings(),
      minDeductionAmount: 50_000,
    });
    const r = resolveSessionSettings({
      global,
      override: JSON.stringify({ minDeductionAmount: 80_000 }),
      snapshot: frozen,
    });
    expect(r.settings.minDeductionAmount).toBe(50_000);
  });

  it("chưa có snapshot thì override của buổi vẫn đè setting chung", () => {
    const r = resolveSessionSettings({
      global,
      override: JSON.stringify({ minDeductionAmount: 80_000 }),
      snapshot: null,
    });
    expect(r.settings.minDeductionAmount).toBe(80_000);
  });
});
```

Vì sao snapshot thắng cả override: snapshot là ảnh chụp cấu hình **đã áp dụng thật** lúc chốt, mà cấu hình đó vốn đã gộp override vào rồi. Đọc lại override sau đó là đọc một giá trị có thể đã bị admin sửa sau khi buổi chốt xong.

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npx vitest run src/lib/session-money-settings.test.ts`
Expected: FAIL, không tìm thấy module.

- [ ] **Step 3: Viết hàm thuần**

Snapshot lưu **toàn bộ `AppSettings`**, không phải chỉ ba key tiền. Lý do: thêm setting tiền mới sau này mà quên thêm vào danh sách snapshot là một lỗi im lặng đúng loại chúng ta đang cố diệt; lưu tất thì không thể quên. Các key không liên quan tiền (tên nhóm chẳng hạn) bị đóng băng theo cũng vô hại vì `finalizeSession` không đọc chúng.

Parse snapshot phải đi qua `SETTINGS[key].schema` giống `resolveGlobal`, và key hỏng thì rơi về giá trị của tầng dưới thay vì ném lỗi. Một snapshot hỏng không được làm admin không chốt được sổ.

- [ ] **Step 4: Nối vào finalizeSession**

Thay `const settings = await getSettings()` (`finance.ts:138`) bằng: đọc global settings, đọc `session.settingsOverride` và `session.settingsSnapshot` từ hàng session đã query, rồi gọi `resolveSessionSettings`.

Sau khi transaction chốt sổ thành công, nếu `fromSnapshot` là false thì ghi `settings_snapshot` cho buổi đó. Ghi **trong cùng transaction** với phần chốt sổ, không phải sau: nếu ghi ngoài mà transaction rollback thì buổi bị đóng băng một cấu hình chưa từng được dùng để tính tiền.

Cẩn thận thứ tự: query lấy `session` hiện tại có `columns` giới hạn không? Nếu có, phải thêm `settingsOverride` và `settingsSnapshot` vào đó, không thì chúng về `undefined` và snapshot không bao giờ được đọc — một lỗi im lặng mà test đọc-ghi qua DB sẽ bắt được nhưng test hàm thuần thì không.

- [ ] **Step 5: Test tích hợp qua DB thật**

Tạo `src/actions/finalize-snapshot.integration.test.ts`, chép cách dựng DB thử từ một file `*.integration.test.ts` sẵn có.

Bốn ca, ca thứ hai là ca quan trọng nhất của cả task:

1. Chốt sổ lần đầu: sau khi xong, `sessions.settings_snapshot` khác null và parse ra đúng cấu hình vừa dùng.
2. **Đổi setting rồi chốt lại buổi đó: số tiền từng member KHÔNG đổi.** Cụ thể: chốt với sàn 60K, ghi lại các `totalAmount`, đổi `minDeductionAmount` lên 90K, chốt lại, khẳng định từng `totalAmount` y hệt lần đầu. Đây là toàn bộ lý do task này tồn tại.
3. Buổi chốt lần đầu **sau khi** admin đã đổi setting thì dùng cấu hình mới (snapshot chưa tồn tại nên không đóng băng gì).
4. Sau mọi ca trên, `Σ fund_deduction` vẫn khớp `Σ debt.totalAmount` (bất biến I1) và không dòng nợ nào mang cờ confirmed mà thiếu dòng ledger (I8).

- [ ] **Step 6: Verify và đối soát**

- `npx vitest run` trên hai file test mới cộng `finalize-min-deduction.integration.test.ts` và `finalize-admin-guest-income.integration.test.ts`
- `npx tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`
- `pnpm test:e2e`
- Chạy skill `reconcile-check`, bắt buộc vì task này đụng đường chốt sổ.

Đọc mã thoát thật từng lệnh.

- [ ] **Step 7: Commit**

```bash
git add src/lib/session-money-settings.ts src/lib/session-money-settings.test.ts src/actions/finance.ts src/actions/finalize-snapshot.integration.test.ts
git commit -m "feat(finance): freeze money settings into session snapshot on finalize"
```

### Task 11: Bỏ đóng băng cấu hình cho một buổi cũ

Task 10 đóng băng cấu hình để chốt lại một buổi cũ không âm thầm tính lại tiền đã settled. Task 11 là cái van xả có chủ ý: admin muốn buổi cũ đó tính theo cấu hình hiện tại thì phải tự tay chọn, và phải biết mình đang làm đổi tiền lịch sử.

**Quyết định thiết kế, đọc trước khi code.** Xoá snapshot MỘT MÌNH không đổi một đồng nào. Buổi `completed` chỉ tính lại tiền khi được chốt lại, mà `finalizeSessionAuto` từ chối buổi `completed` (`src/actions/finance.ts:603`), nên đường duy nhất là mở lại buổi rồi chốt lại. Vì vậy KHÔNG làm một nút "xoá snapshot" đứng riêng: nó để lại trạng thái lơ lửng mà admin không thấy hiệu lực, rồi quên. Gộp nó thành một ô tích trong hộp xác nhận mở lại buổi đang có sẵn (`session-list.tsx:1224-1248`), mặc định TẮT. Admin tích thì mở khoá và bỏ đóng băng cùng lúc, lần chốt kế tiếp tính theo cấu hình hiện tại.

**Files:**

- Modify: `src/actions/sessions.ts` (`unlockSession`, dòng 704)
- Modify: `src/app/(admin)/admin/sessions/page.tsx` (thêm 1 field vào map `sessionCards`, dòng 230-323)
- Modify: `src/app/(admin)/admin/sessions/session-list.tsx` (`SessionCard` dòng 97-131, hộp xác nhận dòng 1224-1248)
- Modify: `src/i18n/messages/{vi,en,zh}.json`
- Create: `src/actions/unlock-clear-snapshot.integration.test.ts`

- [ ] **Step 1: Thêm tham số opt-in vào `unlockSession`**

Đổi chữ ký thành `unlockSession(sessionId: number, clearSettingsSnapshot = false)`. Mặc định `false` là điều kiện bắt buộc, không phải cho gọn: `unlockSession` là action đang chạy production, có sẵn test tích hợp ở `src/actions/sessions-reopen-unlock.integration.test.ts`. Mặc định false thì mọi caller cũ và mọi test cũ hành xử y hệt, thay đổi này là thuần cộng thêm.

Trong transaction đã có, khi và chỉ khi `clearSettingsSnapshot` là true thì thêm `settingsSnapshot: null` vào câu `tx.update(sessions)` đang đổi status. Ghi CÙNG câu lệnh đó, không thêm câu update thứ hai: hai câu là hai cơ hội để một câu thành công còn câu kia rollback, để lại buổi mở khoá mà vẫn đóng băng (hoặc ngược lại).

Không thêm nhánh nào khác. Cụ thể là KHÔNG tự động chốt lại buổi sau khi mở khoá.

- [ ] **Step 2: Đưa cờ "buổi này đang đóng băng" ra client**

`SessionCard` (`session-list.tsx:97`) là shape đã whitelist tay, nên phải thêm field mới vào cả interface lẫn map ở `page.tsx`.

Thêm `hasSettingsSnapshot: boolean`, tính bằng `s.settingsSnapshot !== null`. Truyền BOOLEAN, tuyệt đối không truyền chuỗi JSON thô: gửi cả cấu hình đã đóng băng của mười buổi vào payload RSC là phình vô ích, và trái nguyên tắc chỉ whitelist cột cho payload ra client ([[feedback-redact-public-payload]]).

Query ở `page.tsx:159` không có `columns:` nên đã lấy sẵn mọi cột, không cần sửa query.

- [ ] **Step 3: Ô tích trong hộp xác nhận mở lại buổi**

`ConfirmDialog` nhận `children` render giữa phần mô tả và hàng nút (xem doc comment ở `src/components/shared/confirm-dialog.tsx`), dùng đúng chỗ đó.

Hành vi:

- Ô tích CHỈ mọc khi buổi đang mở hộp xác nhận có `hasSettingsSnapshot === true`. Buổi chưa từng chốt thì không có gì để bỏ đóng băng, hiện ô tích ở đó chỉ làm admin hoang mang.
- Mặc định KHÔNG tích. Đây là hành vi mặc định an toàn: mở khoá để sửa nhầm một dòng attendee thì không nên kéo theo tính lại toàn bộ tiền theo cấu hình mới.
- Reset về không tích mỗi lần hộp xác nhận đóng, kể cả khi admin bấm huỷ. Trạng thái tích còn sót lại từ lần trước là bẫy: lần sau admin mở buổi khác và bấm xác nhận là tiền đổi mà họ không hề tích.
- Nhãn nói rõ hậu quả, không nói kỹ thuật. Không dùng chữ "snapshot" trong text người dùng đọc.
- Vùng chạm tối thiểu 44px (rubric mobile-first), ô tích và nhãn cùng bấm được.

Giữ nguyên optimistic + rollback đang có ở `onConfirm`: chỉ truyền thêm tham số thứ hai vào `unlockSession(id, clear)`.

Khoá i18n mới, thêm cả ba file `vi`/`en`/`zh`:

- tiêu đề/nhãn ô tích: đại ý "Tính lại tiền theo cài đặt hiện tại"
- dòng giải thích: đại ý "Buổi này đang giữ cài đặt chia tiền lúc chốt lần đầu. Tích vào đây thì lần chốt tới sẽ tính lại theo cài đặt hiện tại, số tiền của từng người có thể đổi."

- [ ] **Step 4: Test tích hợp qua DB thật**

Tạo `src/actions/unlock-clear-snapshot.integration.test.ts`, chép cách dựng DB thử từ `sessions-reopen-unlock.integration.test.ts`.

Bốn ca:

1. `unlockSession(id)` không truyền cờ: `settings_snapshot` GIỮ NGUYÊN. Đây là ca chống hồi quy cho hành vi production hiện tại, quan trọng nhất trong bốn ca.
2. `unlockSession(id, true)`: `settings_snapshot` về null, và status vẫn đổi đúng như ca 1.
3. Chốt lại sau khi đã bỏ đóng băng thì tiền tính theo cấu hình HIỆN TẠI. Cụ thể: chốt với sàn khách 60K, ghi lại `totalAmount` từng người, đổi `groupPolicies.guestAdmin.amount` lên 90K, mở khoá CÓ tích, chốt lại, khẳng định số tiền đã đổi theo 90K. Ca này là cặp đối chiếu của ca 2 trong Task 10 (ở đó số tiền phải KHÔNG đổi); hai ca đứng cạnh nhau mới chứng minh cái van xả hoạt động đúng chiều.
4. Sau ca 3, `Σ fund_deduction` vẫn khớp `Σ debt.totalAmount` (I1), và không dòng nợ nào mang cờ confirmed mà thiếu dòng ledger (I8).

- [ ] **Step 5: Verify**

- `npx vitest run` trên file test mới cộng `sessions-reopen-unlock.integration.test.ts` và `finalize-snapshot.integration.test.ts`
- `npx tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`
- `pnpm test:e2e`
- Chạy skill `reconcile-check`, bắt buộc vì task này đụng đường mở khoá tài chính.

Đọc mã thoát THẬT của từng lệnh. `grep -c` không khớp gì thì thoát 1, trông như đỏ nhưng không phải.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(sessions): let admin drop frozen money settings when unlocking a session"
```

**Ngoài phạm vi task này:** nút bỏ đóng băng đứng riêng (không kèm mở khoá), sửa cấu hình riêng cho từng buổi (`settings_override` hiện chưa có UI nào ghi vào), và tính lại hàng loạt nhiều buổi một lượt.

### Task 12: Kiểm thử đầu cuối cho cả giai đoạn

**Files:**

- Create: `e2e/admin-money-policy.spec.ts`
- Create: `e2e/gender-pricing.spec.ts`

**Interfaces:**

- Consumes: mọi thứ ở trên.
- Produces: không.

Chép cách đăng nhập admin và cách ghi thẳng vào `e2e/local.db` từ `e2e/admin-settings-behavior.spec.ts` (bài đó đã làm đúng kiểu: set setting trong database rồi mở trang và khẳng định giao diện đổi theo).

- [ ] **Step 1: E2E cho chính sách tiền**

Ba kịch bản, mỗi cái phải đi hết chuỗi từ database qua giao diện chứ không chỉ kiểm một tầng:

1. Đổi `groupPolicies.guestAdmin` sang cố định 80K trong `local.db`, mở trang Cài đặt, khẳng định bảng nhóm hiện đúng chế độ và số tiền đó. Sau đó đổi trên giao diện, tải lại trang, khẳng định giá trị được giữ.
2. Đổi `minDeductionAmount` lên 70K, mở một buổi đang mở vote, khẳng định con số dự kiến trên thẻ buổi phản ánh sàn mới.
3. Khối xem thử: nhập số người vào khối đó và khẳng định suất hiện ra khớp con số tính tay của thuật toán ở Task 1. Đây là lớp chứng minh giao diện và đường chốt sổ dùng chung một hàm.

- [ ] **Step 2: E2E cho phân biệt nam nữ**

1. Công tắc **tắt** (mặc định): mở màn vote, khẳng định **không** có ô "trong đó nữ" nào. Đây là bài chặn hồi quy quan trọng nhất của chặng 2, vì phần lớn người dùng sẽ không bật tính năng này và màn vote của họ không được đổi một chữ.
2. Bật công tắc trong `local.db`, tải lại màn vote, khẳng định ô "trong đó nữ" xuất hiện và không cho nhập lớn hơn tổng số khách.
3. Trang Cài đặt hiện cảnh báo số member chưa khai giới tính, và số đó khớp dữ liệu trong `local.db`.

- [ ] **Step 3: Chạy và đọc mã thoát**

Run: `pnpm build` rồi `pnpm test:e2e`
Expected: cả hai exit 0. Mốc hiện tại là 42 bài; con số của bạn phải là 42 cộng số bài mới, không bài cũ nào đỏ.

Nếu bài `admin-google.spec.ts:48` đỏ ở lượt đầu, chạy lại trước khi đào: nó chập chờn khi máy chủ khởi động nguội, đã ghi nhận 5/8/2026.

- [ ] **Step 4: Commit**

```bash
git add e2e/admin-money-policy.spec.ts e2e/gender-pricing.spec.ts
git commit -m "test(finance): add e2e coverage for money policy and gender pricing"
```

### Task 14: Đóng nốt điều kiện chặn Task 5 — phân loại khách đúng ở đường xem trước

> Task này gỡ điều kiện chặn số 3 của Task 5. Sinh ra sau review Task 4 (14/8).

**Files:**

- Modify: `src/components/sessions/admin-vote-manager.tsx`, `src/components/sessions/admin-session-card.tsx`, `src/app/(admin)/admin/sessions/session-list.tsx`, và các server page bơm props cho chúng
- Test: bổ sung ca vào test sẵn có của các component đó, cộng một ca e2e

**Vấn đề:** lúc chốt sổ, một khách được xếp vào nhóm khách-của-admin khi `invitedById === adminMemberId`, **bất kể** khách đó được thêm qua ô đếm khách-của-admin hay qua dòng vote của chính admin. Ba màn xem trước hiện chỉ trừ được phần ô đếm: `guestPlayCount − adminGuestPlayCount`. Phần khách nằm trong phiếu vote của admin vẫn bị tính vào khách-của-member. Nên khi Task 5 cho đặt chính sách riêng cho khách-của-member, ba màn đó hiện một số mà hệ thống không tính.

- [ ] **Step 1: Đưa việc phân loại về server**

Đừng thêm `adminMemberId` xuống client rồi để client tự trừ. Client trừ sai là đúng cái lỗi này. Thay vào đó, **server tính sẵn số đầu khách-của-member đúng nghĩa** rồi truyền xuống như một con số đã chốt.

Server có đủ dữ liệu: nó có danh sách vote và có `adminMemberId` (qua `resolveAdminMemberId`, xem `src/actions/finance.ts:95`). Số cần tính là tổng `guestPlayCount` của các phiếu **không phải** của admin. Cộng thêm ô đếm khách-của-admin thì ra khách-của-admin.

Làm ở mọi server page đang bơm props cho ba component: trang danh sách buổi, trang chi tiết buổi, và dashboard nếu nó cũng render. Tìm hết bằng cách lần theo nơi khai báo prop, đừng đoán.

**Quan trọng:** dùng đúng một hàm dùng chung để tính, đừng viết lại phép tính ở từng page. Ba bản sao của một quy tắc phân loại tiền là đúng thứ vừa gây ra lỗi này. Đặt hàm đó cạnh `src/lib/cost-calculator.ts` hoặc trong `src/lib/` và cho cả ba page gọi.

- [ ] **Step 2: `admin-vote-manager` có trạng thái lạc quan, xử lý riêng**

Component này khác hai màn kia: nó giữ trạng thái vote lạc quan trong bộ nhớ (admin bấm thay đổi vote của member ngay trên màn). Nên số đầu khách-của-member ở đây phải tính lại từ trạng thái lạc quan đó, không thể chỉ nhận một con số tĩnh từ server.

Cách giải: server truyền `adminMemberId` xuống component này (chỉ component này), và component tự loại phiếu của admin khi tính tổng khách-của-member từ trạng thái lạc quan. Ở đây client tự tính là chấp nhận được vì nó là nơi duy nhất biết trạng thái chưa lưu, nhưng nó phải dùng đúng quy tắc `invitedById === adminMemberId`.

Kiểm cả hai chỗ trong file này đã sửa ở Task 4 (`displayMemberAmount` và `predictedDebt`) có cần cập nhật theo không.

- [ ] **Step 3: Test**

Ba ca tối thiểu:

1. Admin tự vote chơi và thêm một khách qua dòng vote của mình: số xem trước phải khớp con số lúc chốt sổ, tức khách đó tính theo chính sách khách-của-admin. Dựng chính sách khách-của-member khác hẳn khách-của-admin để hai đường cho số khác nhau nếu phân loại sai.
2. Member thường thêm khách: vẫn tính theo chính sách khách-của-member.
3. Cả hai cùng lúc trong một buổi.

Ca 1 là ca chặn hồi quy chính. Nếu nó vẫn xanh khi ta cố ý phân loại sai thì nó vô dụng, nên kiểm bằng cách tạm phân loại sai và xác nhận nó đỏ.

- [ ] **Step 4: Verify và commit**

`npx tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e` (chạy một mình). Đọc mã thoát thật. Chạy `reconcile-check` nếu có đụng `finance.ts`.

```bash
git commit -m "fix(sessions): classify admin-invited guests correctly in cost preview"
```

### Task 13: Hotline và email liên hệ, hiện ở màn vote

> Việc này admin yêu cầu thêm ngày 14/8. **Không đụng tiền**, độc lập hoàn toàn với chuỗi Task 5 tới 9, nên làm được ngay không cần chờ điều kiện chặn nào.

**Files:**

- Modify: `src/lib/settings-registry.ts`, `src/app/(admin)/admin/settings/section-operations.tsx`, `src/app/(public)/vote/[id]/page.tsx`, ba file `src/i18n/messages/*.json`
- Create: component hiển thị khối liên hệ, đặt cạnh các component vote sẵn có
- Test: `src/lib/settings-registry.test.ts` (thêm ca), `e2e/vote-contact.spec.ts`

**Interfaces:**

- Consumes: `updateSetting`, `getSettings`, `SettingsProvider` nếu cần phía client.
- Produces: hai setting `contactHotline` và `contactEmail`.

- [ ] **Step 1: Hai setting mới trong registry**

Cả hai `perSession: false` (thông tin liên hệ của nhóm, không việc gì khác nhau theo từng buổi), mặc định **chuỗi rỗng**. Rỗng có nghĩa là chưa cấu hình, và khi rỗng thì màn vote không hiện gì cả, không hiện khối trống hay chữ "chưa có".

Validate: hotline nhận chuỗi rỗng hoặc dãy số điện thoại Việt Nam (cho phép dấu cách, dấu chấm, dấu gạch ngang, đầu số `0` hoặc `+84`); email nhận chuỗi rỗng hoặc một email hợp lệ. Đừng bắt buộc phải có cả hai, admin có thể chỉ điền một cái.

Viết test cho cả hai: giá trị hợp lệ, chuỗi rỗng, và giá trị rác bị chặn.

- [ ] **Step 2: Ô nhập ở trang Cài đặt**

Thêm vào `section-operations.tsx` (mục Vận hành), đúng chỗ cùng với tên nhóm và thông tin chuyển khoản, vì đây cùng loại thông tin cấu hình của nhóm.

Theo mẫu sẵn có trong file đó: cập nhật lạc quan qua `fireAction`, `useEffect` đồng bộ khi prop đổi, ghi khi rời ô chứ không ghi mỗi ký tự, vùng chạm tối thiểu `min-h-11`. Ô hotline dùng `inputMode="tel"`, ô email dùng `type="email"` với `inputMode="email"` để điện thoại hiện đúng bàn phím.

Với hai ô này, tắt chế độ thử lại của `fireAction` như đã làm cho các ô có validate ở phía server: gõ sai định dạng thì gọi lại lần hai cũng sai y như vậy.

- [ ] **Step 3: Hiện ở màn vote**

`src/app/(public)/vote/[id]/page.tsx` là server component và đã chặn chưa đăng nhập (`if (!user) redirect("/login")`), nên đọc `getSettings()` trực tiếp tại đó được, không cần đi qua context.

Hiện một khối liên hệ nhỏ ở cuối màn, dưới phần bình chọn. Nội dung: số hotline bấm gọi được (`tel:`) và email bấm mở được (`mailto:`). Chỉ hiện những cái đã cấu hình; cả hai rỗng thì không render gì.

Mobile first: đây là màn member dùng trên điện thoại trong trình duyệt Zalo hoặc Messenger. Hai liên kết phải là vùng chạm tối thiểu 44px, không phải chữ nhỏ chen chúc. Số điện thoại dài không được làm tràn ngang.

Chuỗi hiển thị thêm đủ ba file ngôn ngữ, có test chặn lệch khoá.

- [ ] **Step 4: E2E**

Tạo `e2e/vote-contact.spec.ts`, chép cách đăng nhập member và cách ghi thẳng vào `e2e/local.db` từ `e2e/admin-settings-behavior.spec.ts`.

Ba ca:

1. Chưa cấu hình gì (cả hai rỗng): mở màn vote, khẳng định **không** có khối liên hệ nào. Đây là ca chặn hồi quy quan trọng nhất, vì hôm nay chưa ai cấu hình nên đa số người dùng sẽ ở trạng thái này và màn vote của họ không được đổi.
2. Cấu hình cả hai: khối hiện, liên kết `tel:` và `mailto:` đúng giá trị.
3. Chỉ cấu hình một trong hai: chỉ hiện cái đã có, không hiện cái rỗng.

- [ ] **Step 5: Verify và commit**

`npx tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e`. Đọc mã thoát thật từng lệnh. **Chạy e2e một mình**, đừng chạy song song lượt e2e nào khác: cả hai lượt cùng ghi `e2e/local.db` và tranh cổng 3101, sinh bài đỏ giả (đã bị ngày 14/8).

```bash
git commit -m "feat(settings): add contact hotline and email shown on vote screen"
```

## Yêu cầu về độ phủ kiểm thử

Admin yêu cầu rõ (13/8): đủ cả ba tầng, và tuyệt đối không làm hỏng logic đang chạy. Cụ thể cho giai đoạn này:

| Tầng        | Ở task nào | Phải phủ được gì                                                                                                                                                   |
| ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit        | 1, 2, 3    | Thuật toán sáu nhóm gồm mọi biên (rổ rỗng, số cố định vượt tổng chi phí, nhóm 0 đầu người, 0 người chơi), schema chặn giá trị vô lý, và **tương đương hành vi cũ** |
| Integration | 4, 7, 10   | Chốt sổ thật với từng cấu hình, nợ khớp ledger (I1), không dòng nợ nào thiếu ledger (I8), chốt lại hai lần không nhân đôi, đổi sàn không làm đổi tiền buổi đã chốt |
| E2E         | 12         | Chuỗi đầy đủ từ database qua giao diện, và ca công tắc tắt phải chứng minh màn vote không đổi                                                                      |

Ba thứ bắt buộc, không được bỏ:

1. `src/lib/cost-calculator.test.ts` xanh **không sửa một dòng**. Đây là bằng chứng số tiền hiện tại không đổi.
2. Mỗi task đụng tiền chạy skill `reconcile-check`, không báo lệch.
3. Trước khi merge mỗi chặng, cho reviewer bất biến tài chính soát và phải nhận PASS.

## Cổng verify trước khi báo xong

```
npx tsc --noEmit
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Đọc mã thoát thật của từng lệnh, đừng kết luận xanh từ chữ trong log. Ngoài ra:

- Chạy skill `reconcile-check` sau mỗi task đụng tiền (task 3, 4, 7, 10).
- Cho reviewer bất biến tài chính soát trước khi merge từng chặng.
- Hai chỗ chập chờn đã biết, gặp thì chạy lại trước khi đào: tiến trình con của vitest chết bất thường ("Worker exited unexpectedly", không có assertion nào sai), và e2e `admin-google.spec.ts:48` fail ở lượt đầu khi máy chủ khởi động nguội.

## Ngoài phạm vi

- Không đụng công thức tiền sân và tiền cầu.
- Không làm phần nhậu thôi trừ quỹ (đó là việc riêng, spec mục 5).
- Không làm panel sửa cấu hình riêng từng buổi (spec mục 9); ba setting tiền đã khai `perSession: true` nên panel đó cắm vào sau được mà không phải sửa lại tầng dưới.
- Không hỗ trợ thêm ngân hàng khác cho luồng tự nhận tiền qua email.
