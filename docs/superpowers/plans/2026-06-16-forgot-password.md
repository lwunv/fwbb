# Forgot Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-service password reset for FWBB members: request a reset link by email, click it, set a new password, then log in again.

**Architecture:** A new `password_reset_tokens` table stores a SHA-256 hash of a single-use token (60-min expiry). `requestPasswordReset` always returns a neutral message (anti-enumeration) and sends the email off the request path via `after()`. `resetPasswordWithToken` uses an atomic compare-and-swap UPDATE for single-use, rewrites the bcrypt hash, and clears the session cookie so the user lands on the login gate. Two pages live in a new `(auth)` route group that has no login gate.

**Tech Stack:** Next.js 16.2.1 (App Router), Drizzle/Turso (libSQL), bcryptjs, nodemailer (new), next-intl, Vitest, sonner, react `useTransition`.

**Reference spec:** `docs/superpowers/specs/2026-06-16-forgot-password-design.md` — read it first.

**Key existing helpers (reuse, do not duplicate):**

- `src/actions/password-auth.ts` (PRIVATE in-file): `normalizeEmail`, `isEmail`, `isValidPassword`, `BCRYPT_ROUNDS = 12`. New actions go in THIS file to reuse them.
- `src/lib/rate-limit.ts`: `checkRateLimit(key, limit, windowMs) => { ok, retryAfter?, remaining }`; `_resetRateLimitsForTesting()`.
- `src/lib/client-ip.ts`: `getTrustedClientIp(): Promise<string>` (returns `"unknown"` with no proxy).
- `src/lib/user-identity.ts`: `setUserCookie`, `clearUserCookie`, `getUserFromCookie`.
- `@/db` exports `db`; `@/db/schema` exports tables; `@/db/test-db` exports `createTestDb()`.

**Test conventions (from `src/actions/password-auth.integration.test.ts`):**

- Vitest. Run one file: `pnpm test -- <path>`. Run all: `pnpm test`.
- `getTranslations` is globally mocked in `vitest.setup.ts` to return the key string as-is, so `t("tooManyResetRequests")` returns `"tooManyResetRequests"`.
- Pattern: `vi.hoisted` mocks → `const { db: testDb, client } = await createTestDb()` → `vi.mock("@/db", () => ({ db: testDb }))` → `const { fn } = await import("./password-auth")`.
- bcrypt is NOT mocked (real hashing).

---

## File Structure

| File                                                                         | Responsibility                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/db/schema.ts`                                                           | + `passwordResetTokens` table + relation                                                 |
| `src/db/migrations/00NN_*.sql`                                               | generated migration (committed)                                                          |
| `src/lib/password-reset-token.ts`                                            | **new** — pure token gen/hash/expiry helpers                                             |
| `src/lib/mailer.ts`                                                          | **new** — nodemailer transporter + `sendPasswordResetEmail`                              |
| `src/actions/password-auth.ts`                                               | + `requestPasswordReset`, `validateResetToken`, `resetPasswordWithToken`                 |
| `src/actions/members.ts`                                                     | `mergeMember`: invalidate source member's reset tokens                                   |
| `src/i18n/messages/{vi,en,zh}.json`                                          | + `passwordReset` ns, `serverErrors.tooManyResetRequests`, `passwordAuth.forgotPassword` |
| `src/i18n/locale-parity.test.ts`                                             | **new** — assert key parity across locales                                               |
| `src/app/(auth)/layout.tsx`                                                  | **new** — minimal wrapper (no html/body)                                                 |
| `src/app/(auth)/forgot-password/page.tsx` + `forgot-password-form.tsx`       | **new**                                                                                  |
| `src/app/(auth)/reset-password/[token]/page.tsx` + `reset-password-form.tsx` | **new**                                                                                  |
| `src/app/(public)/password-auth-form.tsx`                                    | + "Quên mật khẩu?" link (login mode)                                                     |
| `next.config.ts`                                                             | + `Referrer-Policy: no-referrer` for `/reset-password/:path*`                            |
| `.env.example`                                                               | + SMTP + `APP_BASE_URL`                                                                  |
| `package.json`                                                               | + `nodemailer`, `@types/nodemailer`                                                      |

---

## Task 1: Add `passwordResetTokens` table + migration

**Files:**

- Modify: `src/db/schema.ts` (after the `members` table, ~line 66)
- Generate: `src/db/migrations/00NN_*.sql`

- [ ] **Step 1: Add the table + relation to schema.ts**

After the `members` table definition, add:

```ts
export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    // sha256(rawToken) hex — never store the raw token.
    tokenHash: text("token_hash").notNull().unique(),
    // ISO-8601 UTC (new Date(...).toISOString()) — lexically comparable.
    expiresAt: text("expires_at").notNull(),
    // null = unused (single-use). Set atomically on consume.
    usedAt: text("used_at"),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
  },
  (t) => [index("prt_member_idx").on(t.memberId)],
);
```

`uniqueIndex`/`index` and `sql` are already imported at the top of schema.ts.

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `src/db/migrations/00NN_<name>.sql` containing `CREATE TABLE \`password_reset_tokens\``plus a`CREATE UNIQUE INDEX`on`token_hash`and the`prt_member_idx`index. Note the exact`00NN` number for the commit.

- [ ] **Step 3: Verify the migration applies in a test DB**

Run: `pnpm test -- src/actions/password-auth.integration.test.ts`
Expected: still PASS (createTestDb replays the new migration without error). If it errors on the new SQL, fix the schema/migration before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts src/db/migrations
git commit -m "feat(auth): password_reset_tokens table + migration"
```

---

## Task 2: Token helpers (`src/lib/password-reset-token.ts`)

Pure, dependency-light helpers so the crypto + expiry logic is unit-tested in isolation.

**Files:**

- Create: `src/lib/password-reset-token.ts`
- Test: `src/lib/password-reset-token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiryIso,
  isResetTokenExpired,
} from "./password-reset-token";

