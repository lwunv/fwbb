import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

/**
 * E2E cho bình luận buổi giao lưu (G2c) ở 390px.
 *
 * Seed thẳng vào e2e/local.db (server `next start` dùng cùng file). Mỗi bài
 * dùng một buổi riêng để cache bình luận công khai (60 giây, theo buổi) không
 * lẫn giữa các bài. Cờ `exchangeEnabled` và `notificationsEnabled` được khôi
 * phục đúng giá trị cũ ở afterAll.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", timeout: 120_000 });

const PASSWORD = "ExchangeE2e#1";
const PREFIX = "E2E XC ";
const USERS = {
  host: { username: "e2excm1", name: "E2E XC Host", status: "approved" },
  ex: { username: "e2excm2", name: "E2E XC Khach", status: "pending" },
  mem: { username: "e2excm3", name: "E2E XC Thanh Vien", status: "approved" },
  r1: { username: "e2excm4", name: "E2E XC Bao Cao Mot", status: "approved" },
  r2: { username: "e2excm5", name: "E2E XC Bao Cao Hai", status: "approved" },
  r3: { username: "e2excm6", name: "E2E XC Bao Cao Ba", status: "approved" },
} as const;
type UserKey = keyof typeof USERS;
const ids = { host: 0, ex: 0, mem: 0, r1: 0, r2: 0, r3: 0 } as Record<
  UserKey,
  number
>;

const VENUE = `${PREFIX}San`;
let venueId = 0;

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

let previousFlag: string | null = null;
let previousNotify: string | null = null;
/** Ngữ cảnh của tài khoản giao lưu, giữ qua các bài để cookie Turnstile còn. */
let exCtx: BrowserContext | null = null;

