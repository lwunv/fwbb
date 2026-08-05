# Page Settings admin, giai đoạn 1 (hạ tầng + các setting không đụng tiền)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng đường dây setting (registry, resolver, hai cột JSON trên `sessions`, page `/admin/settings`) và đưa các hằng số không liên quan tới chia tiền ra thành setting sửa được.

**Architecture:** Một registry khai báo mỗi setting một entry (key, zod schema, default, có override theo buổi không, route revalidate). Giá trị chung nằm ở bảng `app_settings` sẵn có, giá trị riêng của buổi nằm ở cột JSON mới `sessions.settings_override`. Hàm resolve là hàm thuần, đọc DB chỉ xảy ra ở server. Client component nhận setting qua props.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle ORM trên Turso (SQLite), zod v4, next-intl, vitest, Playwright.

## Global Constraints

- Spec gốc: `docs/superpowers/specs/2026-07-27-admin-settings-page-design.md`. Mâu thuẫn thì spec thắng.
- Mọi default trong registry phải cho ra **đúng hành vi hôm nay**. `pnpm test` phải xanh mà không sửa test cũ, trừ những file spec mục 12 đã liệt kê.
- Giai đoạn 1 **không đụng công thức chia tiền**. Không sửa `src/lib/cost-calculator.ts`, không sửa `src/actions/finance.ts`.
- Tiền là số nguyên VND. Không `parseFloat`, không số thực.
- Không dùng `any`. TypeScript strict.
- Không `console.log` trong code chạy thật. Lỗi hiện cho người dùng bằng `toast`.
- Mobile first, vùng chạm tối thiểu 44px (`min-h-11`).
- Mọi thao tác sửa setting phải lạc quan qua `fireAction` từ `src/lib/optimistic-action.ts`, hỏng thì hoàn lại và báo lỗi.
- Không hardcode màu. Dùng biến CSS của theme.
- Chuỗi hiển thị phải thêm đủ cả ba file `src/i18n/messages/{vi,en,zh}.json`, thiếu một file là `locale-parity.test.ts` đỏ.
- Commit theo Conventional Commits, một dòng, không có phần thân, không có dòng ghi công AI.
- **Không chạy `pnpm db:push` hay `pnpm db:seed`.** `.env.local` đang trỏ DB production. Migration chỉ sinh file bằng `pnpm db:generate`, việc áp lên DB do người dùng tự làm.

## Cấu trúc file

| File                                                                | Trách nhiệm                                                                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/lib/settings-registry.ts` (tạo)                                | Khai báo mọi setting: key, zod schema, default, `perSession`, route revalidate. Không đọc DB.                  |
| `src/lib/settings-resolve.ts` (tạo)                                 | Hàm thuần: gộp dòng `app_settings` thô thành object đã parse, và gộp override của buổi lên trên. Không đọc DB. |
| `src/actions/settings.ts` (sửa)                                     | Lớp chạm DB: đọc tất cả setting một lần, ghi một setting bằng upsert nguyên tử, kiểm quyền admin, revalidate.  |
| `src/db/schema.ts` (sửa)                                            | Thêm hai cột JSON `settings_override`, `settings_snapshot` vào bảng `sessions`.                                |
| `src/app/(admin)/admin/settings/page.tsx` (tạo)                     | Server component: đọc setting, đọc danh sách sân và hãng cầu, truyền xuống client.                             |
| `src/app/(admin)/admin/settings/settings-client.tsx` (tạo)          | Client component: khung trang, ghép các section lại.                                                           |
| `src/app/(admin)/admin/settings/section-session-defaults.tsx` (tạo) | Section mặc định cho buổi mới.                                                                                 |
| `src/app/(admin)/admin/settings/section-thresholds.tsx` (tạo)       | Section các ngưỡng.                                                                                            |
| `src/app/(admin)/admin/settings/section-operations.tsx` (tạo)       | Section vận hành.                                                                                              |

Tách mỗi section một file vì trang này sẽ còn phình thêm ở giai đoạn 2 tới 4. Gom hết vào một file sẽ thành file nghìn dòng.

---

### Task 1: Registry khai báo setting

**Files:**

- Create: `src/lib/settings-registry.ts`
- Test: `src/lib/settings-registry.test.ts`

**Interfaces:**

- Consumes: không có, đây là task đầu.
- Produces: `SETTINGS` (object các định nghĩa), type `SettingKey`, type `AppSettings`, hàm `defaultSettings(): AppSettings`, hàm `isPerSession(key: SettingKey): boolean`.

- [ ] **Step 1: Viết test trước**

Tạo `src/lib/settings-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SETTINGS,
  defaultSettings,
  isPerSession,
  type SettingKey,
} from "./settings-registry";

describe("defaultSettings", () => {
  it("khớp hành vi đang chạy hôm nay", () => {
    const d = defaultSettings();
    expect(d.lowFundThreshold).toBe(100_000);
    expect(d.voteBlockDebtThreshold).toBe(100_000);
    expect(d.lowStockThresholdQua).toBe(12);
    expect(d.voteDeadlineOffsetHours).toBe(4);
    expect(d.defaultStartTime).toBe("20:30");
    expect(d.defaultEndTime).toBe("22:30");
    expect(d.defaultCourtQuantity).toBe(1);
    expect(d.defaultMaxPlayers).toBe(16);
    expect(d.maxPlayersOptions).toEqual([8, 12, 16, 20]);
    expect(d.sessionDaysOfWeek).toEqual([1, 3, 5]);
    expect(d.appName).toBe("FWBB");
    expect(d.autoCreateSessions).toBe(true);
  });
});

describe("SETTINGS", () => {
  it("mỗi entry có key trùng với tên thuộc tính", () => {
    for (const [name, def] of Object.entries(SETTINGS)) {
      expect(def.key).toBe(name);
    }
  });

  it("default của mỗi entry tự nó parse được qua schema của nó", () => {
    for (const def of Object.values(SETTINGS)) {
      expect(() => def.schema.parse(def.default)).not.toThrow();
    }
  });

  it("giữ nguyên tên key cũ đã có dữ liệu trong app_settings", () => {
    const keys = Object.keys(SETTINGS);
    expect(keys).toContain("appName");
    expect(keys).toContain("defaultCourtId");
    expect(keys).toContain("defaultBrandId");
    expect(keys).toContain("sessionDaysOfWeek");
  });
});

describe("isPerSession", () => {
  it("ngưỡng dùng chung thì không override theo buổi", () => {
    expect(isPerSession("lowFundThreshold" as SettingKey)).toBe(false);
    expect(isPerSession("appName" as SettingKey)).toBe(false);
  });
});

describe("schema chặn giá trị vô lý", () => {
  it("giờ phải đúng dạng HH:MM", () => {
    expect(() => SETTINGS.defaultStartTime.schema.parse("25:00")).toThrow();
    expect(() => SETTINGS.defaultStartTime.schema.parse("8h30")).toThrow();
  });
  it("ngưỡng tiền không âm và là số nguyên", () => {
    expect(() => SETTINGS.lowFundThreshold.schema.parse(-1)).toThrow();
    expect(() => SETTINGS.lowFundThreshold.schema.parse(1.5)).toThrow();
  });
  it("danh sách mức tối đa phải có ít nhất một mức", () => {
    expect(() => SETTINGS.maxPlayersOptions.schema.parse([])).toThrow();
  });
  it("ngày trong tuần phải nằm trong 0..6 và không rỗng", () => {
    expect(() => SETTINGS.sessionDaysOfWeek.schema.parse([7])).toThrow();
    expect(() => SETTINGS.sessionDaysOfWeek.schema.parse([])).toThrow();
  });
});
```

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npx vitest run src/lib/settings-registry.test.ts`
Expected: FAIL, không tìm thấy module `./settings-registry`.