describe("password-reset-token", () => {
  it("generateResetToken returns a url-safe raw token and its sha256 hash", () => {
    const { rawToken, tokenHash } = generateResetToken();
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, path-safe
    expect(rawToken.length).toBeGreaterThanOrEqual(40);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(hashResetToken(rawToken)).toBe(tokenHash); // hash is deterministic
  });

  it("two tokens differ", () => {
    expect(generateResetToken().rawToken).not.toBe(
      generateResetToken().rawToken,
    );
  });

  it("expiry is ISO-UTC ~60 min ahead and lexically comparable", () => {
    const iso = resetTokenExpiryIso();
    expect(iso).toMatch(/Z$/);
    const ms = new Date(iso).getTime() - Date.now();
    expect(ms).toBeGreaterThan(59 * 60_000);
    expect(ms).toBeLessThanOrEqual(60 * 60_000 + 1000);
  });

  it("isResetTokenExpired: past = true, future = false", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isResetTokenExpired(past)).toBe(true);
    expect(isResetTokenExpired(future)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/password-reset-token.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { randomBytes, createHash } from "crypto";

/** Token lifetime: 60 minutes (per design decision). */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** sha256 hex of the raw token. Deterministic — used for storage + lookup. */
export function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** 256-bit url-safe (base64url) raw token + its stored hash. */
export function generateResetToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashResetToken(rawToken) };
}

/** Expiry as ISO-8601 UTC string (lexically comparable to other toISOString()). */
export function resetTokenExpiryIso(): string {
  return new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
}

/** True if the stored ISO expiry is in the past. */
export function isResetTokenExpired(expiresAtIso: string): boolean {
  return new Date(expiresAtIso).getTime() <= Date.now();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/lib/password-reset-token.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/password-reset-token.ts src/lib/password-reset-token.test.ts
git commit -m "feat(auth): password reset token helpers"
```

---

## Task 3: Mailer (`src/lib/mailer.ts`)

**Files:**

- Create: `src/lib/mailer.ts`
- Test: `src/lib/mailer.test.ts`
- Modify: `package.json` (add deps)

- [ ] **Step 1: Add nodemailer dependency**

Run: `pnpm add nodemailer && pnpm add -D @types/nodemailer`
Expected: package.json + pnpm-lock.yaml updated.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMailMock = vi.hoisted(() => vi.fn());
const createTransportMock = vi.hoisted(() =>
  vi.fn(() => ({ sendMail: sendMailMock })),
);
vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
  createTransport: createTransportMock,
}));

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIG };
});

describe("sendPasswordResetEmail", () => {
  it("returns success:false and does NOT send when SMTP is unconfigured", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const { sendPasswordResetEmail } = await import("./mailer");
    const r = await sendPasswordResetEmail("a@b.com", "https://x/reset/tok");
    expect(r.success).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sends with a link and from-address when configured", async () => {
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_SECURE = "true";
    process.env.SMTP_USER = "bot@gmail.com";
    process.env.SMTP_PASS = "app-pass";
    process.env.MAIL_FROM = "FWBB <bot@gmail.com>";
    sendMailMock.mockResolvedValueOnce({ messageId: "abc" });
    vi.resetModules();
    const { sendPasswordResetEmail } = await import("./mailer");
    const r = await sendPasswordResetEmail("a@b.com", "https://x/reset/tok");
    expect(r.success).toBe(true);
    const arg = sendMailMock.mock.calls[0][0];
    expect(arg.to).toBe("a@b.com");
    expect(arg.from).toBe("FWBB <bot@gmail.com>");
    expect(`${arg.html}${arg.text}`).toContain("https://x/reset/tok");
  });

  it("returns success:false (never throws) when sendMail rejects", async () => {
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_USER = "bot@gmail.com";
    process.env.SMTP_PASS = "app-pass";
    sendMailMock.mockRejectedValueOnce(new Error("smtp down"));
    vi.resetModules();
    const { sendPasswordResetEmail } = await import("./mailer");
    const r = await sendPasswordResetEmail("a@b.com", "https://x/reset/tok");
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test -- src/lib/mailer.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

```ts
import nodemailer from "nodemailer";

const HOST = process.env.SMTP_HOST;
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const PORT = Number(process.env.SMTP_PORT ?? 465);
const SECURE = (process.env.SMTP_SECURE ?? "true") === "true";
const FROM = process.env.MAIL_FROM ?? "FWBB <no-reply@fwbb>";

interface MailResult {
  success: boolean;
  error?: string;
}

function buildResetEmail(resetUrl: string): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = "FWBB — Đặt lại mật khẩu / Reset your password";
  const text = [
    "Bạn (hoặc ai đó) đã yêu cầu đặt lại mật khẩu FWBB.",
    `Mở liên kết sau để đặt mật khẩu mới (hết hạn sau 60 phút):`,
    resetUrl,
    "",
    "Nếu không phải bạn yêu cầu, hãy bỏ qua email này.",
    "",
    "— You (or someone) requested an FWBB password reset.",
    `Open this link to set a new password (expires in 60 minutes): ${resetUrl}`,
    "If you didn't request this, ignore this email.",
  ].join("\n");
  const html = `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto;padding:16px;color:#111">
    <h2 style="font-size:18px;margin:0 0 12px">Đặt lại mật khẩu FWBB</h2>
    <p style="font-size:15px;line-height:1.5">Bạn (hoặc ai đó) đã yêu cầu đặt lại mật khẩu. Nhấn nút dưới đây để đặt mật khẩu mới — liên kết hết hạn sau <b>60 phút</b>.</p>
    <p style="margin:20px 0"><a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-size:15px">Đặt lại mật khẩu</a></p>
    <p style="font-size:13px;color:#666;word-break:break-all">Hoặc mở liên kết: ${resetUrl}</p>
    <p style="font-size:13px;color:#666">Nếu không phải bạn yêu cầu, hãy bỏ qua email này. / If you didn't request this, ignore this email.</p>
  </div>`;
  return { subject, text, html };
}

/**
 * Send a password-reset email. Non-blocking pattern (mirrors messenger.ts):
 * logs and returns {success:false} on any failure, never throws.
 * Requires the Node.js runtime (nodemailer uses net/tls) — never import on Edge.
 */
export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
): Promise<MailResult> {
  if (!HOST || !USER || !PASS) {
    console.warn(
      "[Mailer] SMTP not configured (SMTP_HOST/USER/PASS) — skipping send.",
    );
    // Dev affordance: surface the link so QA can complete the flow locally.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[Mailer][dev] password reset URL: ${resetUrl}`);
    }
    return { success: false, error: "SMTP not configured" };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: SECURE,
      auth: { user: USER, pass: PASS },
    });
    const { subject, text, html } = buildResetEmail(resetUrl);
    await transporter.sendMail({ from: FROM, to, subject, text, html });
    return { success: true };
  } catch (err) {
    console.error(
      "[Mailer] send failed:",
      err instanceof Error ? err.message : err,
    );
    return { success: false, error: "send failed" };
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test -- src/lib/mailer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/mailer.ts src/lib/mailer.test.ts package.json pnpm-lock.yaml
git commit -m "feat(auth): nodemailer mailer with sendPasswordResetEmail"
```

---

## Task 4: `requestPasswordReset` action

**Files:**

- Modify: `src/actions/password-auth.ts` (add new exports + imports at top)
- Test: `src/actions/password-reset.integration.test.ts` (new)

Add these imports at the top of `password-auth.ts`:

```ts
import { passwordResetTokens } from "@/db/schema";
import { and, isNull, gt } from "drizzle-orm";
import { clearUserCookie } from "@/lib/user-identity";
import { after } from "next/server";
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiryIso,
  isResetTokenExpired,
} from "@/lib/password-reset-token";
import { sendPasswordResetEmail } from "@/lib/mailer";
```

(`setUserCookie`, `getUserFromCookie` are already imported; `eq` already imported.)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, passwordResetTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashResetToken } from "@/lib/password-reset-token";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => null })),
}));
// after(): run the scheduled callback immediately so the mailer is invoked in-test.
vi.mock("next/server", () => ({ after: (cb: () => unknown) => cb() }));

const mailMock = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/mailer", () => mailMock);

const userMock = vi.hoisted(() => ({
  setUserCookie: vi.fn(async () => {}),
  clearUserCookie: vi.fn(async () => {}),
  getUserFromCookie: vi.fn(async () => null),
}));
vi.mock("@/lib/user-identity", () => userMock);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { requestPasswordReset } = await import("./password-auth");

async function reset() {
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM password_reset_tokens");
  await client.execute("DELETE FROM members");
  vi.clearAllMocks();
  mailMock.sendPasswordResetEmail.mockResolvedValue({ success: true });
}

async function seedMember(over: Partial<typeof members.$inferInsert> = {}) {
  const [m] = await testDb
    .insert(members)
    .values({
      name: "M",
      email: "m@x.com",
      passwordHash: "x",
      approvalStatus: "approved",
      ...over,
    })
    .returning();
  return m;
}

function tokensFor(memberId: number) {
  return testDb.query.passwordResetTokens.findMany({
    where: eq(passwordResetTokens.memberId, memberId),
  });
}

describe("requestPasswordReset", () => {
  beforeEach(reset);

  it("creates a token + sends mail for an active member, returns neutral success", async () => {
    const m = await seedMember();
    const r = await requestPasswordReset({ email: "m@x.com" });
    expect("error" in r).toBe(false);
    const toks = await tokensFor(m.id);
    expect(toks).toHaveLength(1);
    expect(toks[0].usedAt).toBeNull();
    expect(mailMock.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    // link contains a token whose sha256 equals the stored hash
    const url = mailMock.sendPasswordResetEmail.mock.calls[0][1] as string;
    const rawTok = url.split("/reset-password/")[1];
    expect(hashResetToken(rawTok)).toBe(toks[0].tokenHash);
  });

  it("returns the SAME neutral shape for a non-existent email and does NOT send", async () => {
    const r = await requestPasswordReset({ email: "nobody@x.com" });
    expect("error" in r).toBe(false);
    expect(mailMock.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("does not send for rejected or inactive members", async () => {
    await seedMember({ email: "r@x.com", approvalStatus: "rejected" });
    await seedMember({ email: "i@x.com", isActive: false });
    await requestPasswordReset({ email: "r@x.com" });
    await requestPasswordReset({ email: "i@x.com" });
    expect(mailMock.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("allows OAuth-only members (no passwordHash) that have an email", async () => {
    const m = await seedMember({ email: "o@x.com", passwordHash: null });
    await requestPasswordReset({ email: "o@x.com" });
    expect(await tokensFor(m.id)).toHaveLength(1);
    expect(mailMock.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it("invalidates previous unused tokens (only one live token remains)", async () => {
    const m = await seedMember();
    await requestPasswordReset({ email: "m@x.com" });
    await requestPasswordReset({ email: "m@x.com" });
    const toks = await tokensFor(m.id);
    const live = toks.filter((t) => t.usedAt === null);
    expect(live).toHaveLength(1);
  });

  it("normalizes email for the per-email rate-limit (Foo@X == foo@x)", async () => {
    await seedMember({ email: "case@x.com" });
    // 3 per-email requests allowed; 4th (different casing) should be limited
    await requestPasswordReset({ email: "case@x.com" });
    await requestPasswordReset({ email: "CASE@x.com" });
    await requestPasswordReset({ email: "Case@X.com" });
    const r4 = await requestPasswordReset({ email: "cAsE@x.com" });
    expect("error" in r4).toBe(true); // tooManyResetRequests
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/actions/password-reset.integration.test.ts`
Expected: FAIL (`requestPasswordReset` is not exported).

