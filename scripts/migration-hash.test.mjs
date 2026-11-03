import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  migrationHashVariants,
  isMigrationApplied,
  recordHash,
  resolveMigrationTarget,
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

describe("resolveMigrationTarget", () => {
  it("a missing env file is an error naming the path", () => {
    const res = { error: new Error("ENOENT") };
    expect(() => resolveMigrationTarget(res, "nope.env")).toThrow(/nope\.env/);
  });

  it("takes the URL from the file, not from process.env", () => {
    const prev = process.env.TURSO_DATABASE_URL;
    process.env.TURSO_DATABASE_URL = "libsql://prod.example.turso.io";
    try {
      const t = resolveMigrationTarget(
        { parsed: { TURSO_DATABASE_URL: "file:e2e/local.db" } },
        "local.env",
      );
      expect(t.url).toBe("file:e2e/local.db");
      expect(t.label).toBe("file:e2e/local.db");
    } finally {
      if (prev === undefined) delete process.env.TURSO_DATABASE_URL;
      else process.env.TURSO_DATABASE_URL = prev;
    }
  });

  it("does not fall back to process.env when the file lacks a URL", () => {
    process.env.TURSO_DATABASE_URL = "libsql://prod.example.turso.io";
    try {
      expect(() => resolveMigrationTarget({ parsed: {} }, "x.env")).toThrow(
        /missing/,
      );
    } finally {
      delete process.env.TURSO_DATABASE_URL;
    }
  });

  it("printed target has scheme and host but no token", () => {
    const t = resolveMigrationTarget(
      {
        parsed: {
          TURSO_DATABASE_URL: "libsql://db-name.turso.io",
          TURSO_AUTH_TOKEN: "SECRET-TOKEN",
        },
      },
      "p.env",
    );
    expect(t.label).toBe("libsql://db-name.turso.io");
    expect(t.label).not.toContain("SECRET");
    expect(t.authToken).toBe("SECRET-TOKEN");
  });
});