- [ ] **Step 3: Viết registry**

Tạo `src/lib/settings-registry.ts`:

```ts
import { z } from "zod";

/**
 * Khai báo một setting. Registry là nguồn sự thật duy nhất cho tên key, kiểu
 * dữ liệu và giá trị mặc định. Thêm setting mới = thêm một entry, không cần
 * migration vì bảng `app_settings` là key/value.
 */
export interface SettingDef<T> {
  /** Key trong bảng `app_settings`. Phải trùng tên thuộc tính trong SETTINGS. */
  key: string;
  schema: z.ZodType<T>;
  /** Giá trị khi chưa ai set. BẮT BUỘC khớp hành vi đang chạy. */
  default: T;
  /** Có cho override riêng theo từng buổi không. */
  perSession: boolean;
  /** Route cần revalidate sau khi đổi. */
  revalidate: string[];
}

const moneyVnd = z.number().int().nonnegative();
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ phải có dạng HH:MM");

function def<T>(d: SettingDef<T>): SettingDef<T> {
  return d;
}

export const SETTINGS = {
  // ─── Đã tồn tại trong app_settings, giữ nguyên tên key ───
  appName: def({
    key: "appName",
    schema: z.string().trim().min(1),
    default: "FWBB",
    perSession: false,
    revalidate: ["/", "/admin"],
  }),
  defaultCourtId: def({
    key: "defaultCourtId",
    schema: z.number().int().positive().nullable(),
    default: null as number | null,
    perSession: false,
    revalidate: [
      "/admin/courts",
      "/admin/sessions",
      "/admin/dashboard",
      "/admin/court-rent",
    ],
  }),
  defaultBrandId: def({
    key: "defaultBrandId",
    schema: z.number().int().positive().nullable(),
    default: null as number | null,
    perSession: false,
    revalidate: ["/admin/shuttlecocks", "/admin/sessions", "/admin/dashboard"],
  }),
  sessionDaysOfWeek: def({
    key: "sessionDaysOfWeek",
    schema: z.array(z.number().int().min(0).max(6)).min(1),
    default: [1, 3, 5],
    perSession: false,
    revalidate: ["/admin/dashboard", "/admin/sessions", "/admin/court-rent"],
  }),

  // ─── Mặc định cho buổi mới ───
  defaultStartTime: def({
    key: "defaultStartTime",
    schema: hhmm,
    default: "20:30",
    perSession: false,
    revalidate: ["/admin/sessions", "/admin/dashboard"],
  }),
  defaultEndTime: def({
    key: "defaultEndTime",
    schema: hhmm,
    default: "22:30",
    perSession: false,
    revalidate: ["/admin/sessions", "/admin/dashboard"],
  }),
  defaultCourtQuantity: def({
    key: "defaultCourtQuantity",
    schema: z.number().int().min(1).max(10),
    default: 1,
    perSession: false,
    revalidate: ["/admin/sessions", "/admin/dashboard"],
  }),
  voteDeadlineOffsetHours: def({
    key: "voteDeadlineOffsetHours",
    schema: z.number().int().min(0).max(72),
    default: 4,
    perSession: false,
    revalidate: ["/admin/sessions", "/admin/dashboard", "/"],
  }),
  defaultMaxPlayers: def({
    key: "defaultMaxPlayers",
    schema: z.number().int().min(1).max(100),
    default: 16,
    perSession: false,
    revalidate: ["/admin/sessions", "/admin/dashboard"],
  }),
  maxPlayersOptions: def({
    key: "maxPlayersOptions",
    schema: z.array(z.number().int().min(1).max(100)).min(1),
    default: [8, 12, 16, 20],
    perSession: false,
    revalidate: ["/admin/sessions", "/admin/dashboard"],
  }),

  // ─── Ngưỡng ───
  lowFundThreshold: def({
    key: "lowFundThreshold",
    schema: moneyVnd,
    default: 100_000,
    perSession: false,
    revalidate: ["/admin/fund", "/admin/dashboard", "/"],
  }),
  voteBlockDebtThreshold: def({
    key: "voteBlockDebtThreshold",
    schema: moneyVnd,
    default: 100_000,
    perSession: false,
    revalidate: ["/"],
  }),
  lowStockThresholdQua: def({
    key: "lowStockThresholdQua",
    schema: z.number().int().nonnegative(),
    default: 12,
    perSession: false,
    revalidate: ["/admin/inventory", "/admin/dashboard"],
  }),

  // ─── Vận hành ───
  autoCreateSessions: def({
    key: "autoCreateSessions",
    schema: z.boolean(),
    default: true,
    perSession: false,
    revalidate: ["/admin/dashboard", "/admin/sessions"],
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;

export type AppSettings = {
  [K in SettingKey]: (typeof SETTINGS)[K]["default"];
};

export function defaultSettings(): AppSettings {
  const out = {} as Record<string, unknown>;
  for (const [name, d] of Object.entries(SETTINGS)) {
    out[name] = d.default;
  }
  return out as AppSettings;
}

export function isPerSession(key: SettingKey): boolean {
  return SETTINGS[key].perSession;
}
```

- [ ] **Step 4: Chạy lại test cho xanh**

Run: `npx vitest run src/lib/settings-registry.test.ts`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings-registry.ts src/lib/settings-registry.test.ts
git commit -m "feat(settings): add typed settings registry with defaults"
```

---

### Task 2: Hàm thuần gộp giá trị

**Files:**

- Create: `src/lib/settings-resolve.ts`
- Test: `src/lib/settings-resolve.test.ts`

**Interfaces:**

- Consumes: `SETTINGS`, `AppSettings`, `defaultSettings` từ Task 1.
- Produces: `resolveGlobal(rows: {key: string, value: string}[]): AppSettings`, `resolveForSession(global: AppSettings, overrideJson: string | null): AppSettings`, `serializeSetting(key, value): string`.

- [ ] **Step 1: Viết test trước**

Tạo `src/lib/settings-resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  resolveGlobal,
  resolveForSession,
  serializeSetting,
} from "./settings-resolve";
import { defaultSettings } from "./settings-registry";

describe("resolveGlobal", () => {
  it("bảng rỗng thì trả về đúng bộ default", () => {
    expect(resolveGlobal([])).toEqual(defaultSettings());
  });

  it("đọc được giá trị đã lưu", () => {
    const s = resolveGlobal([
      { key: "lowFundThreshold", value: "150000" },
      { key: "appName", value: "Cầu lông FWBB" },
      { key: "sessionDaysOfWeek", value: "[2,4,6]" },
    ]);
    expect(s.lowFundThreshold).toBe(150_000);
    expect(s.appName).toBe("Cầu lông FWBB");
    expect(s.sessionDaysOfWeek).toEqual([2, 4, 6]);
  });

  it("giá trị hỏng thì rơi về default, không ném lỗi", () => {
    const s = resolveGlobal([
      { key: "lowFundThreshold", value: "không phải số" },
      { key: "defaultStartTime", value: "25:99" },
    ]);
    expect(s.lowFundThreshold).toBe(100_000);
    expect(s.defaultStartTime).toBe("20:30");
  });

  it("bỏ qua key lạ không có trong registry", () => {
    expect(() => resolveGlobal([{ key: "keyLa", value: "1" }])).not.toThrow();
  });

  it("đọc được định dạng cũ của sessionDaysOfWeek dạng 1,3,5", () => {
    const s = resolveGlobal([{ key: "sessionDaysOfWeek", value: "1,3,5" }]);
    expect(s.sessionDaysOfWeek).toEqual([1, 3, 5]);
  });

  it("đọc được định dạng cũ của defaultCourtId dạng số trần", () => {
    const s = resolveGlobal([{ key: "defaultCourtId", value: "7" }]);
    expect(s.defaultCourtId).toBe(7);
  });
});

