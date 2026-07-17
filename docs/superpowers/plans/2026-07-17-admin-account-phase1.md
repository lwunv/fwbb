# Admin Account — Phase 1 Implementation Plan (đổi mật khẩu + hồ sơ)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho admin một trang `/admin/account` để đổi mật khẩu (nối form đã có sẵn) và tự sửa hồ sơ đăng nhập (username, email, SĐT).

**Architecture:** Hybrid tối giản — GIỮ bảng `admins` + JWT `fwbb-admin-token` riêng. Thêm 2 cột `email`/`phone_number` vào `admins`, 1 server action `updateAdminProfile` (gác `requireAdmin`, resolve admin id từ `cookie.sub` để hỗ trợ >1 admin), 1 trang server + form client. KHÔNG cần gửi mail ở phase này.

**Tech Stack:** Next.js 16 App Router (server actions, `useActionState`), Drizzle/Turso SQLite, next-intl (vi/en/zh), bcryptjs, vitest (integration), Playwright (e2e trên `e2e/local.db`).

## Global Constraints

- **Money/finance:** không đụng — phase này thuần auth/profile.
- **Password policy (khớp server hiện tại):** min 8 ký tự, ≤72 byte UTF-8, bcrypt cost 12. Không hạ chuẩn.
- **>1 admin:** mọi action admin resolve id từ `auth.admin.sub` (JWT cookie), KHÔNG `findFirst()` không điều kiện.
- **UNIQUE trên SQLite/Turso:** cột unique mới dùng `uniqueIndex(...)` trong config bảng (KHÔNG `.unique()` inline) → sinh `ADD COLUMN` + `CREATE UNIQUE INDEX` riêng, tránh recreate-table (Turso rớt index). Verify `sqlite_master` sau apply.
- **DB an toàn khi test:** `.env.local` trỏ PROD — KHÔNG chạy `db:push`/`db:seed`. Integration test dùng `createTestDb` (replay migration numbered); e2e dùng `file:e2e/local.db`.
- **i18n:** mọi chuỗi user-facing qua next-intl, đủ 3 ngôn ngữ vi/en/zh (có test parity trong repo).
- **Commit:** Conventional Commits 1 dòng, header ≤100 ký tự (commitlint chặn), không body, không Co-Authored-By.
- **Admin username NOT NULL:** không cho phép xoá username về rỗng.

---

### Task 1: Schema — thêm `email` + `phone_number` vào `admins` + migration

**Files:**

- Modify: `src/db/schema.ts` (khối `admins` dòng 12-25)
- Create: `src/db/migrations/0019_admin_profile_fields.sql` (tên có thể do drizzle sinh khác — đổi lại cho rõ nghĩa)
- Modify: `src/db/migrations/meta/_journal.json` + snapshot (do `db:generate` sinh)

**Interfaces:**

- Produces: `admins.email` (text, nullable, unique qua index `admins_email_unique`), `admins.phoneNumber` (text, nullable). Dùng ở Task 4/5.

- [ ] **Step 1: Sửa schema.ts — thêm 2 cột + uniqueIndex email**

Thay khối `admins` hiện tại bằng (thêm `email`, `phoneNumber`, và đổi sang dạng có config `(table) => [...]` cho unique index):

```ts
export const admins = sqliteTable(
  "admins",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    // Email đăng nhập/khôi phục (Phase 3 forgot-password). Nullable; unique qua
    // index riêng (KHÔNG .unique() inline → tránh recreate-table trên Turso).
    email: text("email"),
    phoneNumber: text("phone_number"),
    // Explicit pointer to the admin's own member record. Replaces the fragile
    // `members.name === admins.username` matching previously used to identify
    // admin's debts. Nullable so admins without a member row don't break.
    // FK ON DELETE SET NULL: if the linked member row is removed, the admin
    // row stays (admin auth lives on username/password, not memberId).
    memberId: integer("member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
  },
  (table) => [uniqueIndex("admins_email_unique").on(table.email)],
);
```

- [ ] **Step 2: Sinh migration**

Run: `pnpm db:generate`
Expected: tạo file `src/db/migrations/00XX_*.sql`. Mở file, kiểm tra nội dung.

- [ ] **Step 3: Đảm bảo migration KHÔNG recreate bảng admins**