- [ ] **Step 3: Implement `requestPasswordReset` in `password-auth.ts`**

```ts
const RESET_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

/**
 * Step 1 of forgot-password. ALWAYS returns the same neutral success shape
 * (anti-enumeration). Sends the email off the request path via after() so the
 * branch that sends isn't measurably slower than the branch that doesn't.
 */
export async function requestPasswordReset(input: { email: string }) {
  const t = await getTranslations("serverErrors");
  // Normalize BEFORE building any rate-limit key so casing variants share a bucket.
  const email =
    typeof input.email === "string"
      ? normalizeEmail(input.email).slice(0, 200)
      : "";

  const ip = await getTrustedClientIp();
  const ipRl = await checkRateLimit(`pw-reset-req:${ip}`, 5, 10 * 60_000);
  if (!ipRl.ok) {
    return {
      error: t("tooManyResetRequests", { seconds: ipRl.retryAfter ?? 60 }),
    };
  }
  if (isEmail(email)) {
    const emailRl = await checkRateLimit(
      `pw-reset-req-email:${email}`,
      3,
      15 * 60_000,
    );
    if (!emailRl.ok) {
      return {
        error: t("tooManyResetRequests", { seconds: emailRl.retryAfter ?? 60 }),
      };
    }
  }

  // Neutral path: do the work only for a valid, contactable member; always
  // return the same success object regardless.
  if (isEmail(email)) {
    const member = await db.query.members.findFirst({
      where: eq(members.email, email),
    });
    if (
      member &&
      member.email &&
      member.isActive &&
      member.approvalStatus !== "rejected"
    ) {
      try {
        const { rawToken, tokenHash } = generateResetToken();
        const expiresAt = resetTokenExpiryIso();
        await db.transaction(async (tx) => {
          // Invalidate previous unused tokens for this member.
          await tx
            .update(passwordResetTokens)
            .set({ usedAt: new Date().toISOString() })
            .where(
              and(
                eq(passwordResetTokens.memberId, member.id),
                isNull(passwordResetTokens.usedAt),
              ),
            );
          await tx
            .insert(passwordResetTokens)
            .values({ memberId: member.id, tokenHash, expiresAt });
        });
        const resetUrl = `${RESET_BASE_URL}/reset-password/${rawToken}`;
        console.warn(
          `[PasswordReset] requested memberId=${member.id} ip=${ip}`,
        );
        // Send off the request path (kills timing oracle + serverless-safe).
        const send = () => void sendPasswordResetEmail(member.email!, resetUrl);
        try {
          after(send);
        } catch {
          // Outside a request scope (e.g. unit tests) — send directly.
          send();
        }
      } catch (err) {
        // DB error must NOT change the response shape (enumeration defense).
        console.error(
          "[PasswordReset] request failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return { success: true };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/actions/password-reset.integration.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/actions/password-auth.ts src/actions/password-reset.integration.test.ts
git commit -m "feat(auth): requestPasswordReset action (neutral, rate-limited, after-send)"
```