describe("resolveForSession", () => {
  const global = { ...defaultSettings(), lowFundThreshold: 150_000 };

  it("không có override thì y hệt setting chung", () => {
    expect(resolveForSession(global, null)).toEqual(global);
  });

  it("JSON hỏng thì rơi về setting chung", () => {
    expect(resolveForSession(global, "{{{")).toEqual(global);
  });

  it("JSON không phải object thì rơi về setting chung", () => {
    expect(resolveForSession(global, "42")).toEqual(global);
  });

  it("bỏ qua ô không cho override theo buổi", () => {
    // Giai đoạn 1 mọi setting đều perSession: false, nên override phải bị lờ đi
    // hoàn toàn. Giai đoạn 3 thêm chính sách chia tiền mới có ô đè được.
    const r = resolveForSession(global, JSON.stringify({ appName: "Buổi lẻ" }));
    expect(r.appName).toBe(global.appName);
  });

  it("bỏ qua key lạ không có trong registry", () => {
    expect(resolveForSession(global, JSON.stringify({ keyLa: 1 }))).toEqual(
      global,
    );
  });
});

describe("serializeSetting", () => {
  it("số và chuỗi lưu thành JSON đọc lại được", () => {
    expect(
      resolveGlobal([
        {
          key: "lowFundThreshold",
          value: serializeSetting("lowFundThreshold", 200_000),
        },
      ]).lowFundThreshold,
    ).toBe(200_000);
  });

  it("mảng lưu thành JSON đọc lại được", () => {
    expect(
      resolveGlobal([
        {
          key: "maxPlayersOptions",
          value: serializeSetting("maxPlayersOptions", [8, 16]),
        },
      ]).maxPlayersOptions,
    ).toEqual([8, 16]);
  });
});
```

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npx vitest run src/lib/settings-resolve.test.ts`
Expected: FAIL, không tìm thấy module `./settings-resolve`.

- [ ] **Step 3: Viết resolver**

Tạo `src/lib/settings-resolve.ts`:

```ts
import {
  SETTINGS,
  defaultSettings,
  type AppSettings,
  type SettingKey,
} from "./settings-registry";

/**
 * Value trong `app_settings` là text. Dữ liệu cũ lưu dạng trần (`"7"`,
 * `"1,3,5"`, `"FWBB"`), dữ liệu mới lưu JSON. Hàm này thử JSON trước, không
 * được thì rơi về cách đọc cũ để không phải migrate dữ liệu đang có.
 */
function parseRaw(key: SettingKey, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Định dạng cũ: danh sách phân cách bằng dấu phẩy.
    if (raw.includes(",")) {
      const parts = raw.split(",").map((s) => Number(s.trim()));
      if (parts.every((n) => Number.isFinite(n))) return parts;
    }
    // Định dạng cũ: số trần.
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n)) return n;
    return raw;
  }
}

/** Gộp các dòng `app_settings` thô thành object đã parse. Không bao giờ ném lỗi. */
export function resolveGlobal(
  rows: ReadonlyArray<{ key: string; value: string }>,
): AppSettings {
  const out = defaultSettings() as Record<string, unknown>;
  for (const row of rows) {
    if (!(row.key in SETTINGS)) continue;
    const key = row.key as SettingKey;
    const parsed = SETTINGS[key].schema.safeParse(parseRaw(key, row.value));
    if (parsed.success) out[key] = parsed.data;
    // Hỏng thì giữ default. Không ném lỗi vì một ô hỏng không được làm chết
    // cả trang.
  }
  return out as AppSettings;
}

/** Đè cấu hình riêng của một buổi lên trên setting chung. */
export function resolveForSession(
  global: AppSettings,
  overrideJson: string | null,
): AppSettings {
  if (!overrideJson) return global;
  let raw: unknown;
  try {
    raw = JSON.parse(overrideJson);
  } catch {
    return global;
  }
  if (typeof raw !== "object" || raw === null) return global;

  const out = { ...global } as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in SETTINGS)) continue;
    const key = k as SettingKey;
    if (!SETTINGS[key].perSession) continue;
    const parsed = SETTINGS[key].schema.safeParse(v);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as AppSettings;
}

/** Đóng gói giá trị để ghi vào cột text. Luôn ghi JSON cho dữ liệu mới. */
export function serializeSetting<K extends SettingKey>(
  _key: K,
  value: AppSettings[K],
): string {
  return JSON.stringify(value);
}
```

- [ ] **Step 4: Chạy lại test cho xanh**

Run: `npx vitest run src/lib/settings-resolve.test.ts`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings-resolve.ts src/lib/settings-resolve.test.ts
git commit -m "feat(settings): resolve global and per-session setting layers"
```

---

### Task 3: Hai cột JSON trên bảng sessions

**Files:**

- Modify: `src/db/schema.ts:240-243` (thêm cột vào bảng `sessions`, đặt ngay trước `notes`)
- Create: file migration do `pnpm db:generate` sinh ra trong `src/db/migrations/`

**Interfaces:**

- Consumes: không.
- Produces: `sessions.settingsOverride` và `sessions.settingsSnapshot` kiểu `text | null` cho các task sau.

- [ ] **Step 1: Thêm cột vào schema**

Trong `src/db/schema.ts`, ngay trước dòng `notes: text("notes"),` của bảng `sessions`:

```ts
    /**
     * Cấu hình admin cố ý sửa riêng cho buổi này, dạng JSON. Chỉ chứa key đã
     * sửa, key vắng mặt nghĩa là kế thừa setting chung. Xem
     * `src/lib/settings-resolve.ts`. Cột text để migration là ADD COLUMN
     * thuần, tránh recreate-table làm rớt index trên Turso.
     */
    settingsOverride: text("settings_override"),
    /**
     * Ảnh chụp cấu hình tại lần chốt sổ đầu tiên. Chốt lại sổ đọc cột này thay
     * vì setting hiện tại, để tiền của buổi cũ không đổi theo khi admin chỉnh
     * setting. Khác `settingsOverride` về ý nghĩa: một bên là admin cố ý sửa,
     * một bên là đóng băng lịch sử. Giai đoạn 1 chỉ tạo cột, giai đoạn 3 mới
     * ghi vào.
     */
    settingsSnapshot: text("settings_snapshot"),