Mở file .sql vừa sinh. Nếu drizzle sinh kiểu `CREATE TABLE __new_admins ... INSERT ... DROP ... ALTER RENAME` (recreate), **thay bằng** đúng 3 câu additive (đây là nội dung mong muốn của `0019`):

```sql
ALTER TABLE `admins` ADD `email` text;--> statement-breakpoint
ALTER TABLE `admins` ADD `phone_number` text;--> statement-breakpoint
CREATE UNIQUE INDEX `admins_email_unique` ON `admins` (`email`);
```

Đổi tên file cho rõ nghĩa nếu muốn: `0019_admin_profile_fields.sql` (cập nhật `meta/_journal.json` tương ứng nếu đổi tên).

- [ ] **Step 4: Verify migration replay được (integration harness dùng nó)**

Run: `pnpm test -- src/actions/members.integration.test.ts`
Expected: PASS (chứng tỏ `createTestDb` replay migration mới không lỗi; nếu SQL sai, harness sẽ fail ở bước tạo DB).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat(admin): add email + phone columns to admins table"
```

---

### Task 2: Helper `normalizeUsername` dùng chung (tách format khỏi uniqueness)

**Files:**

- Create: `src/lib/username.ts`
- Create: `src/lib/username.test.ts`
- Modify: `src/actions/members.ts` (`resolveUsername` dòng 126-141 → dùng helper)

**Interfaces:**

- Produces: `normalizeUsername(raw: string): { value: string | null } | { code: "invalid" }` — thuần, không DB. `value=null` nghĩa input rỗng (xoá). Dùng ở Task 4 (`updateAdminProfile`) và `resolveUsername`.

- [ ] **Step 1: Viết test đỏ**

Create `src/lib/username.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeUsername } from "./username";

describe("normalizeUsername", () => {
  it("chuẩn hoá lowercase + trim", () => {
    expect(normalizeUsername("  CunCon ")).toEqual({ value: "cuncon" });
  });
  it("rỗng → value null (xoá)", () => {
    expect(normalizeUsername("   ")).toEqual({ value: null });
  });
  it("ký tự lạ → invalid", () => {
    expect(normalizeUsername("a b!")).toEqual({ code: "invalid" });
  });
  it("quá ngắn (<3) → invalid", () => {
    expect(normalizeUsername("ab")).toEqual({ code: "invalid" });
  });
  it("hợp lệ a-z0-9._ 3-32", () => {
    expect(normalizeUsername("nam.viet_99")).toEqual({ value: "nam.viet_99" });
  });
});
```

- [ ] **Step 2: Chạy test — phải fail**

Run: `pnpm test -- src/lib/username.test.ts`
Expected: FAIL ("Cannot find module './username'").

- [ ] **Step 3: Viết helper**

Create `src/lib/username.ts`:

```ts
/**
 * Chuẩn hoá + validate FORMAT của username (login đa kênh): lowercase, 3-32 ký
 * tự [a-z0-9._]. Rỗng → value=null (xoá). Thuần, KHÔNG check uniqueness (mỗi
 * caller tự tra bảng của mình: members hoặc admins). Dùng chung members +
 * admin để chuẩn format nhất quán.
 */
export function normalizeUsername(
  raw: string,
): { value: string | null } | { code: "invalid" } {
  const norm = raw.trim().toLowerCase();
  if (!norm) return { value: null };
  if (!/^[a-z0-9._]{3,32}$/.test(norm)) return { code: "invalid" };
  return { value: norm };
}
```

- [ ] **Step 4: Chạy test — pass**

Run: `pnpm test -- src/lib/username.test.ts`
Expected: PASS (5 test).

- [ ] **Step 5: Refactor `resolveUsername` trong members.ts dùng helper**

Thêm import đầu file `members.ts`:

```ts
import { normalizeUsername } from "@/lib/username";
```

Thay thân `resolveUsername` (dòng 126-141) bằng:

```ts
async function resolveUsername(
  raw: string,
  excludeId: number | null,
): Promise<{ value: string | null } | { code: "invalid" | "taken" }> {
  const fmt = normalizeUsername(raw);
  if ("code" in fmt) return fmt;
  if (fmt.value === null) return { value: null };
  const dup = await db.query.members.findFirst({
    where: excludeId
      ? and(eq(members.username, fmt.value), ne(members.id, excludeId))
      : eq(members.username, fmt.value),
    columns: { id: true },
  });
  if (dup) return { code: "taken" };
  return { value: fmt.value };
}
```

- [ ] **Step 6: Chạy test member (bảo toàn hành vi) + typecheck**

Run: `pnpm test -- src/actions/members.integration.test.ts && npx tsc --noEmit`
Expected: PASS (27 test member cũ vẫn xanh), tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/username.ts src/lib/username.test.ts src/actions/members.ts
git commit -m "refactor(members): extract normalizeUsername shared helper"
```

