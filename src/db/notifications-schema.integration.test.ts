import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/test-db";
import { admins, notifications } from "@/db/schema";
import { defaultSettings } from "@/lib/settings-registry";

const { db, client } = await createTestDb();

const row = (dedupKey: string) => ({
  recipientType: "member" as const,
  recipientId: 1,
  kind: "session_open",
  payload: {},
  createdAt: new Date().toISOString(),
  dedupKey,
});

describe("notifications schema", () => {
  it("creates the four notification tables with their indexes", async () => {
    const r = await client.execute(
      "SELECT name FROM sqlite_master WHERE name LIKE 'notification%' OR name LIKE 'scheduled_jobs%'",
    );
    const names = r.rows.map((x) => String(x.name));
    for (const n of [
      "notifications",
      "notification_deliveries",
      "notification_prefs",
      "scheduled_jobs",
      "notifications_dedup_key_unique",
      "notifications_recipient_unread_idx",
      "notifications_recipient_created_idx",
      "notifications_entity_idx",
    ]) {
      expect(names).toContain(n);
    }
    const idx = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('notification_deliveries','notification_prefs','scheduled_jobs')",
    );
    // deliveries 3, prefs 2, jobs 3 (jobKey unique + 2 composite)
    expect(idx.rows.length).toBeGreaterThanOrEqual(8);
  });

  it("adds admins.role and members.notify_email_verified_for", async () => {
    const a = await client.execute("PRAGMA table_info(admins)");
    expect(a.rows.map((c) => c.name)).toContain("role");
    const m = await client.execute("PRAGMA table_info(members)");
    expect(m.rows.map((c) => c.name)).toContain("notify_email_verified_for");
  });

  it("admins.role defaults to superadmin for existing rows", async () => {
    const [a] = await db
      .insert(admins)
      .values({ username: "n1-admin", passwordHash: "x" })
      .returning();
    expect(a.role).toBe("superadmin");
  });

  it("dedup_key is unique", async () => {
    await db.insert(notifications).values(row("k1"));
    // Drizzle wraps the driver error; the UNIQUE text lives on `cause`.
    const err = await db
      .insert(notifications)
      .values(row("k1"))
      .then(
        () => null,
        (e: Error & { cause?: Error }) => e,
      );
    expect(err).not.toBeNull();
    expect(String(err?.cause?.message ?? err?.message)).toMatch(/UNIQUE/i);
  });

  it('settings registry: notificationsEnabled defaults to false, courtLockHoursBefore to 24, zaloGroupUrl to ""', () => {
    const s = defaultSettings();
    expect(s.notificationsEnabled).toBe(false);
    expect(s.courtLockHoursBefore).toBe(24);
    expect(s.zaloGroupUrl).toBe("");
  });
});