```

- [ ] **Step 2: Sinh file migration**

Run: `pnpm db:generate`
Expected: sinh một file `.sql` mới trong `src/db/migrations/` chỉ chứa hai câu `ALTER TABLE sessions ADD COLUMN`.

- [ ] **Step 3: Kiểm file migration bằng mắt**

Mở file `.sql` vừa sinh. Bắt buộc chỉ có hai dòng `ALTER TABLE ... ADD COLUMN`. Nếu thấy `CREATE TABLE __new_sessions` hoặc bất kỳ câu `DROP` nào thì **dừng lại**, đó là recreate-table và sẽ làm rớt index trên Turso.

- [ ] **Step 4: Chạy typecheck và test**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `pnpm test`
Expected: PASS như baseline.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations
git commit -m "feat(settings): add per-session settings override and snapshot columns"
```

---

### Task 4: Lớp chạm DB cho setting

**Files:**

- Modify: `src/actions/settings.ts` (thêm hàm mới, giữ nguyên hàm cũ để không vỡ nơi đang gọi)
- Test: `src/actions/settings-store.integration.test.ts`

**Interfaces:**

- Consumes: `resolveGlobal`, `serializeSetting` từ Task 2; `SETTINGS`, `SettingKey`, `AppSettings` từ Task 1.
- Produces: `getSettings(): Promise<AppSettings>` (server, không cần quyền admin vì trang công khai cũng đọc ngưỡng), `updateSetting<K>(key: K, value: AppSettings[K]): Promise<{success: true} | {error: string}>` (yêu cầu quyền admin).

- [ ] **Step 1: Viết test trước**

Tạo `src/actions/settings-store.integration.test.ts`. Dùng đúng cách dựng DB thử của các file `*.integration.test.ts` sẵn có trong `src/actions/` (mở một file bất kỳ trong đó và chép phần thiết lập đầu file).

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { getSettings, updateSetting } from "./settings";
import { defaultSettings } from "@/lib/settings-registry";

describe("getSettings", () => {
  beforeEach(async () => {
    await db.delete(appSettings);
  });

  it("bảng rỗng trả về default", async () => {
    expect(await getSettings()).toEqual(defaultSettings());
  });

  it("đọc lại đúng giá trị vừa ghi", async () => {
    await updateSetting("lowFundThreshold", 250_000);
    expect((await getSettings()).lowFundThreshold).toBe(250_000);
  });

  it("ghi hai lần cùng một key thì cập nhật chứ không nhân đôi dòng", async () => {
    await updateSetting("lowFundThreshold", 250_000);
    await updateSetting("lowFundThreshold", 300_000);
    const rows = await db.select().from(appSettings);
    expect(rows.filter((r) => r.key === "lowFundThreshold")).toHaveLength(1);
    expect((await getSettings()).lowFundThreshold).toBe(300_000);
  });

  it("từ chối giá trị sai schema và không ghi gì", async () => {
    const r = await updateSetting("lowFundThreshold", -1 as number);
    expect("error" in r).toBe(true);
    expect((await getSettings()).lowFundThreshold).toBe(100_000);
  });
});
```

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npx vitest run src/actions/settings-store.integration.test.ts`
Expected: FAIL, `getSettings` chưa tồn tại.

- [ ] **Step 3: Viết hai hàm mới**

Thêm vào cuối `src/actions/settings.ts`:

```ts
import {
  SETTINGS,
  type AppSettings,
  type SettingKey,
} from "@/lib/settings-registry";
import { resolveGlobal, serializeSetting } from "@/lib/settings-resolve";

/**
 * Đọc toàn bộ setting trong MỘT query. Không kiểm quyền admin vì trang công
 * khai cũng cần vài ngưỡng (ví dụ mức nợ chặn vote). Không trả về gì nhạy cảm.
 */
export async function getSettings(): Promise<AppSettings> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings);
  return resolveGlobal(rows);
}

/**
 * Ghi một setting. Upsert nguyên tử để hai request cùng lúc không đè nhau
 * (kiểu tìm trước rồi mới insert có kẽ hở giữa hai câu lệnh).
 */
export async function updateSetting<K extends SettingKey>(
  key: K,
  value: AppSettings[K],
): Promise<{ success: true } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const def = SETTINGS[key];
  const parsed = def.schema.safeParse(value);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Giá trị không hợp lệ" };
  }

  const serialized = serializeSetting(key, parsed.data as AppSettings[K]);
  await db
    .insert(appSettings)
    .values({ key: def.key, value: serialized })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: serialized },
    });

  for (const path of def.revalidate) revalidatePath(path);
  return { success: true };
}
```

- [ ] **Step 4: Chạy lại test cho xanh**

Run: `npx vitest run src/actions/settings-store.integration.test.ts`
Expected: PASS.

Run: `pnpm test`
Expected: PASS như baseline, các hàm cũ trong file không bị đụng.

- [ ] **Step 5: Commit**

```bash
git add src/actions/settings.ts src/actions/settings-store.integration.test.ts
git commit -m "feat(settings): add atomic settings read and write actions"
```

---

### Task 5: Chạy thử đường dây với ngưỡng nợ chặn vote

Đây là setting dễ nhất, chỉ có một nơi gọi phía server, dùng để kiểm chứng toàn bộ đường dây trước khi đụng những chỗ nhiều nơi gọi.

**Files:**

- Modify: `src/lib/fund-core.ts:141` (giữ hằng số làm default, thêm chú thích)
- Modify: `src/app/(public)/page.tsx:38` (đọc setting thay vì hằng số)

**Interfaces:**

- Consumes: `getSettings` từ Task 4.
- Produces: không có gì cho task sau.

- [ ] **Step 1: Đọc chỗ đang dùng**

Mở `src/app/(public)/page.tsx` quanh dòng 38, xem `VOTE_BLOCK_DEBT_THRESHOLD` đang được so sánh thế nào. Đây là server component nên gọi `getSettings()` trực tiếp được.

- [ ] **Step 2: Đổi sang đọc setting**

Trong `src/app/(public)/page.tsx`, thay chỗ dùng hằng số bằng:

```tsx
const settings = await getSettings();
// ... thay VOTE_BLOCK_DEBT_THRESHOLD bằng settings.voteBlockDebtThreshold
```

Thêm import `import { getSettings } from "@/actions/settings";` và bỏ import hằng số nếu không còn dùng ở file này.

Trong `src/lib/fund-core.ts`, sửa chú thích của hằng số:

```ts
/**
 * Giá trị mặc định của ngưỡng nợ chặn vote. Nguồn sự thật lúc chạy là setting
 * `voteBlockDebtThreshold` trong registry; hằng số này giữ lại làm default và
 * cho các test thuần không đụng DB.
 */
export const VOTE_BLOCK_DEBT_THRESHOLD = 100_000;
```

- [ ] **Step 3: Chạy typecheck và test**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `pnpm test`
Expected: PASS. `fund-core.test.ts` vẫn xanh vì hằng số còn nguyên.

- [ ] **Step 4: Thử tay**

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fund-core.ts "src/app/(public)/page.tsx"
git commit -m "feat(settings): read vote-block debt threshold from settings"
```

---

### Task 6: Khung page /admin/settings

**Files:**

- Create: `src/app/(admin)/admin/settings/page.tsx`
- Create: `src/app/(admin)/admin/settings/settings-client.tsx`
- Modify: `src/components/layout/admin-sidebar.tsx:57`
- Modify: `src/components/layout/admin-mobile-nav.tsx:61`
- Modify: `src/i18n/messages/vi.json:28`, `en.json`, `zh.json` (thêm khoá `settings` vào `adminNav`, thêm namespace `adminSettings`)

**Interfaces:**

- Consumes: `getSettings` từ Task 4.
- Produces: component `SettingsClient` nhận prop `settings: AppSettings`, các task sau cắm section vào đây.

- [ ] **Step 1: Thêm chuỗi hiển thị vào cả ba file ngôn ngữ**

Trong `src/i18n/messages/vi.json`, thêm vào cuối object `adminNav`:

```json
    "settings": "Cài đặt"