async function withDb<T>(
  fn: (db: ReturnType<typeof createClient>) => Promise<T>,
): Promise<T> {
  const db = createClient({ url: "file:e2e/local.db" });
  // Fixture và server Next cùng mở file này: chờ lock nhả thay vì SQLITE_BUSY.
  await db.execute("PRAGMA busy_timeout = 5000");
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

async function readSetting(key: string): Promise<string | null> {
  return withDb(async (db) => {
    const r = await db.execute({
      sql: "SELECT value FROM app_settings WHERE key = ?",
      args: [key],
    });
    return r.rows[0] ? String(r.rows[0].value) : null;
  });
}

async function writeSetting(key: string, value: string | null) {
  await withDb(async (db) => {
    if (value === null) {
      await db.execute({
        sql: "DELETE FROM app_settings WHERE key = ?",
        args: [key],
      });
    } else {
      await db.execute({
        sql: `INSERT INTO app_settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [key, value],
      });
    }
  });
}

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function randomCode(): string {
  let out = "";
  for (let i = 0; i < 10; i++)
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

/** Buổi seed thẳng; `startOffsetH` âm là buổi đã qua (dùng cho bài "của tôi"). */
async function seedEvent(
  title: string,
  startOffsetH = 72,
): Promise<{ id: number; code: string }> {
  const code = randomCode();
  const now = iso(Date.now());
  const start = Date.now() + startOffsetH * HOUR;
  return withDb(async (db) => {
    const r = await db.execute({
      sql: `INSERT INTO exchange_events
        (public_code, host_member_id, venue_id, title, start_at, end_at,
         slots_total, host_heads, fee_mode, fee_amount_male, deposit_amount,
         register_deadline, cancel_deadline, auto_approve, allow_plus_ones,
         status, lock_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 8, 1, 'fixed', 50000, 0, ?, ?, 0, 0,
                'open', 0, ?, ?)
        RETURNING id`,
      args: [
        code,
        ids.host,
        venueId,
        title,
        iso(start),
        iso(start + 2 * HOUR),
        iso(start - 2 * HOUR),
        iso(start - 12 * HOUR),
        now,
        now,
      ],
    });
    return { id: Number(r.rows[0].id), code };
  });
}

async function seedApproved(eventId: number, user: UserKey) {
  const now = iso(Date.now());
  await withDb((db) =>
    db.execute({
      sql: `INSERT INTO exchange_registrations
        (event_id, member_id, status, male_count, female_count, created_at,
         updated_at)
        VALUES (?, ?, 'approved', 1, 0, ?, ?)`,
      args: [eventId, ids[user], now, now],
    }),
  );
}

async function seedComment(c: {
  eventId: number;
  author: UserKey;
  body: string;
  channel?: "qa" | "group";
  parentId?: number;
  replyTo?: UserKey;
  status?: "visible" | "held" | "hidden" | "deleted";
  createdAt?: string;
}): Promise<number> {
  return withDb(async (db) => {
    const r = await db.execute({
      sql: `INSERT INTO exchange_comments
        (event_id, channel, parent_id, reply_to_member_id, author_member_id,
         body, status, upvotes, pinned, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?) RETURNING id`,
      args: [
        c.eventId,
        c.channel ?? "qa",
        c.parentId ?? null,
        c.replyTo ? ids[c.replyTo] : null,
        ids[c.author],
        c.body,
        c.status ?? "visible",
        c.createdAt ?? iso(Date.now()),
      ],
    });
    return Number(r.rows[0].id);
  });
}

async function insertMember(key: UserKey) {
  const u = USERS[key];
  await withDb(async (db) => {
    await db.execute({
      sql: "DELETE FROM members WHERE username = ?",
      args: [u.username],
    });
    const r = await db.execute({
      sql: `INSERT INTO members
        (name, username, password_hash, approval_status, signup_intent,
         is_active, default_with_partner)
        VALUES (?, ?, ?, ?, ?, 1, 0) RETURNING id`,
      args: [
        u.name,
        u.username,
        bcrypt.hashSync(PASSWORD, 12),
        u.status,
        key === "ex" ? "exchange" : "group",
      ],
    });
    ids[key] = Number(r.rows[0].id);
  });
}

async function clearBurst(user: UserKey) {
  await withDb((db) =>
    db.execute({
      sql: "DELETE FROM rate_limit_buckets WHERE key = ?",
      args: [`exchange-comment-burst:${ids[user]}`],
    }),
  );
}

async function scalar(sql: string, args: (string | number)[] = []) {
  return withDb(async (db) => {
    const r = await db.execute({ sql, args });
    return r.rows[0] ? Number(Object.values(r.rows[0])[0]) : 0;
  });
}

/** Xoá mọi dòng giao lưu của member test, theo thứ tự khoá ngoại. */
async function cleanup() {
  await withDb(async (db) => {
    const members = (
      await db.execute({
        sql: `SELECT id FROM members WHERE username IN (${Object.values(USERS)
          .map(() => "?")
          .join(",")})`,
        args: Object.values(USERS).map((u) => u.username),
      })
    ).rows.map((r) => Number(r.id));
    if (members.length > 0) {
      const inList = members.map(() => "?").join(",");
      const events = `(SELECT id FROM exchange_events WHERE host_member_id IN (${inList}))`;
      const comments = `(SELECT id FROM exchange_comments WHERE event_id IN ${events})`;
      await db.execute({
        sql: `DELETE FROM exchange_comment_votes WHERE member_id IN (${inList})
              OR comment_id IN ${comments}`,
        args: [...members, ...members],
      });
      await db.execute({
        sql: `DELETE FROM exchange_comment_reads WHERE member_id IN (${inList})
              OR event_id IN ${events}`,
        args: [...members, ...members],
      });
      await db.execute({
        sql: `DELETE FROM abuse_reports WHERE reporter_member_id IN (${inList})
              OR (target_type = 'comment' AND target_id IN ${comments})
              OR (target_type = 'event' AND target_id IN ${events})`,
        args: [...members, ...members, ...members],
      });
      await db.execute({
        sql: `UPDATE exchange_comments SET parent_id = NULL
              WHERE event_id IN ${events}`,
        args: members,
      });
      await db.execute({
        sql: `DELETE FROM exchange_comments WHERE event_id IN ${events}
              OR author_member_id IN (${inList})`,
        args: [...members, ...members],
      });
      await db.execute({
        sql: `DELETE FROM notification_deliveries WHERE notification_id IN
              (SELECT id FROM notifications WHERE kind LIKE 'exchange_%'
               AND recipient_type = 'member' AND recipient_id IN (${inList}))`,
        args: members,
      });
      await db.execute({
        sql: `DELETE FROM notifications WHERE kind LIKE 'exchange_%'
              AND recipient_type = 'member' AND recipient_id IN (${inList})`,
        args: members,
      });
      await db.execute(
        "DELETE FROM rate_limit_buckets WHERE key LIKE 'exchange-comment-%'",
      );
      await db.execute({
        sql: `DELETE FROM exchange_registrations WHERE member_id IN (${inList})
              OR event_id IN ${events}`,
        args: [...members, ...members],
      });
      await db.execute({
        sql: `DELETE FROM exchange_events WHERE host_member_id IN (${inList})`,
        args: members,
      });
      await db.execute({
        sql: `DELETE FROM members WHERE id IN (${inList})`,
        args: members,
      });
    }
    await db.execute({
      sql: "DELETE FROM venues WHERE name LIKE ?",
      args: [`${PREFIX}%`],
    });
  });
}

test.beforeAll(async () => {
  await cleanup();
  previousFlag = await readSetting("exchangeEnabled");
  previousNotify = await readSetting("notificationsEnabled");
  await writeSetting("exchangeEnabled", "true");
  await writeSetting("notificationsEnabled", "true");
  await withDb(async (db) => {
    // Mỗi lần đăng nhập mật khẩu ghi một dòng rate limit.
    await db.execute("DELETE FROM rate_limit_buckets").catch(() => {});
    const v = await db.execute({
      sql: "INSERT INTO venues (name, lat, lng, status) VALUES (?, ?, ?, 'approved') RETURNING id",
      args: [VENUE, 9.5, 106.2],
    });
    venueId = Number(v.rows[0].id);
  });
  for (const k of Object.keys(USERS) as UserKey[]) await insertMember(k);
});

test.afterAll(async () => {
  await exCtx?.close().catch(() => {});
  await cleanup();
  await writeSetting("exchangeEnabled", previousFlag);
  await writeSetting("notificationsEnabled", previousNotify);
});

/** Ngữ cảnh 390px, không tải SDK đăng nhập ngoài. */
async function newCtx(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] },
  });
  await ctx.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
  return ctx;
}

async function loginAs(ctx: BrowserContext, user: UserKey): Promise<Page> {
  await withDb((db) =>
    db.execute(
      "DELETE FROM rate_limit_buckets WHERE key NOT LIKE 'exchange-comment-%'",
    ),
  );
  const page = await ctx.newPage();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page
    .getByPlaceholder("Username / SĐT / Email")
    .fill(USERS[user].username);
  await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByPlaceholder("Username / SĐT / Email")).toHaveCount(0, {
    timeout: 20_000,
  });
  return page;
}

/** Bình luận trong cây: lấy thẻ trong cùng chứa đoạn chữ (hậu duệ nằm sau tổ tiên). */
const article = (page: Page, text: string): Locator =>
  page.locator("article").filter({ hasText: text }).last();

const turnstileFrame = (page: Page) =>
  page.locator('iframe[src*="challenges.cloudflare.com"]');

const composer = (page: Page) => page.getByPlaceholder("Viết bình luận...");
const sendBtn = (page: Page) =>
  page.getByRole("button", { name: "Gửi", exact: true });

async function openEvent(
  page: Page,
  code: string,
  channel: "qa" | "nhom" = "qa",
) {
  await page.goto(`/giao-luu/${code}?kenh=${channel}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "Bình luận" })).toBeVisible({
    timeout: 20_000,
  });
}

async function pickMenu(page: Page, text: string, item: string) {
  await article(page, text).getByRole("button", { name: "Thêm" }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

test("exchange account asks a question after Turnstile, host replies, asker sees the nested reply and a bell notification", async ({
  browser,
}) => {
  const ev = await seedEvent(`${PREFIX}Hoi dap`);
  exCtx = await newCtx(browser);
  const page = await loginAs(exCtx, "ex");
  await openEvent(page, ev.code);

  const q = "Sân có chỗ gửi xe máy không host?";
  await composer(page).fill(q);
  await sendBtn(page).click();
  // Lần đầu: widget hiện, token về thì bình luận tự gửi đi. Dòng "Đang gửi…"
  // có thể hiện rồi bị gỡ khi cần Turnstile, nên chờ bản ghi thật trong DB.
  await expect
    .poll(
      () =>
        scalar(
          "SELECT COUNT(*) FROM exchange_comments WHERE event_id = ? AND author_member_id = ?",
          [ev.id, ids.ex],
        ),
      { timeout: 60_000 },
    )
    .toBe(1);
  await expect(article(page, q)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Đang gửi…")).toHaveCount(0, { timeout: 20_000 });

  const hostCtx = await newCtx(browser);
  const host = await loginAs(hostCtx, "host");
  await openEvent(host, ev.code);
  await article(host, q).getByRole("button", { name: "Trả lời" }).click();
  const a = "Có chỗ gửi xe ngay cổng, miễn phí nhé.";
  await host.getByPlaceholder(`Trả lời ${USERS.ex.name}...`).fill(a);
  // Ô trả lời nằm trong thẻ câu hỏi; ô gốc ở đầu danh sách cũng có nút Gửi.
  await article(host, q)
    .getByRole("button", { name: "Gửi", exact: true })
    .click();
  // Host cũng qua Turnstile ở bình luận đầu: chờ bản ghi thật, không tin dòng tạm.
  await expect
    .poll(
      () =>
        scalar(
          "SELECT COUNT(*) FROM exchange_comments WHERE event_id = ? AND author_member_id = ? AND parent_id IS NOT NULL",
          [ev.id, ids.host],
        ),
      { timeout: 60_000 },
    )
    .toBe(1);
  await expect(article(host, a)).toBeVisible({ timeout: 20_000 });
  await hostCtx.close();

  // Người hỏi tải lại: thấy câu trả lời lồng dưới câu hỏi.
  await openEvent(page, ev.code);
  // Trả lời nằm cùng chủ đề (data-thread) với câu hỏi, thụt dưới nó.
  await expect(
    page
      .locator("[data-thread]")
      .filter({ hasText: q })
      .filter({ hasText: a })
      .first(),
  ).toBeVisible({ timeout: 20_000 });

  // Tin "có người trả lời bạn" vào chuông (ghi nền, nên chờ).
  await expect
    .poll(
      () =>
        scalar(
          `SELECT COUNT(*) FROM notifications WHERE kind = 'exchange_comment_reply'
           AND recipient_type = 'member' AND recipient_id = ?`,
          [ids.ex],
        ),
      { timeout: 20_000 },
    )
    .toBe(1);
  await expect(
    page.getByRole("button", { name: /Thông báo/ }).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test("second comment in the same session shows no Turnstile", async () => {
  expect(exCtx).not.toBeNull();
  const ev = await seedEvent(`${PREFIX}Turnstile`);
  const page = await exCtx!.newPage();
  await clearBurst("ex");
  await openEvent(page, ev.code);
  const q = "Có cho thuê vợt tại sân không?";
  await composer(page).fill(q);
  await sendBtn(page).click();
  await expect(article(page, q)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Đang gửi…")).toHaveCount(0, { timeout: 20_000 });
  await expect(turnstileFrame(page)).toHaveCount(0);
  expect(
    await scalar(
      "SELECT COUNT(*) FROM exchange_comments WHERE event_id = ? AND author_member_id = ?",
      [ev.id, ids.ex],
    ),
  ).toBe(1);
});

test("comment with a phone waits for the host, guest cannot see it, host approves", async ({
  browser,
}) => {
  const ev = await seedEvent(`${PREFIX}Cho duyet`);
  const page = await exCtx!.newPage();
  await clearBurst("ex");
  await openEvent(page, ev.code);
  const q = "Gọi mình số 0912 345 678 để chốt chỗ nhé";
  await composer(page).fill(q);
  await sendBtn(page).click();
  // Tác giả vẫn thấy chữ của mình kèm nhãn chờ duyệt.
  await expect(article(page, q).getByText("Đang chờ host duyệt")).toBeVisible({
    timeout: 20_000,
  });

  const guestCtx = await newCtx(browser);
  const guest = await guestCtx.newPage();
  await openEvent(guest, ev.code);
  await expect(guest.getByText(q)).toHaveCount(0);

  const hostCtx = await newCtx(browser);
  const host = await loginAs(hostCtx, "host");
  await openEvent(host, ev.code);
  await expect(host.getByText("Đang chờ duyệt (1)")).toBeVisible({
    timeout: 20_000,
  });
  await pickMenu(host, q, "Duyệt");
  await expect(host.getByText("Đang chờ duyệt (1)")).toHaveCount(0, {
    timeout: 20_000,
  });
  await hostCtx.close();

  await openEvent(guest, ev.code);
  await expect(guest.getByText(q)).toBeVisible({ timeout: 20_000 });
  await guestCtx.close();
  await page.close();
});

test("guest and pending account see no Nhóm buổi tab; approved registrant posts there", async ({
  browser,
}) => {
  const ev = await seedEvent(`${PREFIX}Nhom buoi`);
  await seedApproved(ev.id, "mem");
  const hostNote = "Mai mình đổi sang sân số 3 nhé cả nhà.";
  await seedComment({
    eventId: ev.id,
    author: "host",
    body: hostNote,
    channel: "group",
  });

  const guestCtx = await newCtx(browser);
  const guest = await guestCtx.newPage();
  await openEvent(guest, ev.code, "nhom");
  await expect(guest.getByRole("tab", { name: "Nhóm buổi" })).toHaveCount(0);
  await expect(guest.getByText(hostNote)).toHaveCount(0);
  await guestCtx.close();

  const pend = await exCtx!.newPage();
  await openEvent(pend, ev.code, "nhom");
  await expect(pend.getByRole("tab", { name: "Nhóm buổi" })).toHaveCount(0);
  await expect(pend.getByText(hostNote)).toHaveCount(0);
  await pend.close();

  const memCtx = await newCtx(browser);
  const mem = await loginAs(memCtx, "mem");
  await openEvent(mem, ev.code);
  await mem.getByRole("tab", { name: "Nhóm buổi" }).click();
  await expect(mem.getByText(hostNote)).toBeVisible({ timeout: 20_000 });
  const msg = "Mình đi chung xe được 2 người nhé.";
  await composer(mem).fill(msg);
  await sendBtn(mem).click();
  // Bình luận đầu của member này qua Turnstile: dòng tạm có thể bị gỡ rồi gửi lại.
  await expect
    .poll(
      () =>
        scalar(
          "SELECT COUNT(*) FROM exchange_comments WHERE event_id = ? AND channel = 'group' AND author_member_id = ?",
          [ev.id, ids.mem],
        ),
      { timeout: 60_000 },
    )
    .toBe(1);
  await expect(article(mem, msg)).toBeVisible({ timeout: 20_000 });
  await expect(mem.getByText("Đang gửi…")).toHaveCount(0, { timeout: 20_000 });
  await memCtx.close();
});

test("three reports hide a comment; admin unhides it in /admin/giao-luu", async ({
  browser,
}) => {
  // Ba lần đăng nhập, mỗi lần một Turnstile: bài này chậm hơn các bài khác.
  test.setTimeout(240_000);
  const ev = await seedEvent(`${PREFIX}Bao cao`);
  const text = "Quảng cáo sân khác rẻ hơn nhiều, ghé xem đi.";
  const commentId = await seedComment({
    eventId: ev.id,
    author: "ex",
    body: text,
  });

  for (const key of ["r1", "r2", "r3"] as const) {
    const ctx = await newCtx(browser);
    const page = await loginAs(ctx, key);
    await openEvent(page, ev.code);
    await expect(article(page, text)).toBeVisible({ timeout: 20_000 });
    await pickMenu(page, text, "Báo cáo");
    const submit = page.getByRole("button", { name: "Gửi báo cáo" });
    await expect(submit).toBeEnabled({ timeout: 40_000 });
    await submit.click();
    await expect(page.getByText("Đã gửi báo cáo. Cảm ơn bạn.")).toBeVisible({
      timeout: 20_000,
    });
    await ctx.close();
  }
  expect(
    await scalar(
      "SELECT COUNT(*) FROM exchange_comments WHERE id = ? AND status = 'hidden'",
      [commentId],
    ),
  ).toBe(1);

  const guestCtx = await newCtx(browser);
  const guest = await guestCtx.newPage();
  await openEvent(guest, ev.code);
  // Bình luận ẩn không có trả lời thì biến mất hẳn, không để lại dòng giữ chỗ.
  await expect(guest.getByText(text)).toHaveCount(0);

  const adminCtx = await browser.newContext({
    storageState: "e2e/.auth/admin.json",
    viewport: { width: 390, height: 844 },
  });
  const admin = await adminCtx.newPage();
  await admin.goto("/admin/giao-luu", { waitUntil: "domcontentloaded" });
  await admin.getByRole("tab", { name: "Bình luận", exact: true }).click();
  await admin.getByRole("tab", { name: "Đang ẩn", exact: true }).click();
  await expect(admin.getByText(text)).toBeVisible({ timeout: 20_000 });
  await admin.getByRole("button", { name: "Bỏ ẩn" }).first().click();
  await expect(admin.getByText("Đã bỏ ẩn bình luận")).toBeVisible({
    timeout: 20_000,
  });
  await adminCtx.close();

  expect(
    await scalar(
      "SELECT COUNT(*) FROM exchange_comments WHERE id = ? AND status = 'visible'",
      [commentId],
    ),
  ).toBe(1);
  await openEvent(guest, ev.code);
  await expect(guest.getByText(text)).toBeVisible({ timeout: 20_000 });
  await guestCtx.close();
});

test("host locks comments and the composer is replaced by the locked line", async ({
  browser,
}) => {
  const ev = await seedEvent(`${PREFIX}Khoa`);
  const hostCtx = await newCtx(browser);
  const host = await loginAs(hostCtx, "host");
  await openEvent(host, ev.code);
  await expect(composer(host)).toBeVisible({ timeout: 20_000 });
  await host.getByRole("switch", { name: "Khoá bình luận" }).click();
  await expect(
    host.getByText("Host đã khoá bình luận của buổi này."),
  ).toBeVisible({ timeout: 20_000 });
  await expect(composer(host)).toHaveCount(0);
  await hostCtx.close();
  expect(
    await scalar("SELECT comments_locked FROM exchange_events WHERE id = ?", [
      ev.id,
    ]),
  ).toBe(1);

  const page = await exCtx!.newPage();
  await openEvent(page, ev.code);
  await expect(
    page.getByText("Host đã khoá bình luận của buổi này."),
  ).toBeVisible({ timeout: 20_000 });
  await expect(composer(page)).toHaveCount(0);
  await page.close();
});

test("deleting a comment with a reply shows [đã xoá] right after reload", async () => {
  const ev = await seedEvent(`${PREFIX}Xoa`);
  const q = "Câu hỏi này mình sẽ xoá sau.";
  const a = "Câu trả lời của host vẫn phải còn.";
  const parent = await seedComment({ eventId: ev.id, author: "ex", body: q });
  await seedComment({
    eventId: ev.id,
    author: "host",
    body: a,
    parentId: parent,
    replyTo: "ex",
  });

  const page = await exCtx!.newPage();
  await openEvent(page, ev.code);
  await expect(article(page, q)).toBeVisible({ timeout: 20_000 });
  await pickMenu(page, q, "Xoá");
  await page
    .getByRole("alertdialog")
    .or(page.getByRole("dialog"))
    .getByRole("button", { name: "Xoá", exact: true })
    .last()
    .click();
  await expect(page.getByText("[đã xoá]").first()).toBeVisible({
    timeout: 20_000,
  });

  await openEvent(page, ev.code);
  await expect(page.getByText("[đã xoá]").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(a)).toBeVisible();
  await expect(page.getByText(q)).toHaveCount(0);
  await page.close();
});

test("Hữu ích keeps its count after reload", async ({ browser }) => {
  const ev = await seedEvent(`${PREFIX}Huu ich`);
  await seedApproved(ev.id, "mem");
  const text = "Nhớ mang vợt và giày trong nhà nhé.";
  const id = await seedComment({ eventId: ev.id, author: "host", body: text });

  const ctx = await newCtx(browser);
  const page = await loginAs(ctx, "mem");
  await openEvent(page, ev.code);
  const btn = () =>
    article(page, text).getByRole("button", { name: /^Hữu ích/ });
  await expect(btn()).toHaveText("Hữu ích 0", { timeout: 20_000 });
  await btn().click();
  await expect(btn()).toHaveText("Hữu ích 1");
  await expect
    .poll(
      () => scalar("SELECT upvotes FROM exchange_comments WHERE id = ?", [id]),
      { timeout: 20_000 },
    )
    .toBe(1);

  await openEvent(page, ev.code);
  await expect(btn()).toHaveText("Hữu ích 1", { timeout: 20_000 });
  await expect(btn()).toHaveAttribute("aria-pressed", "true");
  await ctx.close();
});

test("Giao lưu của tôi shows 1 new comment, then 0 after opening the event", async ({
  browser,
}) => {
  // Chỉ buổi kết thúc trong 14 ngày gần đây mới được đếm bình luận mới.
  const ev = await seedEvent(`${PREFIX}Da xong`, -26);
  await seedApproved(ev.id, "mem");
  await seedComment({
    eventId: ev.id,
    author: "host",
    body: "Cảm ơn mọi người đã đến, ai để quên đồ báo mình nhé.",
  });

  const ctx = await newCtx(browser);
  const page = await loginAs(ctx, "mem");
  await page.goto("/giao-luu/cua-toi", { waitUntil: "domcontentloaded" });
  const badge = page.getByRole("link", { name: "1 bình luận mới" });
  await expect(badge).toBeVisible({ timeout: 20_000 });
  await badge.click();
  await expect(page.getByRole("heading", { name: "Bình luận" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByText("Cảm ơn mọi người đã đến, ai để quên đồ báo mình nhé."),
  ).toBeVisible({ timeout: 20_000 });
  // Mốc đã đọc ghi nền sau khi danh sách tải xong.
  await expect
    .poll(
      () =>
        scalar(
          "SELECT COUNT(*) FROM exchange_comment_reads WHERE event_id = ? AND member_id = ? AND last_read_at IS NOT NULL",
          [ev.id, ids.mem],
        ),
      { timeout: 20_000 },
    )
    .toBe(1);

  await page.goto("/giao-luu/cua-toi", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(`${PREFIX}Da xong`).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/bình luận mới/)).toHaveCount(0);
  await ctx.close();
});
