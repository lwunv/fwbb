/**
 * Vitest global setup. Provides safe-default env vars so module-level
 * env-validation guards (USER_COOKIE_SECRET, JWT_SECRET) don't crash the
 * test runner before tests can even define mocks.
 *
 * Real values are still loaded from `.env.local` for `npm run dev`. These
 * fallbacks only kick in when a var is missing during testing.
 */

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
