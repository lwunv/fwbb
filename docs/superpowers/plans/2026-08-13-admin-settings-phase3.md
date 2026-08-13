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

Chi tiết hoá khi tới lượt, dựa trên code thật sau chặng 1. Phạm vi từng task:

**Task 6:** migration bốn cột — `members.gender`, `votes.guest_play_female_count`, `votes.guest_dine_female_count`, `sessions.admin_guest_play_female_count`, `sessions.admin_guest_dine_female_count`, `session_attendees.gender`. Toàn bộ ADD COLUMN thuần, kiểm file `.sql` bằng mắt trước khi commit, tuyệt đối không recreate table.

**Task 7:** gán giới tính khi bung số đếm khách thành từng dòng attendee (`src/actions/finance.ts:541-630`), và zero cột đếm nữ cùng câu lệnh xoá counter ở `src/actions/votes.ts:201` để không còn khách nữ ma sau khi member rút phiếu. Ràng buộc "số khách nữ không vượt tổng khách" thêm vào zod `src/lib/validators.ts`.

**Task 8:** admin khai giới tính member ở trang thành viên. Trang Cài đặt hiện cảnh báo còn bao nhiêu member chưa khai, kèm link sang đó.

**Task 9:** ô "trong đó nữ" ở màn vote, chỉ mọc khi công tắc bật, tối đa bằng tổng khách. Tắt thì màn vote không đổi một chữ.

### Chặng 3: đóng băng cấu hình (task 10-11)

**Task 10:** lần chốt sổ đầu ghi cấu hình đang áp vào `sessions.settings_snapshot`; các lần chốt lại đọc snapshot thay vì setting hiện tại. Kèm test: đổi sàn rồi chốt lại buổi cũ, tiền phải không đổi.

**Task 11:** nút xoá snapshot cho admin chủ động áp cấu hình mới lên buổi cũ, có bước xác nhận vì nó làm đổi tiền lịch sử.

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