---

## Task 5: `validateResetToken` action

Read-only helper for the reset page to decide form vs "expired" screen. Returns binary status to the caller; rate-limited per IP.

**Files:**

- Modify: `src/actions/password-auth.ts`
- Test: `src/actions/password-reset.integration.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to the same describe file)**

```ts
describe("validateResetToken", () => {
  beforeEach(reset);

  it("returns valid for a fresh token", async () => {
    const m = await seedMember();
    await requestPasswordReset({ email: "m@x.com" });
    const url = mailMock.sendPasswordResetEmail.mock.calls[0][1] as string;
    const rawTok = url.split("/reset-password/")[1];
    const r = await validateResetToken({ token: rawTok });
    expect(r.status).toBe("valid");
  });

  it("returns invalid for a garbage token", async () => {
    const r = await validateResetToken({ token: "not-a-real-token" });
    expect(r.status).toBe("invalid");
  });

  it("returns invalid for an expired token", async () => {
    const m = await seedMember();
    const { rawToken, tokenHash } = generateTok();
    await testDb.insert(passwordResetTokens).values({
      memberId: m.id,
      tokenHash,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const r = await validateResetToken({ token: rawToken });
    expect(r.status).toBe("invalid");
  });

  it("returns invalid for an already-used token", async () => {
    const m = await seedMember();
    const { rawToken, tokenHash } = generateTok();
    await testDb.insert(passwordResetTokens).values({
      memberId: m.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      usedAt: new Date().toISOString(),
    });
    const r = await validateResetToken({ token: rawToken });
    expect(r.status).toBe("invalid");
  });
});
```

Add this import + helper near the top of the test file (after existing imports):

```ts
import { generateResetToken } from "@/lib/password-reset-token";
function generateTok() {
  return generateResetToken();
}
```

And add `validateResetToken` to the destructured import:

```ts
const { requestPasswordReset, validateResetToken, resetPasswordWithToken } =
  await import("./password-auth");
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/actions/password-reset.integration.test.ts`
Expected: FAIL (`validateResetToken` not exported).

- [ ] **Step 3: Implement**

```ts
/**
 * GET-time check for the reset page. Binary status to the unauthenticated
 * caller (used/expired/malformed all collapse to "invalid" — don't leak that a
 * token once existed). Rate-limited per IP.
 */
export async function validateResetToken(input: {
  token: string;
}): Promise<{ status: "valid" | "invalid" }> {
  const ip = await getTrustedClientIp();
  const rl = await checkRateLimit(`pw-reset-validate:${ip}`, 30, 10 * 60_000);
  if (!rl.ok) return { status: "invalid" };

  const token = typeof input.token === "string" ? input.token : "";
  if (!token) return { status: "invalid" };
  const row = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.tokenHash, hashResetToken(token)),
  });
  if (!row || row.usedAt || isResetTokenExpired(row.expiresAt)) {
    return { status: "invalid" };
  }
  return { status: "valid" };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/actions/password-reset.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/password-auth.ts src/actions/password-reset.integration.test.ts