```

Và thêm một namespace mới ở cuối file (trước dấu `}` cuối):

```json
  "adminSettings": {
    "title": "Cài đặt",
    "subtitle": "Cấu hình chung cho mọi buổi chơi",
    "sessionDefaults": "Mặc định cho buổi mới",
    "thresholds": "Ngưỡng cảnh báo",
    "operations": "Vận hành"
  }
```

Làm y hệt cho `en.json` (`"settings": "Settings"`, `"title": "Settings"`, ...) và `zh.json` (`"settings": "设置"`, ...).

- [ ] **Step 2: Thêm mục menu ở cả hai file nav**

Trong `src/components/layout/admin-sidebar.tsx`, thêm vào cuối mảng `navItems`, sau mục `account`:

```ts
  { href: "/admin/settings", labelKey: "settings" as const, icon: Settings2 },
```

Thêm `Settings2` vào import từ `lucide-react`. Làm y hệt trong `src/components/layout/admin-mobile-nav.tsx`.

- [ ] **Step 3: Tạo page và client shell**

Tạo `src/app/(admin)/admin/settings/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { getSettings } from "@/actions/settings";
import { SettingsClient } from "./settings-client";

export default async function AdminSettingsPage() {
  const t = await getTranslations("adminSettings");
  const settings = await getSettings();

  return (
    <div className="space-y-4 p-4 pb-24 lg:p-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>
      <SettingsClient settings={settings} />
    </div>
  );
}
```

Tạo `src/app/(admin)/admin/settings/settings-client.tsx`:

```tsx
"use client";

import type { AppSettings } from "@/lib/settings-registry";

/**
 * Khung trang Cài đặt. Các section được cắm vào đây ở những task sau; tách file
 * riêng cho từng section vì trang này còn phình thêm ở các giai đoạn kế tiếp.
 */
export function SettingsClient({ settings }: { settings: AppSettings }) {
  return (
    <div className="space-y-4">
      {/* Task 7 cắm section mặc định buổi mới vào đây. */}
      {/* Task 8 cắm section ngưỡng vào đây. */}
      {/* Task 9 cắm section vận hành vào đây. */}
      <p className="text-muted-foreground text-sm">{settings.appName}</p>
    </div>
  );
}
```

- [ ] **Step 4: Chạy cổng kiểm tra**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `pnpm test`
Expected: PASS, đặc biệt `locale-parity.test.ts` phải xanh (đủ ba ngôn ngữ).

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/settings" src/components/layout src/i18n/messages
git commit -m "feat(settings): add admin settings page shell and nav entry"
```

---

### Task 7: Section mặc định cho buổi mới

**Files:**

- Create: `src/app/(admin)/admin/settings/section-session-defaults.tsx`
- Modify: `src/app/(admin)/admin/settings/page.tsx` (đọc thêm danh sách sân và hãng cầu)
- Modify: `src/app/(admin)/admin/settings/settings-client.tsx` (cắm section)

**Interfaces:**

- Consumes: `AppSettings` từ Task 1, `updateSetting` từ Task 4, `SectionCard` từ `src/components/shared/section-card.tsx`, `CustomSelect` từ `src/components/ui/custom-select.tsx`, `fireAction` từ `src/lib/optimistic-action.ts`.
- Produces: component `SectionSessionDefaults`.

- [ ] **Step 1: Chép mẫu đang chạy**

Mở `src/app/(admin)/admin/dashboard/default-settings-card.tsx` và đọc hết. Section mới dùng đúng khuôn đó: `useState` giữ giá trị, gọi `fireAction` với hàm hoàn tác về giá trị cũ, không có nút Lưu.

- [ ] **Step 2: Viết section**

Tạo `src/app/(admin)/admin/settings/section-session-defaults.tsx`. Chép nguyên phần chọn sân, chọn hãng cầu và các nút ngày trong tuần từ `default-settings-card.tsx`, đổi lời gọi từ `setDefaultCourt` / `setDefaultBrand` / `setSessionDaysOfWeek` sang `updateSetting("defaultCourtId", id)` / `updateSetting("defaultBrandId", id)` / `updateSetting("sessionDaysOfWeek", days)`, rồi thêm bốn ô mới:

```tsx
"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Input } from "@/components/ui/input";
import { fireAction } from "@/lib/optimistic-action";
import { updateSetting } from "@/actions/settings";
import type { AppSettings } from "@/lib/settings-registry";

export function SectionSessionDefaults({
  settings,
}: {
  settings: AppSettings;
}) {
  const [startTime, setStartTime] = useState(settings.defaultStartTime);
  const [endTime, setEndTime] = useState(settings.defaultEndTime);
  const [courtQty, setCourtQty] = useState(settings.defaultCourtQuantity);
  const [deadlineHours, setDeadlineHours] = useState(
    settings.voteDeadlineOffsetHours,
  );
  const [maxPlayers, setMaxPlayers] = useState(settings.defaultMaxPlayers);

  function commitTime(
    key: "defaultStartTime" | "defaultEndTime",
    next: string,
    prev: string,
    set: (v: string) => void,
  ) {
    set(next);
    fireAction(
      () => updateSetting(key, next),
      () => set(prev),
    );
  }

  function commitNumber(
    key:
      | "defaultCourtQuantity"
      | "voteDeadlineOffsetHours"
      | "defaultMaxPlayers",
    next: number,
    prev: number,
    set: (v: number) => void,
  ) {
    if (!Number.isInteger(next) || next < 0) return;
    set(next);
    fireAction(
      () => updateSetting(key, next),
      () => set(prev),
    );
  }

  return (
    <SectionCard tone="primary" icon={Settings2} title="Mặc định cho buổi mới">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            Giờ bắt đầu
          </span>
          <Input
            type="time"
            value={startTime}
            className="min-h-11"
            onChange={(e) =>
              commitTime(
                "defaultStartTime",
                e.target.value,
                startTime,
                setStartTime,
              )
            }
          />
        </label>
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            Giờ kết thúc
          </span>
          <Input
            type="time"
            value={endTime}
            className="min-h-11"
            onChange={(e) =>
              commitTime("defaultEndTime", e.target.value, endTime, setEndTime)
            }
          />
        </label>
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            Số sân
          </span>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={courtQty}
            className="min-h-11"
            onChange={(e) =>
              commitNumber(
                "defaultCourtQuantity",
                Number(e.target.value),
                courtQty,
                setCourtQty,
              )
            }
          />
        </label>
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            Hết hạn vote trước giờ chơi (tiếng)
          </span>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={deadlineHours}
            className="min-h-11"
            onChange={(e) =>
              commitNumber(
                "voteDeadlineOffsetHours",
                Number(e.target.value),
                deadlineHours,
                setDeadlineHours,
              )
            }
          />
        </label>
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            Số người tối đa
          </span>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={maxPlayers}
            className="min-h-11"
            onChange={(e) =>
              commitNumber(
                "defaultMaxPlayers",
                Number(e.target.value),
                maxPlayers,
                setMaxPlayers,
              )
            }
          />
        </label>
      </div>
    </SectionCard>
  );
}
```