---

### Task 3: i18n — namespace `adminAccount` + khoá lỗi email + `adminNav.account`

**Files:**

- Modify: `src/i18n/messages/vi.json`, `src/i18n/messages/en.json`, `src/i18n/messages/zh.json`

**Interfaces:**

- Produces: `adminAccount.*` (title, profileCardTitle, usernameLabel, emailLabel, phoneLabel, emailPlaceholder, phonePlaceholder, save, saving, saved); `serverErrors.emailInvalid`, `serverErrors.emailTaken`; `adminNav.account`. Dùng ở Task 4/5.

- [ ] **Step 1: Thêm khoá vào `adminNav` (cả 3 file)**

Trong mỗi file, thêm vào object `adminNav` khoá `account`:

- vi: `"account": "Tài khoản"`
- en: `"account": "Account"`
- zh: `"account": "账户"`

- [ ] **Step 2: Thêm 2 khoá vào `serverErrors` (cả 3 file), ngay sau `usernameTaken`**

- vi:

```json
"emailInvalid": "Email không hợp lệ.",
"emailTaken": "Email này đã được dùng.",
```

- en:

```json
"emailInvalid": "Invalid email.",
"emailTaken": "That email is already in use.",
```

- zh:

```json
"emailInvalid": "邮箱格式不正确。",
"emailTaken": "该邮箱已被使用。",
```

- [ ] **Step 3: Thêm namespace mới `adminAccount` (cả 3 file), đặt cạnh namespace `adminMembers`**

- vi:

```json
"adminAccount": {
  "title": "Tài khoản",
  "profileCardTitle": "Thông tin đăng nhập",
  "usernameLabel": "Tên đăng nhập",
  "emailLabel": "Email",
  "phoneLabel": "Số điện thoại",
  "emailPlaceholder": "email@example.com",
  "phonePlaceholder": "VD: 0912345678",
  "save": "Lưu",
  "saving": "Đang lưu...",
  "saved": "Đã lưu"
},
```

- en:

```json
"adminAccount": {
  "title": "Account",
  "profileCardTitle": "Login info",
  "usernameLabel": "Username",
  "emailLabel": "Email",
  "phoneLabel": "Phone number",
  "emailPlaceholder": "email@example.com",
  "phonePlaceholder": "e.g. 0912345678",
  "save": "Save",
  "saving": "Saving...",
  "saved": "Saved"
},
```

- zh:

```json
"adminAccount": {
  "title": "账户",
  "profileCardTitle": "登录信息",
  "usernameLabel": "用户名",
  "emailLabel": "邮箱",
  "phoneLabel": "电话号码",
  "emailPlaceholder": "email@example.com",
  "phonePlaceholder": "例如 0912345678",
  "save": "保存",
  "saving": "保存中...",
  "saved": "已保存"
},
```

- [ ] **Step 4: Validate JSON + parity + typecheck**

Run: `node -e "['vi','en','zh'].forEach(l=>require('./src/i18n/messages/'+l+'.json'))" && pnpm test -- src/i18n/locale-parity.test.ts`
Expected: không lỗi JSON; parity test PASS (3 file cùng tập khoá).

- [ ] **Step 5: Commit**

```bash
git add src/i18n/messages/
git commit -m "feat(i18n): adminAccount namespace + admin email error keys"
```

---

### Task 4: Server actions `getCurrentAdmin` + `updateAdminProfile` (+ integration test)

**Files:**

- Modify: `src/actions/auth.ts` (thêm 2 export cuối file + import)
- Create: `src/actions/admin-account.integration.test.ts`

**Interfaces:**