git commit -m "feat(auth): validateResetToken (binary status, rate-limited)"
```

---

## Task 6: `resetPasswordWithToken` action (atomic CAS)

**Files:**

- Modify: `src/actions/password-auth.ts`
- Test: `src/actions/password-reset.integration.test.ts` (append)

- [ ] **Step 1: Write the failing test (append)**

```ts
describe("resetPasswordWithToken", () => {
  beforeEach(reset);

  async function freshToken(memberEmail = "m@x.com") {
    await requestPasswordReset({ email: memberEmail });
    const url = mailMock.sendPasswordResetEmail.mock.calls.at(-1)![1] as string;
    return url.split("/reset-password/")[1];
  }

  it("sets a new password, marks token used, clears the cookie", async () => {
    const m = await seedMember({ passwordHash: "old" });
    const tok = await freshToken();
    const r = await resetPasswordWithToken({
      token: tok,
      newPassword: "brandnewpass1",
    });
    expect(r).toEqual({ success: true });
    const after = await testDb.query.members.findFirst({
      where: eq(members.id, m.id),
    });
    expect(after!.passwordHash).not.toBe("old");
    expect(after!.passwordHash).toBeTruthy();
    const row = await testDb.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.memberId, m.id),
    });
    expect(row!.usedAt).not.toBeNull();
    expect(userMock.clearUserCookie).toHaveBeenCalledTimes(1);
  });

  it("rejects a weak password before touching the token", async () => {
    await seedMember();
    const tok = await freshToken();
    const r = await resetPasswordWithToken({
      token: tok,
      newPassword: "short",
    });
    expect("passwordError" in r || "error" in r).toBe(true);
  });

  it("rejects an expired/used/garbage token with a tokenError", async () => {
    const r = await resetPasswordWithToken({
      token: "garbage",
      newPassword: "brandnewpass1",
    });
    expect("tokenError" in r).toBe(true);
  });

  it("is single-use: second reset with the same token fails (CAS)", async () => {
    await seedMember();
    const tok = await freshToken();
    const r1 = await resetPasswordWithToken({
      token: tok,
      newPassword: "brandnewpass1",
    });
    expect(r1).toEqual({ success: true });
    const r2 = await resetPasswordWithToken({
      token: tok,
      newPassword: "anothernew222",
    });
    expect("tokenError" in r2).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/actions/password-reset.integration.test.ts`
Expected: FAIL (`resetPasswordWithToken` not exported).

- [ ] **Step 3: Implement**

```ts
/**
 * Step 2 of forgot-password. Atomic compare-and-swap on usedAt guarantees
 * single-use even under concurrent submits. Does NOT create a session — it
 * clears the existing cookie so the user re-logs in with the new password.
 */
export async function resetPasswordWithToken(input: {
  token: string;
  newPassword: string;
}): Promise<
  { success: true } | { tokenError: string } | { passwordError: string }
> {
  const t = await getTranslations("serverErrors");
  const ip = await getTrustedClientIp();
  const rl = await checkRateLimit(`pw-reset:${ip}`, 10, 10 * 60_000);
  if (!rl.ok) {
    return {
      tokenError: t("tooManyResetRequests", { seconds: rl.retryAfter ?? 60 }),
    };
  }

  if (!isValidPassword(input.newPassword)) {
    return { passwordError: "Mật khẩu mới phải từ 8 đến 128 ký tự" };
  }
  const token = typeof input.token === "string" ? input.token : "";
  if (!token) return { tokenError: "Liên kết không hợp lệ hoặc đã hết hạn" };

  const tokenHash = hashResetToken(token);
  const nowIso = new Date().toISOString();
  const hash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

  let consumedMemberId: number | null = null;
  await db.transaction(async (tx) => {
    // Atomic CAS: only succeeds if the token is unused AND not expired.
    const res = await tx
      .update(passwordResetTokens)
      .set({ usedAt: nowIso })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, nowIso),
        ),
      );
    if (res.rowsAffected !== 1) return; // already used / expired / not found

    const row = await tx.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.tokenHash, tokenHash),
    });
    if (!row) return;
    await tx
      .update(members)
      .set({ passwordHash: hash })
      .where(eq(members.id, row.memberId));
    // Invalidate any other live tokens for this member.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: nowIso })
      .where(
        and(
          eq(passwordResetTokens.memberId, row.memberId),
          isNull(passwordResetTokens.usedAt),
        ),
      );
    consumedMemberId = row.memberId;
  });

  if (consumedMemberId === null) {
    return { tokenError: "Liên kết không hợp lệ hoặc đã hết hạn" };
  }
  await clearUserCookie();
  console.warn(`[PasswordReset] completed memberId=${consumedMemberId}`);
  revalidatePath("/");
  return { success: true };
}
```

> Note: `res.rowsAffected` is provided by the libSQL driver result. If a future Drizzle version changes this, fall back to a post-CAS `SELECT ... WHERE tokenHash AND usedAt = nowIso`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/actions/password-reset.integration.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add src/actions/password-auth.ts src/actions/password-reset.integration.test.ts
git commit -m "feat(auth): resetPasswordWithToken with atomic single-use CAS"
```

