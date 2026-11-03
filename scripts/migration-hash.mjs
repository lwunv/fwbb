/**
 * Pure helpers for deciding whether a migration file was already applied.
 * No DB access and no dotenv, so they are safe to import from tests.
 *
 * Why variants: __drizzle_migrations stores sha256 of the file text. The same
 * file checked out with LF vs CRLF (core.autocrlf) hashes differently, so a
 * plain compare makes the script re-run old migrations, and recreate-table
 * migrations then drop columns added later. We accept either line ending.
 */
import { createHash } from "node:crypto";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const toLf = (text) => text.replace(/\r\n/g, "\n");

/**
 * Distinct sha256 hashes of: the text as read, its LF form and its CRLF form.
 * @param {string} sqlText
 * @returns {string[]}
 */
export function migrationHashVariants(sqlText) {
  const lf = toLf(sqlText);
  const crlf = lf.replace(/\n/g, "\r\n");
  return [...new Set([sha256(sqlText), sha256(lf), sha256(crlf)])];
}

/**
 * True when any line-ending variant of the file is already recorded.
 * @param {string} sqlText
 * @param {Set<string>} appliedHashes
 */
export function isMigrationApplied(sqlText, appliedHashes) {
  return migrationHashVariants(sqlText).some((h) => appliedHashes.has(h));
}

/**
 * Hash to INSERT for a newly applied migration. LF-normalized so the recorded
 * value does not depend on which checkout ran the script (and matches what
 * LF checkouts such as CI and the main repo produce).
 * @param {string} sqlText
 */
export function recordHash(sqlText) {
  return sha256(toLf(sqlText));
}

/**
 * Resolve the DB target from the result of dotenv's config() for the --env
 * file. Reads ONLY the parsed file, never process.env, so variables exported
 * in the shell (possibly prod) can never silently win. Throws on an
 * unreadable file or a missing URL.
 * @param {{ error?: Error, parsed?: Record<string,string> }} dotenvResult
 * @param {string} envPath
 * @returns {{ url: string, authToken: string | undefined, label: string }}
 *   label is safe to print: "file:<path>" or "scheme://host", no token.
 */
export function resolveMigrationTarget(dotenvResult, envPath) {
  if (dotenvResult.error) {
    throw new Error(
      `Cannot read env file ${envPath}: ${dotenvResult.error.message}`,
    );
  }
  const parsed = dotenvResult.parsed ?? {};
  const url = parsed.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(`TURSO_DATABASE_URL missing in ${envPath}`);
  }
  return {
    url,
    authToken: parsed.TURSO_AUTH_TOKEN || undefined,
    label: describeTarget(url),
  };
}

function describeTarget(url) {
  if (url.startsWith("file:")) return url;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "(unparseable url)";
  }
}
