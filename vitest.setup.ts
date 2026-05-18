/**
 * Vitest global setup. Provides safe-default env vars so module-level
 * env-validation guards (USER_COOKIE_SECRET, JWT_SECRET) don't crash the
 * test runner before tests can even define mocks.
 *
 * Real values are still loaded from `.env.local` for `npm run dev`. These
 * fallbacks only kick in when a var is missing during testing.
 *
 * Also globally mocks `next-intl/server`'s `getTranslations` so server
 * actions calling `await getTranslations("serverErrors")` don't throw
 * "getTranslations is not supported in Client Components" — the test
 * runner has no Next.js request context, so any test that exercises a
 * server action would otherwise fail regardless of its own intent.
 * Translation messages just return their key so error assertions can
 * `expect("error" in r).toBe(true)` without caring about the i18n text.
 */

import { vi } from "vitest";

if (
  !process.env.USER_COOKIE_SECRET ||
  process.env.USER_COOKIE_SECRET.length < 16
) {
  process.env.USER_COOKIE_SECRET = "test-user-cookie-secret-at-least-16-chars";
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET =
    "test-jwt-secret-with-more-than-32-characters-of-entropy";
}

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  getLocale: vi.fn(async () => "vi"),
  getFormatter: vi.fn(async () => ({
    number: (v: number) => String(v),
    dateTime: (v: Date) => v.toISOString(),
  })),
}));