---

## Task 7: `mergeMember` invalidates source reset tokens

The `password_reset_tokens` FK is `onDelete: cascade`. When `mergeMember` deletes the source member, pending tokens vanish silently. Explicitly invalidate them first (don't re-point — a reset link for a merged-away identity should die).

**Files:**

- Modify: `src/actions/members.ts` (inside `mergeMember`, before the source-member delete)
- Test: existing members test file (find it: `src/actions/members*.test.ts`)

- [ ] **Step 1: Read `mergeMember` and its test**

Run: open `src/actions/members.ts`, locate `mergeMember` and the `tx.delete(members)` (source). Open the matching test file.

- [ ] **Step 2: Write the failing test (append to members test)**

```ts
it("mergeMember invalidates the source member's pending reset tokens", async () => {
  const src = await seedMember({ email: "src@x.com" }); // use the file's seed helper
  const dst = await seedMember({ email: "dst@x.com" });
  await testDb.insert(passwordResetTokens).values({
    memberId: src.id,
    tokenHash: "deadbeef".repeat(8),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await mergeMember({ sourceId: src.id, targetId: dst.id }); // match real signature
  const remaining = await testDb.query.passwordResetTokens.findMany();
  // source row is gone (cascade) — and no live token leaked to target
  expect(remaining.filter((r) => r.usedAt === null)).toHaveLength(0);
});
```

(Adjust `seedMember`/`mergeMember` call to the test file's actual helpers + signature.)

- [ ] **Step 3: Run to verify it fails / Implement**

In `mergeMember`, before deleting the source member, add inside the transaction:

```ts
// Pending password-reset tokens for the source identity must die with it —
// don't carry a live reset link across a merge.
await tx
  .update(passwordResetTokens)
  .set({ usedAt: new Date().toISOString() })
  .where(
    and(
      eq(passwordResetTokens.memberId, sourceId),
      isNull(passwordResetTokens.usedAt),
    ),
  );
```

Ensure `passwordResetTokens` and `and, isNull` are imported in members.ts.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- <members test path>`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/members.ts <members test path>
git commit -m "fix(auth): mergeMember invalidates source reset tokens"
```

---

## Task 8: i18n strings + parity test

**Files:**

- Modify: `src/i18n/messages/vi.json`, `en.json`, `zh.json`
- Create: `src/i18n/locale-parity.test.ts`

- [ ] **Step 1: Add the `passwordReset` namespace + keys to all three locales**

Add a root-level `passwordReset` namespace (same keys in all 3), a `forgotPassword` key to the existing `passwordAuth`, and `tooManyResetRequests` to `serverErrors`.

`vi.json`:

```json
"passwordReset": {
  "forgotTitle": "Quên mật khẩu",
  "forgotIntro": "Nhập email của bạn — nếu tồn tại, chúng tôi sẽ gửi liên kết đặt lại mật khẩu.",
  "emailPlaceholder": "Email",
  "btnSend": "Gửi liên kết",
  "neutralSent": "Nếu email tồn tại, chúng tôi đã gửi liên kết đặt lại. Hãy kiểm tra hộp thư.",
  "noEmailHint": "Đăng nhập bằng Facebook/Google chưa có email? Hãy đăng nhập rồi thêm email & đặt mật khẩu trong trang cá nhân.",
  "backToLogin": "Quay lại đăng nhập",
  "resetTitle": "Đặt mật khẩu mới",
  "newPassword": "Mật khẩu mới (≥ 8 ký tự)",
  "confirmPassword": "Nhập lại mật khẩu mới",
  "btnReset": "Đặt lại mật khẩu",
  "errMismatch": "Hai mật khẩu không khớp",
  "successReset": "Đã đổi mật khẩu. Mời đăng nhập lại.",
  "expiredTitle": "Liên kết không hợp lệ hoặc đã hết hạn",
  "expiredBody": "Liên kết đặt lại đã hết hạn hoặc đã được dùng.",
  "btnRequestAgain": "Gửi lại liên kết"
},
```

Add to `passwordAuth`: `"forgotPassword": "Quên mật khẩu?"`
Add to `serverErrors`: `"tooManyResetRequests": "Quá nhiều yêu cầu đặt lại, thử lại sau {seconds}s"`

`en.json` (same keys):

```json
"passwordReset": {
  "forgotTitle": "Forgot password",
  "forgotIntro": "Enter your email — if it exists, we'll send a reset link.",
  "emailPlaceholder": "Email",
  "btnSend": "Send link",
  "neutralSent": "If that email exists, we've sent a reset link. Please check your inbox.",
  "noEmailHint": "Signed in with Facebook/Google and have no email? Sign in, then add an email & set a password in your profile.",
  "backToLogin": "Back to sign in",
  "resetTitle": "Set a new password",
  "newPassword": "New password (≥ 8 chars)",
  "confirmPassword": "Confirm new password",
  "btnReset": "Reset password",
  "errMismatch": "Passwords don't match",
  "successReset": "Password changed. Please sign in again.",
  "expiredTitle": "Invalid or expired link",
  "expiredBody": "This reset link has expired or was already used.",
  "btnRequestAgain": "Send a new link"
},
```

`passwordAuth.forgotPassword`: `"Forgot password?"`
`serverErrors.tooManyResetRequests`: `"Too many reset requests, try again in {seconds}s"`

`zh.json` (same keys):

```json
"passwordReset": {
  "forgotTitle": "忘记密码",
  "forgotIntro": "输入您的邮箱 — 如果存在，我们将发送重置链接。",
  "emailPlaceholder": "邮箱",
  "btnSend": "发送链接",
  "neutralSent": "如果该邮箱存在，我们已发送重置链接，请查看收件箱。",
  "noEmailHint": "用 Facebook/Google 登录且没有邮箱？请先登录，然后在个人资料中添加邮箱并设置密码。",
  "backToLogin": "返回登录",
  "resetTitle": "设置新密码",
  "newPassword": "新密码 (≥8 字符)",
  "confirmPassword": "确认新密码",
  "btnReset": "重置密码",
  "errMismatch": "两次密码不一致",
  "successReset": "密码已修改，请重新登录。",
  "expiredTitle": "链接无效或已过期",
  "expiredBody": "此重置链接已过期或已被使用。",
  "btnRequestAgain": "重新发送链接"
},
```

`passwordAuth.forgotPassword`: `"忘记密码？"`
`serverErrors.tooManyResetRequests`: `"重置请求过于频繁，{seconds} 秒后重试"`

- [ ] **Step 2: Write the parity test**

```ts
import { describe, it, expect } from "vitest";
import vi from "./messages/vi.json";
import en from "./messages/en.json";
import zh from "./messages/zh.json";

function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object"
      ? keyPaths(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe("i18n locale parity", () => {
  const viKeys = new Set(keyPaths(vi));
  const enKeys = new Set(keyPaths(en));
  const zhKeys = new Set(keyPaths(zh));

  it("en has exactly the same keys as vi", () => {
    expect([...viKeys].filter((k) => !enKeys.has(k))).toEqual([]);
    expect([...enKeys].filter((k) => !viKeys.has(k))).toEqual([]);
  });
  it("zh has exactly the same keys as vi", () => {
    expect([...viKeys].filter((k) => !zhKeys.has(k))).toEqual([]);
    expect([...zhKeys].filter((k) => !viKeys.has(k))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify it passes**

Run: `pnpm test -- src/i18n/locale-parity.test.ts`
Expected: PASS (if it fails listing missing keys, fix the offending locale JSON).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/messages src/i18n/locale-parity.test.ts
git commit -m "feat(auth): i18n strings for password reset (vi/en/zh) + parity test"
```

---

## Task 9: `(auth)` layout + forgot-password page

**Files:**

- Create: `src/app/(auth)/layout.tsx`
- Create: `src/app/(auth)/forgot-password/page.tsx`
- Create: `src/app/(auth)/forgot-password/forgot-password-form.tsx`

- [ ] **Step 1: Create the layout (plain wrapper, no html/body)**

```tsx
// src/app/(auth)/layout.tsx
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="from-background to-muted/40 flex min-h-screen flex-col items-center justify-center bg-gradient-to-b p-4">
      <div className="bg-card/80 w-full max-w-sm space-y-4 rounded-2xl border p-6 shadow-sm backdrop-blur">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the server page**

```tsx
// src/app/(auth)/forgot-password/page.tsx
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage() {
  const t = await getTranslations("passwordReset");
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-bold">{t("forgotTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("forgotIntro")}</p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
```

- [ ] **Step 3: Create the client form**

```tsx
// src/app/(auth)/forgot-password/forgot-password-form.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { requestPasswordReset } from "@/actions/password-auth";

export function ForgotPasswordForm() {
  const t = useTranslations("passwordReset");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      await requestPasswordReset({ email });
      setSent(true); // neutral — always show the same confirmation
    });
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <p className="text-sm">{t("neutralSent")}</p>
        <p className="text-muted-foreground text-xs">{t("noEmailHint")}</p>
        <Link
          href="/"
          className="text-primary text-sm underline underline-offset-2"
        >
          {t("backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("emailPlaceholder")}
        maxLength={200}
        disabled={isPending}
        required
      />
      <Button type="submit" disabled={isPending} className="w-full" size="lg">
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("btnSend")}
      </Button>
      <Link
        href="/"
        className="text-muted-foreground block text-center text-sm underline underline-offset-2"
      >
        {t("backToLogin")}
      </Link>
    </form>
  );
}
```

- [ ] **Step 4: Verify it builds + renders**

Run: `pnpm build` (or `pnpm dev` and visit `/forgot-password`).
Expected: route compiles; page renders the email form; submit shows the neutral confirmation (with SMTP unset, the reset URL is logged server-side in dev).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(auth)/layout.tsx" "src/app/(auth)/forgot-password"
git commit -m "feat(auth): (auth) layout + forgot-password page"
```

