import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  migrationHashVariants,
  isMigrationApplied,
  recordHash,
} from "./migration-hash.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const LF =
  "ALTER TABLE a ADD COLUMN b text;\n--> statement-breakpoint\nSELECT 1;\n";
const CRLF = LF.replace(/\n/g, "\r\n");

describe("migration hash helpers", () => {
  it("a CRLF copy of an LF-recorded migration counts as applied", () => {
    expect(isMigrationApplied(CRLF, new Set([sha(LF)]))).toBe(true);
  });

  it("an LF copy of a CRLF-recorded migration counts as applied", () => {
    expect(isMigrationApplied(LF, new Set([sha(CRLF)]))).toBe(true);
  });

  it("a file whose SQL changed is not applied", () => {
    const changed = LF.replace("text", "integer");
    expect(isMigrationApplied(changed, new Set([sha(LF), sha(CRLF)]))).toBe(
      false,
    );
  });

  it("recordHash is the LF-normalized hash for both LF and CRLF input", () => {
    expect(recordHash(LF)).toBe(sha(LF));
    expect(recordHash(CRLF)).toBe(sha(LF));
  });

  it("variants are distinct strings and include the raw hash", () => {
    const v = migrationHashVariants(CRLF);
    expect(new Set(v).size).toBe(v.length);
    expect(v).toContain(sha(CRLF));
    expect(v).toContain(sha(LF));
    // Text without any newline yields a single variant.
    expect(migrationHashVariants("SELECT 1;")).toHaveLength(1);
  });
});