- Consumes: `normalizeUsername` (Task 2); `admins.email/phoneNumber` (Task 1); `serverErrors.emailInvalid/emailTaken/usernameInvalid/usernameTaken` (Task 3).
- Produces:
  - `getCurrentAdmin(): Promise<{ id:number; username:string; email:string|null; phoneNumber:string|null } | null>`
  - `updateAdminProfile(_prev, formData): Promise<{ error?:string; success?:boolean }>` (chỉ đụng field khi `formData.has`).

- [ ] **Step 1: Viết integration test đỏ**

Create `src/actions/admin-account.integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/client-ip", () => ({
  getTrustedClientIp: vi.fn(async () => "test-ip"),
}));
const authMock = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  setAdminCookie: vi.fn(async () => {}),
  clearAdminCookie: vi.fn(async () => {}),
  getAdminFromCookie: vi.fn(),
}));
vi.mock("@/lib/auth", () => authMock);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { updateAdminProfile, getCurrentAdmin } = await import("./auth");

async function reset() {
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM admins");
}
async function seedAdmin(username: string) {
  const [a] = await testDb
    .insert(admins)
    .values({ username, passwordHash: "hash" })
    .returning({ id: admins.id });
  authMock.requireAdmin.mockResolvedValue({
    admin: { sub: String(a.id), role: "admin" },
  });
  return a.id;
}
function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("updateAdminProfile", () => {
  beforeEach(reset);

  it("set email + phone + username", async () => {
    const id = await seedAdmin("root");
    const r = await updateAdminProfile(
      null,
      fd({ username: "Root2", email: "A@Ex.com", phoneNumber: "0912 345 678" }),
    );
    expect(r).toEqual({ success: true });
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.username).toBe("root2");
    expect(a?.email).toBe("a@ex.com");
    expect(a?.phoneNumber).toBe("0912345678");
  });

  it("email sai định dạng → error, không lưu", async () => {
    const id = await seedAdmin("root");
    const r = await updateAdminProfile(null, fd({ email: "not-an-email" }));
    expect(r).toHaveProperty("error");
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.email).toBeNull();
  });

  it("email trùng admin khác → error", async () => {
    await seedAdmin("other");
    await updateAdminProfile(null, fd({ email: "dup@ex.com" })); // other lấy email
    const id = await seedAdmin("me"); // switch cookie sang admin 'me'
    const r = await updateAdminProfile(null, fd({ email: "dup@ex.com" }));
    expect(r).toHaveProperty("error");
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.email).toBeNull();
  });

  it("username trùng admin khác → error", async () => {
    await seedAdmin("taken");
    const id = await seedAdmin("me2");
    const r = await updateAdminProfile(null, fd({ username: "taken" }));
    expect(r).toHaveProperty("error");
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.username).toBe("me2");
  });

  it("username rỗng → error (NOT NULL, không cho xoá)", async () => {
    await seedAdmin("keep");
    const r = await updateAdminProfile(null, fd({ username: "" }));
    expect(r).toHaveProperty("error");
  });

  it("email rỗng → xoá (null)", async () => {
    const id = await seedAdmin("root");
    await updateAdminProfile(null, fd({ email: "x@ex.com" }));
    const r = await updateAdminProfile(null, fd({ email: "" }));
    expect(r).toEqual({ success: true });
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.email).toBeNull();
  });

  it("form không gửi field → giữ nguyên", async () => {
    const id = await seedAdmin("root");
    await updateAdminProfile(
      null,
      fd({ email: "keep@ex.com", phoneNumber: "0911" }),
    );
    await updateAdminProfile(null, fd({ username: "root" })); // chỉ gửi username
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.email).toBe("keep@ex.com");
    expect(a?.phoneNumber).toBe("0911");
  });

  it("getCurrentAdmin trả hồ sơ hiện tại (không passwordHash)", async () => {
    await seedAdmin("root");
    const me = await getCurrentAdmin();
    expect(me?.username).toBe("root");
    expect(me).not.toHaveProperty("passwordHash");
  });
});
```

- [ ] **Step 2: Chạy test — phải fail**

Run: `pnpm test -- src/actions/admin-account.integration.test.ts`
Expected: FAIL (`updateAdminProfile`/`getCurrentAdmin` chưa export).

- [ ] **Step 3: Thêm import + 2 action vào cuối `src/actions/auth.ts`**