---

## Task 10: reset-password/[token] page

**Files:**

- Create: `src/app/(auth)/reset-password/[token]/page.tsx`
- Create: `src/app/(auth)/reset-password/[token]/reset-password-form.tsx`

- [ ] **Step 1: Create the server page (validates token, async params)**

```tsx
// src/app/(auth)/reset-password/[token]/page.tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { validateResetToken } from "@/actions/password-auth";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params; // Next 16: params is a Promise
  const t = await getTranslations("passwordReset");
  const { status } = await validateResetToken({ token });

  if (status !== "valid") {
    return (
      <div className="space-y-4 text-center">
        <div className="text-4xl">⏰</div>
        <h1 className="text-lg font-bold">{t("expiredTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("expiredBody")}</p>
        <Link
          href="/forgot-password"
          className="text-primary inline-block text-sm underline underline-offset-2"
        >
          {t("btnRequestAgain")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t("resetTitle")}</h1>
      <ResetPasswordForm token={token} />
    </div>
  );
}
```

- [ ] **Step 2: Create the client form**

```tsx
// src/app/(auth)/reset-password/[token]/reset-password-form.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { resetPasswordWithToken } from "@/actions/password-auth";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("passwordReset");
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw !== confirm) {
      setError(t("errMismatch"));
      return;
    }
    startTransition(async () => {
      const r = await resetPasswordWithToken({ token, newPassword: pw });
      if ("success" in r) {
        toast.success(t("successReset"));
        router.push("/"); // cookie cleared server-side → lands on login gate
        return;
      }
      if ("tokenError" in r) {
        setExpired(true); // token died between render and submit
        return;
      }
      setError(r.passwordError); // password validation error — keep form
    });
  }

  if (expired) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-lg font-bold">{t("expiredTitle")}</h2>
        <Link
          href="/forgot-password"
          className="text-primary text-sm underline underline-offset-2"
        >
          {t("btnRequestAgain")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder={t("newPassword")}
          maxLength={128}
          disabled={isPending}
          required
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="text-muted-foreground absolute inset-y-0 right-2 inline-flex h-full w-7 items-center justify-center"
          tabIndex={-1}
          aria-label={show ? "hide" : "show"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <Input
        type={show ? "text" : "password"}
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={t("confirmPassword")}
        maxLength={128}
        disabled={isPending}
        required
      />
      {error && <p className="text-destructive text-center text-xs">{error}</p>}
      <Button type="submit" disabled={isPending} className="w-full" size="lg">
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("btnReset")}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Verify it builds + manual flow**

Run: `pnpm dev`. Trigger `requestPasswordReset` from `/forgot-password`, copy the reset URL from the dev server log, open it, set a new password, confirm redirect to `/` (login gate) + success toast. Open the same link again → expired screen.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/reset-password"
git commit -m "feat(auth): reset-password/[token] page + form"
```

