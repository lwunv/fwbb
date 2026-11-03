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