Thêm vào khối import đầu file:

```ts
import { members } from "@/db/schema";
import { and, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { normalizeUsername } from "@/lib/username";
```

(`admins`, `eq`, `bcrypt`, `requireAdmin`, `checkRateLimit`, `getTrustedClientIp`, `getTranslations` đã import sẵn. `members` chỉ cần nếu dùng — ở đây KHÔNG cần members; bỏ dòng import members nếu tsc báo unused.)

Thêm cuối file:

```ts
/** Hồ sơ admin hiện tại (theo cookie.sub). Không bao giờ trả passwordHash. */
export async function getCurrentAdmin() {
  const auth = await requireAdmin();
  if ("error" in auth) return null;
  const adminIdNum = parseInt(String(auth.admin.sub ?? ""), 10);
  if (!Number.isFinite(adminIdNum)) return null;
  const admin = await db.query.admins.findFirst({
    where: eq(admins.id, adminIdNum),
    columns: { id: true, username: true, email: true, phoneNumber: true },
  });
  return admin ?? null;
}

/**
 * Admin tự sửa hồ sơ đăng nhập: username / email / phone. Chỉ đụng field khi
 * form CÓ gửi (formData.has). Unique tra trong phạm vi bảng admins (excludeId =
 * chính admin). Bọc write map lỗi UNIQUE (race) về message localized.
 */
export async function updateAdminProfile(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const t = await getTranslations("serverErrors");
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };

  const ip = await getTrustedClientIp();
  const rl = await checkRateLimit(`admin-profile:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return { error: t("tooManyActions", { seconds: rl.retryAfter ?? 60 }) };
  }

  const adminIdNum = parseInt(String(auth.admin.sub ?? ""), 10);
  if (!Number.isFinite(adminIdNum)) return { error: t("invalidAdminSession") };
  const admin = await db.query.admins.findFirst({
    where: eq(admins.id, adminIdNum),
  });
  if (!admin) return { error: t("adminAccountNotFound") };

  const setValues: Partial<typeof admins.$inferInsert> = {};

  if (formData.has("username")) {
    const fmt = normalizeUsername(String(formData.get("username") ?? ""));
    // admins.username NOT NULL → rỗng hoặc sai format đều từ chối.
    if ("code" in fmt || fmt.value === null) {
      return { error: t("usernameInvalid") };
    }
    const dup = await db.query.admins.findFirst({
      where: and(eq(admins.username, fmt.value), ne(admins.id, admin.id)),
      columns: { id: true },
    });
    if (dup) return { error: t("usernameTaken") };
    setValues.username = fmt.value;
  }

  if (formData.has("email")) {
    const raw = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (raw) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        return { error: t("emailInvalid") };
      }
      const dup = await db.query.admins.findFirst({
        where: and(eq(admins.email, raw), ne(admins.id, admin.id)),
        columns: { id: true },
      });
      if (dup) return { error: t("emailTaken") };
      setValues.email = raw;
    } else {
      setValues.email = null;
    }
  }

  if (formData.has("phoneNumber")) {
    const digits = String(formData.get("phoneNumber") ?? "").replace(
      /[^\d]/g,
      "",
    );
    setValues.phoneNumber = digits || null;
  }

  if (Object.keys(setValues).length === 0) return { success: true };

  try {
    await db.update(admins).set(setValues).where(eq(admins.id, admin.id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/username/i.test(msg)) return { error: t("usernameTaken") };
    if (/email/i.test(msg)) return { error: t("emailTaken") };
    throw e;
  }

  revalidatePath("/admin/account");
  return { success: true };
}
```

- [ ] **Step 4: Chạy test — pass + typecheck**

Run: `pnpm test -- src/actions/admin-account.integration.test.ts && npx tsc --noEmit`
Expected: PASS (8 test), tsc exit 0. (Nếu tsc báo `members` unused → xoá dòng import members.)

- [ ] **Step 5: Commit**

```bash
git add src/actions/auth.ts src/actions/admin-account.integration.test.ts
git commit -m "feat(admin): updateAdminProfile + getCurrentAdmin actions"
```

---

### Task 5: Trang `/admin/account` + form hồ sơ + nối form đổi mật khẩu + nav

**Files:**

- Create: `src/app/(admin)/admin/account/page.tsx`
- Create: `src/app/(admin)/admin/account/admin-profile-form.tsx`
- Modify: `src/app/(admin)/admin/dashboard/password-change-form.tsx` (minLength 6→8, 2 chỗ)
- Modify: `src/components/layout/admin-sidebar.tsx` (thêm nav item + icon)
- Modify: `src/components/layout/admin-mobile-nav.tsx` (thêm nav item + icon)

**Interfaces:**

- Consumes: `getCurrentAdmin`, `updateAdminProfile` (Task 4); `PasswordChangeForm` (đã có); `adminAccount.*`, `adminNav.account` (Task 3).

- [ ] **Step 1: Sửa minLength trong password-change-form.tsx (6→8)**

Trong `src/app/(admin)/admin/dashboard/password-change-form.tsx`, đổi cả 2 `minLength={6}` (dòng ~72 ô newPassword và ~96 ô confirmPassword) thành `minLength={8}`.

- [ ] **Step 2: Tạo form hồ sơ client**

Create `src/app/(admin)/admin/account/admin-profile-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updateAdminProfile } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserCog, Check } from "lucide-react";