Thêm tiếp khối sửa danh sách mức tối đa bấm nhanh, đặt ngay dưới ô số người tối đa:

```tsx
<div className="mt-3">
  <span className="text-muted-foreground mb-1 block text-xs font-medium">
    Các mức tối đa bấm nhanh
  </span>
  <div className="flex flex-wrap items-center gap-1.5">
    {options.map((n) => (
      <button
        key={n}
        type="button"
        onClick={() => removeOption(n)}
        className="border-border bg-muted/30 hover:bg-muted inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm"
      >
        {n}
        <X className="h-3.5 w-3.5" />
      </button>
    ))}
    <Input
      type="number"
      min={1}
      inputMode="numeric"
      value={draft}
      placeholder="Thêm"
      className="min-h-11 w-24"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addOption();
        }
      }}
    />
  </div>
</div>
```

với phần trạng thái:

```tsx
const [options, setOptions] = useState<number[]>(settings.maxPlayersOptions);
const [draft, setDraft] = useState("");

function commitOptions(next: number[]) {
  if (next.length === 0) return; // registry bắt buộc ít nhất một mức
  const prev = options;
  setOptions(next);
  fireAction(
    () => updateSetting("maxPlayersOptions", next),
    () => setOptions(prev),
  );
}

function addOption() {
  const n = Number(draft);
  if (!Number.isInteger(n) || n < 1 || n > 100 || options.includes(n)) return;
  setDraft("");
  commitOptions([...options, n].sort((a, b) => a - b));
}

function removeOption(n: number) {
  commitOptions(options.filter((x) => x !== n));
}
```

Chuỗi hiển thị trong các đoạn trên viết thẳng tiếng Việt cho gọn. Trước khi commit phải chuyển hết sang `useTranslations("adminSettings")` và thêm đúng các khoá này vào cả ba file ngôn ngữ: `startTime`, `endTime`, `courtQuantity`, `deadlineHours`, `maxPlayers`, `maxPlayersOptions`, `addOption`. Cách làm giống hệt `default-settings-card.tsx`.

- [ ] **Step 3: Cắm vào trang**

Trong `page.tsx` thêm truy vấn danh sách sân và hãng cầu (chép cách `admin/dashboard/page.tsx` đang lấy), truyền xuống `SettingsClient`, rồi trong `settings-client.tsx` render `<SectionSessionDefaults settings={settings} />`.

- [ ] **Step 4: Chạy cổng kiểm tra**

Run: `npx tsc --noEmit` rồi `pnpm lint` rồi `pnpm test` rồi `pnpm build`
Expected: cả bốn exit 0.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/settings" src/i18n/messages
git commit -m "feat(settings): add session defaults section"
```

---

### Task 8: Áp mặc định vào chỗ tạo buổi

**Files:**

- Modify: `src/lib/vote-deadline.ts:48-55` (`computeDefaultDeadline` nhận offset qua tham số)
- Modify: `src/actions/sessions.ts:1138` (dùng setting thay vì 20:30 / 22:30 cứng)
- Modify: `src/actions/sessions.ts:1688` (nới validate `maxPlayers` khỏi hai giá trị cứng)
- Modify: `src/components/sessions/max-players-toggle.tsx:29-37` (chọn từ danh sách thay vì bật tắt hai mức)
- Modify: `src/app/api/cron/create-session/route.ts` (truyền setting vào)
- Test: `src/lib/vote-deadline.test.ts`, `src/actions/submit-vote.integration.test.ts`

**Interfaces:**

- Consumes: `getSettings` từ Task 4.
- Produces: `computeDefaultDeadline(date: string, startTime: string, offsetHours?: number): string`. Tham số thứ ba mặc định 4 nên mọi nơi gọi cũ không đổi hành vi.

- [ ] **Step 1: Viết test trước**

Thêm vào `src/lib/vote-deadline.test.ts`:

```ts
it("dùng offset truyền vào thay cho mặc định 4 tiếng", () => {
  expect(computeDefaultDeadline("2026-07-27", "20:30", 2)).toBe(
    "2026-07-27T18:30:00",
  );
});

it("không truyền offset thì vẫn là 4 tiếng như cũ", () => {
  expect(computeDefaultDeadline("2026-07-27", "20:30")).toBe(
    "2026-07-27T16:30:00",
  );
});

it("offset 0 nghĩa là hết hạn đúng giờ chơi", () => {
  expect(computeDefaultDeadline("2026-07-27", "20:30", 0)).toBe(
    "2026-07-27T20:30:00",
  );
});
```

Thêm vào `src/actions/submit-vote.integration.test.ts` một ca cho mức tối đa không phải 8 hay 16 (file này đang ngầm phụ thuộc mặc định 16 và không có ca nào khác):

```ts
it("chặn vote chơi khi buổi đã đủ mức tối đa 12", async () => {
  const s = await createSession({ maxPlayers: 12 });
  // ... cho 12 member vote chơi theo đúng cách các ca khác trong file này làm
  const r = await submitVote(/* member thứ 13 */);
  expect("error" in r).toBe(true);
});
```

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npx vitest run src/lib/vote-deadline.test.ts src/actions/submit-vote.integration.test.ts`
Expected: FAIL ở các ca mới.

- [ ] **Step 3: Thêm tham số và nới ràng buộc**

Trong `src/lib/vote-deadline.ts`:

```ts
/**
 * Default per-session deadline: `startTime − offsetHours`. Mặc định 4 tiếng
 * như trước; caller phía server truyền `voteDeadlineOffsetHours` từ setting.
 *
 * @param date YYYY-MM-DD
 * @param startTime HH:MM (24h)
 * @param offsetHours số tiếng trước giờ chơi, mặc định 4
 */
export function computeDefaultDeadline(
  date: string,
  startTime: string,
  offsetHours: number = 4,
): string {
  const start = new Date(`${date}T${startTime}:00`);
  const deadline = new Date(start.getTime() - offsetHours * 60 * 60 * 1000);
  return formatLocalDeadline(deadline);
}
```

Giữ nguyên `DEFAULT_PLAY_START_TIME` làm default cho các nơi gọi thuần, nhưng sửa chú thích của nó thành "giá trị mặc định, nguồn sự thật lúc chạy là setting `defaultStartTime`".

Trong `src/actions/sessions.ts` chỗ tạo buổi (quanh dòng 1138) và trong route cron, đọc `getSettings()` rồi truyền `settings.voteDeadlineOffsetHours` vào `computeDefaultDeadline`, thay `"20:30"` / `"22:30"` cứng bằng `settings.defaultStartTime` / `settings.defaultEndTime`, số sân bằng `settings.defaultCourtQuantity`, số người tối đa bằng `settings.defaultMaxPlayers`.

Trong `src/actions/sessions.ts:1688`, thay ràng buộc hai giá trị cứng:

```ts
if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 100) {
  return { error: t("invalidData", { detail: "maxPlayers" }) };
}
```

Không ràng buộc theo `maxPlayersOptions`, vì danh sách đó chỉ là các mức bấm nhanh trên giao diện, admin vẫn được nhập số bất kỳ.

Trong `src/components/sessions/max-players-toggle.tsx`, đổi từ bật tắt 8 và 16 sang chọn trong danh sách. Component nhận thêm prop `options: number[]` do server page truyền xuống:

