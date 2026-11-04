import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { members, notificationPrefs } from "@/db/schema";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { POST, GET } = await import("./route");
const { ensureUnsubToken } = await import("@/lib/notifications/tokens");

const ORIGIN = "http://localhost:3101";

function post(token?: string) {
  const qs = token === undefined ? "" : `?token=${encodeURIComponent(token)}`;
  return POST(
    new NextRequest(`${ORIGIN}/api/notifications/unsubscribe${qs}`, {
      method: "POST",
      // RFC 8058: mail client gửi body form cố định.
      body: "List-Unsubscribe=One-Click",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }),
  );
}

async function addMember(n: number) {
  const [m] = await testDb
    .insert(members)
    .values({ name: `M${n}`, facebookId: `fb-u${n}` })
    .returning({ id: members.id });
  return m.id;
}

async function emailEnabled(id: number) {
  const [row] = await testDb
    .select({ on: notificationPrefs.emailEnabled })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.recipientId, id));
  return row.on;
}

beforeEach(async () => {
  for (const t of ["notification_prefs", "members"]) {
    await client.execute(`DELETE FROM ${t}`);
  }
});

describe("one-click email unsubscribe", () => {
  it("POST with a valid token turns email off for that recipient only", async () => {
    const a = await addMember(1);
    const b = await addMember(2);
    const tokenA = await ensureUnsubToken(testDb, { type: "member", id: a });
    await ensureUnsubToken(testDb, { type: "member", id: b });
    expect(await emailEnabled(a)).toBe(true);

    const res = await post(tokenA);
    expect(res.status).toBe(200);
    expect(await emailEnabled(a)).toBe(false);
    expect(await emailEnabled(b)).toBe(true);

    // Gọi lại (mail client retry) vẫn 200.
    expect((await post(tokenA)).status).toBe(200);
  });

  it("GET redirects to the confirm page and does not change prefs", async () => {
    const a = await addMember(1);
    const token = await ensureUnsubToken(testDb, { type: "member", id: a });
    const res = GET(
      new NextRequest(
        `${ORIGIN}/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`,
      ),
    );
    // Mail client không hỗ trợ POST một chạm mở link trong trình duyệt: đưa
    // tới trang có nút bấm thay vì trang trắng 405.
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.pathname).toBe("/huy-nhan-thong-bao");
    expect(loc.searchParams.get("token")).toBe(token);
    expect(await emailEnabled(a)).toBe(true);

    // Không có token vẫn về trang (trang tự báo link không hợp lệ).
    const bare = GET(
      new NextRequest(`${ORIGIN}/api/notifications/unsubscribe`),
    );
    expect(bare.status).toBe(303);
    expect(new URL(bare.headers.get("location")!).search).toBe("");

    const { default: Page } = await import("../../../huy-nhan-thong-bao/page");
    await Page({ searchParams: Promise.resolve({ token }) });
    expect(await emailEnabled(a)).toBe(true);
  });

  it("invalid token returns 400", async () => {
    const a = await addMember(1);
    await ensureUnsubToken(testDb, { type: "member", id: a });
    expect((await post()).status).toBe(400);
    expect((await post("")).status).toBe(400);
    expect((await post("not a token!")).status).toBe(400);
    // Đúng dạng nhưng không có trong DB.
    expect((await post("A".repeat(43))).status).toBe(400);
    expect(await emailEnabled(a)).toBe(true);
  });
});