export function AdminProfileForm({
  username,
  email,
  phoneNumber,
}: {
  username: string;
  email: string;
  phoneNumber: string;
}) {
  const [state, formAction, isPending] = useActionState(
    updateAdminProfile,
    null,
  );
  const t = useTranslations("adminAccount");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCog className="h-5 w-5" />
          {t("profileCardTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-3">
          {state?.error && (
            <div className="text-destructive bg-destructive/10 rounded-md p-2 text-sm">
              {state.error}
            </div>
          )}
          {state?.success && (
            <div className="flex items-center gap-2 py-1 text-sm text-blue-600">
              <Check className="h-4 w-4" />
              {t("saved")}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="username">{t("usernameLabel")}</Label>
            <Input
              id="username"
              name="username"
              defaultValue={username}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">{t("emailLabel")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              defaultValue={email}
              placeholder={t("emailPlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phoneNumber">{t("phoneLabel")}</Label>
            <Input
              id="phoneNumber"
              name="phoneNumber"
              type="tel"
              inputMode="tel"
              defaultValue={phoneNumber}
              placeholder={t("phonePlaceholder")}
            />
          </div>

          <Button
            type="submit"
            disabled={isPending}
            size="lg"
            className="w-full"
          >
            {isPending ? t("saving") : t("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Tạo trang account (server component)**

Create `src/app/(admin)/admin/account/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentAdmin } from "@/actions/auth";
import { PasswordChangeForm } from "../dashboard/password-change-form";
import { AdminProfileForm } from "./admin-profile-form";

export default async function AdminAccountPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  const t = await getTranslations("adminAccount");

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">{t("title")}</h1>
      <AdminProfileForm
        username={admin.username}
        email={admin.email ?? ""}
        phoneNumber={admin.phoneNumber ?? ""}
      />
      <PasswordChangeForm />
    </div>
  );
}
```

- [ ] **Step 4: Thêm nav item vào admin-sidebar.tsx**

Trong `src/components/layout/admin-sidebar.tsx`: thêm `UserCog` vào import `lucide-react`, và thêm item cuối mảng `navItems`:

```ts
  { href: "/admin/account", labelKey: "account" as const, icon: UserCog },
```

- [ ] **Step 5: Thêm nav item vào admin-mobile-nav.tsx**

Y hệt Step 4 nhưng trong `src/components/layout/admin-mobile-nav.tsx` (thêm `UserCog` vào import, thêm cùng item cuối mảng `navItems`).

- [ ] **Step 6: Typecheck + lint + build**

Run: `npx tsc --noEmit && npx eslint "src/app/(admin)/admin/account" "src/components/layout/admin-sidebar.tsx" "src/components/layout/admin-mobile-nav.tsx" && NODE_OPTIONS=--max-old-space-size=8192 pnpm build`
Expected: tsc 0, eslint 0, build thành công (in bảng route có `/admin/account`).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(admin)/admin/account" "src/app/(admin)/admin/dashboard/password-change-form.tsx" src/components/layout/admin-sidebar.tsx src/components/layout/admin-mobile-nav.tsx
git commit -m "feat(admin): account page (profile edit + change password) + nav"
```

---

### Task 6: E2e — sửa hồ sơ admin qua UI + form đổi mật khẩu render/validate

**Files:**

- Create: `e2e/admin-account.spec.ts`

**Interfaces:**

- Consumes: trang `/admin/account` (Task 5). Chạy dưới admin storageState (project chromium mặc định), DB `e2e/local.db` (đã ở schema hiện tại + có cột admins mới sau khi apply migration 0019 vào local.db).

**LƯU Ý trước khi chạy:** `e2e/local.db` phải có cột `admins.email/phone_number`. Nếu chưa, áp migration 0019 vào local.db trước (script apply-migrations như phiên trước, hoặc `pnpm db:clone-local`). KHÔNG đụng prod.

- [ ] **Step 1: Viết spec**

Create `e2e/admin-account.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

// Chỉ sửa PHONE (an toàn — không đổi username/email của admin đang đăng nhập,
// tránh làm hỏng login cho các test khác). DB e2e/local.db.
function db() {
  return createClient({ url: "file:e2e/local.db" });
}

test("admin sửa SĐT ở /admin/account → lưu vào DB (UI → action → DB)", async ({
  page,
}) => {
  const PHONE = "0987000111";
  await page.goto("/admin/account", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Tài khoản" })).toBeVisible();

  const phone = page.locator("#phoneNumber");
  await phone.fill(PHONE);
  await page.getByRole("button", { name: "Lưu" }).click();

  await expect
    .poll(
      async () => {
        const c = db();
        const r = await c.execute("SELECT phone_number FROM admins LIMIT 1");
        c.close();
        return r.rows[0]?.phone_number ?? null;
      },
      { timeout: 10_000, intervals: [300, 500, 800] },
    )
    .toBe(PHONE);
});

test("form đổi mật khẩu: sai mật khẩu hiện tại → báo lỗi, KHÔNG đổi", async ({
  page,
}) => {
  await page.goto("/admin/account", { waitUntil: "domcontentloaded" });
  await page.locator("#currentPassword").fill("definitely-wrong-pass");
  await page.locator("#newPassword").fill("brandnewpass123");
  await page.locator("#confirmPassword").fill("brandnewpass123");
  // Nút submit của card đổi mật khẩu (passwordChange.submit = "Đổi mật khẩu").
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  // Lỗi serverErrors.wrongCurrentPassword = "Mật khẩu hiện tại không đúng"
  // → xác nhận form đã nối đúng action changePassword, KHÔNG đổi mật khẩu thật.
  await expect(page.getByText("Mật khẩu hiện tại không đúng")).toBeVisible({
    timeout: 10_000,
  });
});
```

- [ ] **Step 2: Áp migration 0019 vào e2e/local.db (nếu chưa) rồi chạy e2e**

Run (áp migration + chạy spec):

```bash
node -e "const {createClient}=require('@libsql/client');const c=createClient({url:'file:e2e/local.db'});(async()=>{try{await c.execute('ALTER TABLE admins ADD email text')}catch(e){};try{await c.execute('ALTER TABLE admins ADD phone_number text')}catch(e){};try{await c.execute('CREATE UNIQUE INDEX admins_email_unique ON admins(email)')}catch(e){};console.log('ok');process.exit(0)})()"
npx playwright test e2e/admin-account.spec.ts --reporter=list
```

Expected: 2 test PASS (+ setup admin login).

- [ ] **Step 3: Commit**

```bash
git add e2e/admin-account.spec.ts
git commit -m "test(admin): e2e for admin account page"
```

---

## Sau khi xong Phase 1

- Chạy full verify: `npx tsc --noEmit`, `pnpm test`, `pnpm build`, e2e liên quan.
- Deploy thủ công: `vercel --prod --yes` (Vercel auto-deploy đứt). Trước deploy prod: apply migration 0019 vào **prod Turso** qua migration flow chuẩn + verify `sqlite_master` có `admins.email/phone_number` + index `admins_email_unique`.
- Verify prod: `/admin/account` render, sửa SĐT lưu được.
- Cập nhật `memory/project_admin_account_mgmt_progress.md`: Phase 1 XONG.
- Sang Phase 2 (mail infra + member forgot-password) khi có SMTP creds → viết plan riêng.

```

```