```tsx
export function MaxPlayersToggle({
  sessionId,
  current,
  options,
}: {
  sessionId: number;
  current: number;
  options: number[];
}) {
  const [max, setMax] = useState(current);

  useEffect(() => {
    setMax(current);
  }, [current]);

  function pick(next: number) {
    if (next === max) return;
    const prev = max;
    setMax(next);
    fireAction(
      () => setSessionMaxPlayers(sessionId, next),
      () => setMax(prev),
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((n) => (
        <Button
          key={n}
          type="button"
          variant={n === max ? "default" : "outline"}
          size="sm"
          onClick={() => pick(n)}
          aria-pressed={n === max}
          className="min-h-11 min-w-11"
        >
          {n}
        </Button>
      ))}
    </div>
  );
}
```

Mọi nơi đang render `MaxPlayersToggle` phải truyền `options`. Server page lấy từ `getSettings()` rồi truyền xuống.

- [ ] **Step 4: Chạy cổng kiểm tra**

Run: `npx vitest run src/lib/vote-deadline.test.ts`
Expected: PASS.

Run: `pnpm test`
Expected: PASS. Chú ý `src/app/api/cron/create-session/route.test.ts` có xoá sạch `app_settings`, nên buổi tạo ra phải rơi về đúng default cũ.

Run: `npx tsc --noEmit` rồi `pnpm build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vote-deadline.ts src/lib/vote-deadline.test.ts src/actions/sessions.ts src/app/api/cron
git commit -m "feat(settings): apply session defaults when creating sessions"
```

---

### Task 9: Section ngưỡng và bơm xuống client

**Files:**

- Create: `src/app/(admin)/admin/settings/section-thresholds.tsx`
- Modify: `src/lib/fund-core.ts:150-155` (`getFundStatus` nhận ngưỡng qua tham số)
- Modify: `src/lib/inventory-core.ts:33-35` (`isLowStock` nhận ngưỡng qua tham số)
- Modify: `src/components/fund/fund-adjust-dialog.tsx:12`, `src/app/(admin)/admin/inventory/inventory-client.tsx:84`, `src/components/inventory/stock-card.tsx:41` (nhận qua props)
- Test: `src/lib/fund-core.test.ts`, `src/lib/inventory-core.test.ts` (thêm ca ngưỡng tuỳ biến)

**Interfaces:**

- Consumes: `updateSetting`, `getSettings`.
- Produces: `getFundStatus(balance: number, lowFundThreshold?: number)`, `isLowStock(currentStockQua: number, threshold?: number)`. Tham số thứ hai có mặc định bằng hằng số cũ nên mọi nơi gọi hiện tại không phải sửa ngay.

- [ ] **Step 1: Viết test trước**

Thêm vào `src/lib/fund-core.test.ts`:

```ts
it("dùng ngưỡng truyền vào thay cho mặc định", () => {
  expect(getFundStatus(150_000, 200_000)).toBe<FundStatus>("lowFund");
  expect(getFundStatus(150_000)).toBe<FundStatus>("hasFund");
});
```

Thêm vào `src/lib/inventory-core.test.ts`:

```ts
it("dùng ngưỡng truyền vào thay cho mặc định", () => {
  expect(isLowStock(20, 24)).toBe(true);
  expect(isLowStock(20)).toBe(false);
});
```

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npx vitest run src/lib/fund-core.test.ts src/lib/inventory-core.test.ts`
Expected: FAIL ở hai ca mới.

- [ ] **Step 3: Thêm tham số rồi viết section**

```ts
export function getFundStatus(
  balance: number,
  lowFundThreshold: number = LOW_FUND_THRESHOLD,
): FundStatus {
  if (balance < 0) return "owing";
  if (balance === 0) return "depleted";
  if (balance < lowFundThreshold) return "lowFund";
  return "hasFund";
}
```

```ts
export function isLowStock(
  currentStockQua: number,
  threshold: number = LOW_STOCK_THRESHOLD_QUA,
): boolean {
  return currentStockQua < threshold;
}
```

Tạo `src/app/(admin)/admin/settings/section-thresholds.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Input } from "@/components/ui/input";
import { fireAction } from "@/lib/optimistic-action";
import { updateSetting } from "@/actions/settings";
import type { AppSettings } from "@/lib/settings-registry";

type ThresholdKey =
  | "lowFundThreshold"
  | "voteBlockDebtThreshold"
  | "lowStockThresholdQua";

export function SectionThresholds({ settings }: { settings: AppSettings }) {
  const t = useTranslations("adminSettings");
  const [values, setValues] = useState<Record<ThresholdKey, number>>({
    lowFundThreshold: settings.lowFundThreshold,
    voteBlockDebtThreshold: settings.voteBlockDebtThreshold,
    lowStockThresholdQua: settings.lowStockThresholdQua,
  });

  function commit(key: ThresholdKey, raw: string) {
    const next = Number(raw);
    if (!Number.isInteger(next) || next < 0) return;
    const prev = values[key];
    setValues((v) => ({ ...v, [key]: next }));
    fireAction(
      () => updateSetting(key, next),
      () => setValues((v) => ({ ...v, [key]: prev })),
    );
  }

  const fields: { key: ThresholdKey; label: string; suffix: string }[] = [
    { key: "lowFundThreshold", label: t("lowFund"), suffix: "đ" },
    { key: "voteBlockDebtThreshold", label: t("voteBlockDebt"), suffix: "đ" },
    { key: "lowStockThresholdQua", label: t("lowStock"), suffix: t("quaUnit") },
  ];

  return (
    <SectionCard tone="amber" icon={TriangleAlert} title={t("thresholds")}>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {f.label}
            </span>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={values[f.key]}
                className="min-h-11"
                onChange={(e) => commit(f.key, e.target.value)}
              />
              <span className="text-muted-foreground shrink-0 text-sm">
                {f.suffix}
              </span>
            </div>
          </label>
        ))}
      </div>
    </SectionCard>
  );
}
```

Thêm vào namespace `adminSettings` của cả ba file ngôn ngữ: `lowFund`, `voteBlockDebt`, `lowStock`, `quaUnit`. Bản tiếng Việt lần lượt là "Cảnh báo quỹ thấp dưới", "Chặn vote khi nợ từ", "Cảnh báo cầu còn dưới", "quả".

Cắm `<SectionThresholds settings={settings} />` vào `settings-client.tsx`.

Ba client component đang import hằng số thì đổi sang nhận qua props, và server page tương ứng (`admin/dashboard/page.tsx`, `admin/inventory/page.tsx`, page chứa `fund-adjust-dialog`) gọi `getSettings()` rồi truyền xuống.

- [ ] **Step 4: Chạy cổng kiểm tra**

Run: `pnpm test`
Expected: PASS, cả ca cũ chốt 100.000 và 12 lẫn ca mới.

Run: `npx tsc --noEmit` rồi `pnpm lint` rồi `pnpm build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fund-core.ts src/lib/inventory-core.ts src/lib/fund-core.test.ts src/lib/inventory-core.test.ts src/components src/app
git commit -m "feat(settings): make fund and stock thresholds configurable"
```

---

### Task 10: Section vận hành và dọn card dashboard

**Files:**

- Create: `src/app/(admin)/admin/settings/section-operations.tsx`
- Modify: `src/app/api/cron/create-session/route.ts` (tôn trọng công tắc tự động tạo buổi)
- Delete: `src/app/(admin)/admin/dashboard/default-settings-card.tsx`
- Modify: `src/app/(admin)/admin/dashboard/dashboard-client.tsx` (bỏ chỗ render card đó)

**Interfaces:**

- Consumes: `getSettings`, `updateSetting`.
- Produces: không.

- [ ] **Step 1: Viết test cho công tắc tự động tạo buổi**

Trong `src/app/api/cron/create-session/route.test.ts`, thêm:

```ts
it("không tạo buổi khi admin tắt tự động tạo", async () => {
  await updateSetting("autoCreateSessions", false);
  const res = await GET(buildRequest());
  const sessions = await db.select().from(sessionsTable);
  expect(sessions).toHaveLength(0);
  expect(res.status).toBe(200);
});
```

Sửa lại cho khớp cách file test đó đang dựng request và gọi handler.

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npx vitest run src/app/api/cron/create-session/route.test.ts`
Expected: FAIL, cron vẫn tạo buổi.