---

## Task 11: "Quên mật khẩu?" link on the login form

**Files:**

- Modify: `src/app/(public)/password-auth-form.tsx`

- [ ] **Step 1: Add the link (login mode only)**

Add `import Link from "next/link";` at the top. Inside the `<form>`, immediately after the password field block (the `<div className="relative">…</div>` that wraps the password Input), add:

```tsx
{
  mode === "login" && (
    <div className="text-right">
      <Link
        href="/forgot-password"
        className="text-muted-foreground text-sm underline underline-offset-2"
      >
        {t("forgotPassword")}
      </Link>
    </div>
  );
}
```

(`t` here is `useTranslations("passwordAuth")`, already in scope; `forgotPassword` key added in Task 8.)

- [ ] **Step 2: Verify**

Run: `pnpm dev`, open the login gate, confirm the link shows in login mode, hidden in signup mode, and navigates to `/forgot-password`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(public)/password-auth-form.tsx"
git commit -m "feat(auth): forgot-password link on login form"
```

---

## Task 12: `Referrer-Policy: no-referrer` for the reset route

**Files:**

- Modify: `next.config.ts` (inside `headers()`)

- [ ] **Step 1: Add a route-specific header block**

In the array returned by `headers()`, add a second entry after the existing `/:path*` one:

```ts
{
  source: "/reset-password/:path*",
  headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
},
```

This overrides the global `strict-origin-when-cross-origin` for the token route so the raw token isn't leaked via same-origin Referer.

- [ ] **Step 2: Verify**

Run: `pnpm build` (config changes need a restart). After `pnpm dev`, check the response headers for `/reset-password/<x>` include `Referrer-Policy: no-referrer` (browser devtools → Network).

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "feat(auth): no-referrer header on reset-password route"
```

---

## Task 13: `.env.example` + full verification

**Files:**

- Modify: `.env.example`

- [ ] **Step 1: Document the new env vars**

Append to `.env.example`:

```bash
# --- Password reset email (SMTP, e.g. Gmail App Password) ---
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-bot@gmail.com
# Gmail: create at https://myaccount.google.com/apppasswords (needs 2FA)
SMTP_PASS=your-16-char-app-password
MAIL_FROM=FWBB <your-bot@gmail.com>
# Canonical https origin used to build the reset link (NOT derived from Host header)
APP_BASE_URL=https://your-domain
```

- [ ] **Step 2: Full verification suite**

Run each; all must pass:

```bash
pnpm test                 # whole suite green (new + existing)
pnpm typecheck            # (or: pnpm tsc --noEmit) — no type errors
pnpm lint                 # eslint clean
pnpm build                # production build succeeds
```

(If a script name differs, check `package.json` scripts and use the right one.)

- [ ] **Step 3: Migration sanity on a real DB (optional, staging)**

If applying to Turso: after deploying the migration, run a quick check that `sqlite_master` contains `password_reset_tokens` and its `token_hash` unique index (per the Turso index gotcha in the spec).

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs(auth): document SMTP + APP_BASE_URL env for password reset"
```

---

## Self-Review (completed against the spec)

- **Spec coverage:** DB table+migration (T1), hashed/single-use token (T2,T6), mailer+after()+dev-log (T3,T4), neutral+rate-limited request with normalized email (T4), validate binary status (T5), CAS single-use + cookie clear + no auto-login (T6), mergeMember (T7), i18n vi/en/zh + parity + tooManyResetRequests + forgotPassword (T8), (auth) group escaping the login gate (T9,T10), async params + verbatim token hashing (T10), login link (T11), Referrer-Policy (T12), env + cleanup-note + verification (T13). Token-table cleanup: the per-member invalidate in T4 bounds growth per member; a global prune mirroring rate-limit.ts can be added to `requestPasswordReset` if needed (noted, low priority).
- **Placeholder scan:** none — every code step has concrete code; rate-limit numbers and TTL are concrete.
- **Type consistency:** action return shapes used consistently — `requestPasswordReset` → `{success:true}|{error}`; `validateResetToken` → `{status:"valid"|"invalid"}`; `resetPasswordWithToken` → `{success:true}|{tokenError}|{passwordError}` (form in T10 branches on exactly these keys). Token helpers names match between T2 and their callers in T4–T6.
- **Known follow-ups (not blocking):** global expired-token prune; observability beyond console.warn; "evict other devices" is an accepted residual (stateless cookie) per spec §12.