- [ ] **Step 3: Thêm chốt chặn và viết section**

Trong route cron, ngay đầu handler sau khi kiểm tra bí mật:

```ts
const settings = await getSettings();
if (!settings.autoCreateSessions) {
  return Response.json({ skipped: "autoCreateSessions is off" });
}
```

Tạo `src/app/(admin)/admin/settings/section-operations.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Cog } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fireAction } from "@/lib/optimistic-action";
import { updateSetting } from "@/actions/settings";
import type { AppSettings } from "@/lib/settings-registry";

export function SectionOperations({ settings }: { settings: AppSettings }) {
  const t = useTranslations("adminSettings");
  const [autoCreate, setAutoCreate] = useState(settings.autoCreateSessions);
  const [appName, setAppName] = useState(settings.appName);

  function toggleAutoCreate(next: boolean) {
    const prev = autoCreate;
    setAutoCreate(next);
    fireAction(
      () => updateSetting("autoCreateSessions", next),
      () => setAutoCreate(prev),
    );
  }

  function commitAppName(next: string) {
    const trimmed = next.trim();
    if (!trimmed) return;
    const prev = appName;
    setAppName(next);
    fireAction(
      () => updateSetting("appName", trimmed),
      () => setAppName(prev),
    );
  }

  return (
    <SectionCard tone="slate" icon={Cog} title={t("operations")}>
      <div className="space-y-3">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{t("autoCreate")}</div>
            <p className="text-muted-foreground text-xs">
              {t("autoCreateHint")}
            </p>
          </div>
          <Switch checked={autoCreate} onCheckedChange={toggleAutoCreate} />
        </div>
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t("appName")}
          </span>
          <Input
            value={appName}
            className="min-h-11"
            onChange={(e) => setAppName(e.target.value)}
            onBlur={(e) => commitAppName(e.target.value)}
          />
        </label>
      </div>
    </SectionCard>
  );
}
```

Ô tên nhóm dùng `onBlur` chứ không `onChange`, vì gọi server sau mỗi ký tự là vô nghĩa. Nếu dự án chưa có `src/components/ui/switch.tsx` thì dùng nút bấm hai trạng thái theo mẫu nút ngày trong tuần ở `default-settings-card.tsx`, đừng thêm thư viện mới.

Thêm khoá `autoCreate`, `autoCreateHint`, `appName` vào namespace `adminSettings` của cả ba file ngôn ngữ.

Về thông tin chuyển khoản mà spec mục 6 có nhắc: mở `src/components/payment/payment-qr.tsx` xem số tài khoản đang lấy từ đâu. Nếu nó đang viết cứng trong code thì thêm hai setting `bankAccountNo` và `bankAccountName` vào registry rồi cho vào section này. Nếu nó đã đọc từ DB thì bỏ qua, ghi một dòng vào phần "Sau giai đoạn 1" của plan này để khỏi ai đi tìm lại.

Xoá `default-settings-card.tsx` và chỗ render nó trong `dashboard-client.tsx`. Ba setting đó đã có mặt ở trang Cài đặt từ Task 7.

- [ ] **Step 4: Chạy cổng kiểm tra**

Run: `pnpm test`
Expected: PASS.

Run: `npx tsc --noEmit` rồi `pnpm lint` rồi `pnpm build`
Expected: exit 0. Nếu `tsc` báo còn nơi import `DefaultSettingsCard` thì xoá nốt.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/settings" "src/app/(admin)/admin/dashboard" src/app/api/cron src/i18n/messages
git commit -m "feat(settings): add operations section and retire dashboard settings card"
```

---

### Task 11: Kiểm thử đầu cuối và chốt giai đoạn

**Files:**

- Create: `e2e/admin-settings.spec.ts`

**Interfaces:**

- Consumes: mọi thứ ở trên.
- Produces: không.

- [ ] **Step 1: Viết kịch bản e2e**

Tạo `e2e/admin-settings.spec.ts`, chép cách đăng nhập admin từ `e2e/admin.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("admin đổi số người tối đa mặc định rồi đọc lại thấy giá trị mới", async ({
  page,
}) => {
  // ... đăng nhập admin theo đúng cách e2e/admin.spec.ts đang làm
  await page.goto("/admin/settings");
  const input = page.getByLabel("Số người tối đa");
  await input.fill("20");
  await input.blur();
  await page.reload();
  await expect(page.getByLabel("Số người tối đa")).toHaveValue("20");
});
```

- [ ] **Step 2: Dựng DB thử rồi chạy**

Run: `pnpm db:clone-local`
Expected: có file `e2e/local.db`. Đọc `scripts/clone-db-local.mjs` trước khi chạy lần đầu để biết nó lấy dữ liệu từ đâu.

Run: `pnpm build` rồi `pnpm test:e2e`
Expected: bài mới PASS. Bốn bài nhóm đăng nhập công khai vẫn đỏ như baseline, đó là lỗi có sẵn.

- [ ] **Step 3: Chạy đủ cổng kiểm tra, ghi lại mã thoát**

```bash
npx tsc --noEmit; echo "tsc=$?"
pnpm lint;       echo "lint=$?"
pnpm test;       echo "test=$?"
pnpm build;      echo "build=$?"
```

Cả bốn phải bằng 0. Không kết luận xanh từ dòng chữ trong log, phải đọc mã thoát.

- [ ] **Step 4: Đối chiếu sổ sách**

Chạy skill `reconcile-check`.
Expected: không báo lệch. Giai đoạn 1 không đụng tiền nên đây là bước xác nhận, nếu lệch thì có gì đó ngoài dự tính.

- [ ] **Step 5: Commit**

```bash
git add e2e/admin-settings.spec.ts
git commit -m "test(settings): add e2e coverage for admin settings page"
```

---

## Sau giai đoạn 1

Ba giai đoạn còn lại lập plan riêng khi tới lượt, vì chúng phụ thuộc chữ ký hàm mà giai đoạn 1 mới tạo ra. Viết plan chi tiết cho chúng bây giờ là viết dựa trên tên hàm chưa tồn tại.

- Giai đoạn 2: luật vote và panel sửa riêng theo buổi.
- Giai đoạn 3: chính sách chia tiền theo nhóm, giới tính, đóng băng cấu hình lúc chốt sổ.
- Giai đoạn 4: nhậu thôi trừ quỹ, ô nhập tiền nhậu, nút chốt lại sổ buổi cũ.

Giai đoạn 3 và 4 đụng tiền thật. Trước khi merge phải chạy reviewer bất biến tài chính và `reconcile-check`, và không gộp hai giai đoạn vào một lần merge.
