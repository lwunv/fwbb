import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

/**
 * E2E cho buổi giao lưu (G2b) ở 390px.
 *
 * Dữ liệu seed thẳng vào e2e/local.db (server `next start` dùng cùng file).
 * Buổi mở bằng form chỉ phủ ở bài đầu; các bài sau seed buổi bằng SQL để mỗi
 * bài kiểm đúng một luồng. Cờ `exchangeEnabled` (và `notificationsEnabled`
 * cho bài duyệt đăng ký) được khôi về mặc định (xoá hàng) ở afterAll.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

const PASSWORD = "ExchangeE2e#1";
const PREFIX = "E2E GL ";
const USERS = {
  host: { username: "e2exev1", name: "E2E GL Host" },
  ex: { username: "e2exev2", name: "E2E GL Khach Giao Luu" },
  other: { username: "e2exev3", name: "E2E GL Thanh Vien" },
} as const;
type UserKey = keyof typeof USERS;
const ids: Record<UserKey, number> = { host: 0, ex: 0, other: 0 };

// Cache tìm sân và tìm buổi theo ô lưới 0,01 độ, sống 60 giây. Mỗi lần chạy
// dùng một ô riêng để không đọc nhầm kết quả của lần chạy trước.
const cellOffset = (Math.floor(Date.now() / 1000) % 500) * 0.01;
const HERE = { latitude: 9 + cellOffset, longitude: 106.2 };
const VENUE = `${PREFIX}San`;
let venueId = 0;

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const inHours = (h: number) => iso(Date.now() + h * HOUR);

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

const setFlag = (on: boolean) => writeSetting("exchangeEnabled", String(on));

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function randomCode(): string {
  let out = "";
  for (let i = 0; i < 10; i++)
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

type SeedEvent = {
  title: string;
  startAt: string;
  endAt: string;
  slotsTotal?: number;
  feeMode?: "fixed" | "split_equal";
  feeAmountMale?: number | null;
  estimatedTotalCost?: number | null;
  minHeads?: number | null;
  autoApprove?: boolean;
  payout?: boolean;
};

async function seedEvent(e: SeedEvent): Promise<{ id: number; code: string }> {
  const code = randomCode();
  const now = iso(Date.now());
  const start = new Date(e.startAt).getTime();
  return withDb(async (db) => {
    const r = await db.execute({
      sql: `INSERT INTO exchange_events
        (public_code, host_member_id, venue_id, title, start_at, end_at,
         slots_total, host_heads, fee_mode, fee_amount_male,
         estimated_total_cost, min_heads, deposit_amount, register_deadline,
         cancel_deadline, auto_approve, allow_plus_ones, payout_bank_bin,
         payout_account_no, payout_account_name, status, lock_count,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?,
                'open', 0, ?, ?)
        RETURNING id`,
      args: [
        code,
        ids.host,
        venueId,
        e.title,
        e.startAt,
        e.endAt,
        e.slotsTotal ?? 8,
        e.feeMode ?? "fixed",
        e.feeMode === "split_equal" ? null : (e.feeAmountMale ?? 50_000),
        e.estimatedTotalCost ?? null,
        e.minHeads ?? null,
        iso(start - 2 * HOUR),
        iso(start - 12 * HOUR),
        e.autoApprove ? 1 : 0,
        e.payout ? "970436" : null,
        e.payout ? "0123456789" : null,
        e.payout ? "E2E GL HOST" : null,
        now,
        now,
      ],
    });
    return { id: Number(r.rows[0].id), code };
  });
}

async function seedRegistration(
  eventId: number,
  user: UserKey,
  status: "approved" | "pending",
) {
  const now = iso(Date.now());
  await withDb((db) =>
    db.execute({
      sql: `INSERT INTO exchange_registrations
        (event_id, member_id, status, male_count, female_count, created_at,
         updated_at)
        VALUES (?, ?, ?, 1, 0, ?, ?)`,
      args: [eventId, ids[user], status, now, now],
    }),
  );
}

async function regRow(eventId: number, user: UserKey) {
  return withDb(async (db) => {
    const r = await db.execute({
      sql: `SELECT status, paid, checked_in, fee_amount
            FROM exchange_registrations WHERE event_id = ? AND member_id = ?`,
      args: [eventId, ids[user]],
    });
    return r.rows[0];
  });
}

async function insertMember(
  key: UserKey,
  status: "pending" | "approved",
  intent: "group" | "exchange",
) {
  await withDb(async (db) => {
    await db.execute({
      sql: "DELETE FROM members WHERE username = ?",
      args: [USERS[key].username],
    });
    const r = await db.execute({
      sql: `INSERT INTO members
        (name, username, password_hash, approval_status, signup_intent,
         is_active, default_with_partner)
        VALUES (?, ?, ?, ?, ?, 1, 0) RETURNING id`,
      args: [
        USERS[key].name,
        USERS[key].username,
        bcrypt.hashSync(PASSWORD, 12),
        status,
        intent,
      ],
    });
    ids[key] = Number(r.rows[0].id);
  });
}

/** Xoá mọi dòng giao lưu của các member test, theo thứ tự khoá ngoại. */
async function cleanup() {
  await withDb(async (db) => {
    const members = (
      await db.execute({
        sql: "SELECT id FROM members WHERE username IN (?, ?, ?)",
        args: Object.values(USERS).map((u) => u.username),
      })
    ).rows.map((r) => Number(r.id));
    if (members.length > 0) {
      const inList = members.map(() => "?").join(",");
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
      const events = `(SELECT id FROM exchange_events WHERE host_member_id IN (${inList}))`;
      await db.execute({
        sql: `DELETE FROM abuse_reports WHERE reporter_member_id IN (${inList})
              OR (target_type = 'event' AND target_id IN ${events})`,
        args: [...members, ...members],
      });
      await db.execute({
        sql: `DELETE FROM host_blocks WHERE host_member_id IN (${inList})
              OR blocked_member_id IN (${inList})`,
        args: [...members, ...members],
      });
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
  // Về mặc định (hàng không tồn tại) thay vì tin giá trị đang có: lần chạy bị
  // ngắt giữa chừng có thể để cờ bật, và giữ nguyên là giữ luôn rò rỉ đó.
  await writeSetting("exchangeEnabled", null);
  await writeSetting("notificationsEnabled", null);
  await setFlag(true);
  await withDb(async (db) => {
    // Mỗi lần đăng nhập mật khẩu ghi một dòng rate limit.
    await db.execute("DELETE FROM rate_limit_buckets").catch(() => {});
    const v = await db.execute({
      sql: "INSERT INTO venues (name, lat, lng, status) VALUES (?, ?, ?, 'approved') RETURNING id",
      args: [VENUE, HERE.latitude + 0.009, HERE.longitude],
    });
    venueId = Number(v.rows[0].id);
  });
  await insertMember("host", "approved", "group");
  await insertMember("ex", "pending", "exchange");
  await insertMember("other", "approved", "group");
});

test.afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await writeSetting("exchangeEnabled", null);
    await writeSetting("notificationsEnabled", null);
  }
});

/** Ngữ cảnh 390px có GPS giả, style bản đồ rỗng và không tải SDK đăng nhập ngoài. */
async function newCtx(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: HERE,
    permissions: ["geolocation"],
    storageState: { cookies: [], origins: [] },
  });
  await ctx.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
  await ctx.route("**/tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
    }),
  );
  await ctx.route(/img\.vietqr\.io/, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    }),
  );
  return ctx;
}

async function loginAs(ctx: BrowserContext, user: UserKey): Promise<Page> {
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

const noHorizontalScroll = async (page: Page) => {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

/** Ngày YYYY-MM-DD theo giờ VN, `days` ngày sau hôm nay. */
const vnDate = (days: number) =>
  new Date(Date.now() + 7 * HOUR + days * 24 * HOUR).toISOString().slice(0, 10);

let listedCode = "";

test("host opens a split-fee event and sees the estimate preview", async ({
  browser,
}) => {
  const ctx = await newCtx(browser);
  const page = await loginAs(ctx, "host");
  await page.goto("/giao-luu/mo");

  await page.getByRole("button", { name: "Chọn sân" }).click();
  await page.getByRole("button", { name: new RegExp(VENUE) }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(`${VENUE}.*Đổi sân`) }),
  ).toBeVisible();

  await page.getByLabel("Ngày", { exact: true }).fill(vnDate(5));
  await page.getByLabel("Tiêu đề").fill(`${PREFIX}Mo moi`);
  await page.getByRole("radio", { name: "Chia đều tiền sân" }).click();
  const total = page.getByLabel("Tổng tiền dự kiến (sân, cầu)");
  await total.fill("600000");
  await total.press("Tab");

  const preview = page.getByTestId("fee-preview");
  await expect(preview).toContainText(/Tối đa .+\/người khi có 6 người/);
  await noHorizontalScroll(page);

  const submit = page.getByRole("button", { name: "Mở buổi", exact: true });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();

  await expect(page).toHaveURL(/\/giao-luu\/[a-z0-9]{10}$/, {
    timeout: 20_000,
  });
  await expect(
    page.getByRole("heading", { name: `${PREFIX}Mo moi` }),
  ).toBeVisible({ timeout: 15_000 });
  const row = await withDb((db) =>
    db.execute({
      sql: "SELECT fee_mode, estimated_total_cost FROM exchange_events WHERE title = ?",
      args: [`${PREFIX}Mo moi`],
    }),
  );
  expect(row.rows[0].fee_mode).toBe("split_equal");
  expect(Number(row.rows[0].estimated_total_cost)).toBe(600_000);
  await ctx.close();
});

test("guest sees the event on the list and as a pin, and is sent to login on Đăng ký", async ({
  browser,
}) => {
  const title = `${PREFIX}Khach xem`;
  const ev = await seedEvent({
    title,
    startAt: inHours(24),
    endAt: inHours(26),
  });
  listedCode = ev.code;
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await page.goto("/giao-luu");

  const card = page.getByRole("link", { name: new RegExp(title) });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveAttribute("href", `/giao-luu/${ev.code}`);
  await noHorizontalScroll(page);

  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(`^${VENUE}`) }),
  ).toBeVisible({ timeout: 20_000 });

  await page.goto(`/giao-luu/${ev.code}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("link", { name: "Đăng nhập để đăng ký" }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/giao-luu/dang-nhap\\?next=${encodeURIComponent(`/giao-luu/${ev.code}`)}`,
    ),
  );
  await ctx.close();
});

test("pending exchange account registers; host approves; registrant sees approved", async ({
  browser,
}) => {
  // Tin "được duyệt" chỉ ghi khi công tắc thông báo bật.
  await writeSetting("notificationsEnabled", "true");
  const ev = await seedEvent({
    title: `${PREFIX}Duyet tay`,
    startAt: inHours(48),
    endAt: inHours(50),
  });
  const guestCtx = await newCtx(browser);
  const guest = await loginAs(guestCtx, "ex");
  await guest.goto(`/giao-luu/${ev.code}`);
  await guest.getByRole("button", { name: "Đăng ký", exact: true }).click();
  const send = guest.getByRole("button", { name: "Gửi đăng ký" });
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.click();
  await expect(guest.getByText("Đang chờ host duyệt")).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(async () => (await regRow(ev.id, "ex"))?.status, { timeout: 15_000 })
    .toBe("pending");

  const hostCtx = await newCtx(browser);
  const host = await loginAs(hostCtx, "host");
  await host.goto(`/giao-luu/${ev.code}/quan-ly`);
  await expect(host.getByText(USERS.ex.name)).toBeVisible({ timeout: 15_000 });
  await host.getByRole("button", { name: "Duyệt", exact: true }).click();
  await expect
    .poll(async () => (await regRow(ev.id, "ex"))?.status, { timeout: 15_000 })
    .toBe("approved");

  await guest.reload();
  await expect(guest.getByText("Bạn đã được duyệt")).toBeVisible({
    timeout: 15_000,
  });
  const notif = await withDb((db) =>
    db.execute({
      sql: `SELECT COUNT(*) AS n FROM notifications
            WHERE kind = 'exchange_registration_approved'
              AND recipient_type = 'member' AND recipient_id = ?`,
      args: [ids.ex],
    }),
  );
  expect(Number(notif.rows[0].n)).toBeGreaterThanOrEqual(1);
  await guestCtx.close();
  await hostCtx.close();
});

test("last slot: second registrant waitlisted, promoted when the first cancels", async ({
  browser,
}) => {
  const ev = await seedEvent({
    title: `${PREFIX}Slot cuoi`,
    startAt: inHours(72),
    endAt: inHours(74),
    slotsTotal: 1,
    autoApprove: true,
  });
  const firstCtx = await newCtx(browser);
  const first = await loginAs(firstCtx, "ex");
  await first.goto(`/giao-luu/${ev.code}`);
  await first.getByRole("button", { name: "Đăng ký", exact: true }).click();
  const send1 = first.getByRole("button", { name: "Gửi đăng ký" });
  await expect(send1).toBeEnabled({ timeout: 30_000 });
  await send1.click();
  await expect(first.getByText("Bạn đã được duyệt")).toBeVisible({
    timeout: 15_000,
  });

  const secondCtx = await newCtx(browser);
  const second = await loginAs(secondCtx, "other");
  await second.goto(`/giao-luu/${ev.code}`);
  await second.getByRole("button", { name: "Đăng ký", exact: true }).click();
  const send2 = second.getByRole("button", { name: "Gửi đăng ký" });
  await expect(send2).toBeEnabled({ timeout: 30_000 });
  await send2.click();
  await expect(second.getByText("Danh sách chờ, vị trí 1")).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(async () => (await regRow(ev.id, "other"))?.status, {
      timeout: 15_000,
    })
    .toBe("waitlist");

  await first.getByRole("button", { name: "Huỷ", exact: true }).click();
  await expect
    .poll(async () => (await regRow(ev.id, "ex"))?.status, { timeout: 15_000 })
    .toBe("cancelled");
  await expect
    .poll(async () => (await regRow(ev.id, "other"))?.status, {
      timeout: 15_000,
    })
    .toBe("approved");

  await second.reload();
  await expect(second.getByText("Bạn đã được duyệt")).toBeVisible({
    timeout: 15_000,
  });
  await firstCtx.close();
  await secondCtx.close();
});

test("host locks below minHeads after confirming; participant sees amount and QR; host marks paid", async ({
  browser,
}) => {
  const ev = await seedEvent({
    title: `${PREFIX}Chot phi`,
    startAt: inHours(96),
    endAt: inHours(98),
    feeMode: "split_equal",
    estimatedTotalCost: 600_000,
    minHeads: 6,
    payout: true,
  });
  await seedRegistration(ev.id, "other", "approved");

  const hostCtx = await newCtx(browser);
  const host = await loginAs(hostCtx, "host");
  await host.goto(`/giao-luu/${ev.code}/quan-ly`);
  await expect(host.getByText(USERS.other.name)).toBeVisible({
    timeout: 15_000,
  });
  await host.getByRole("button", { name: "Chốt phí", exact: true }).click();
  await host.getByRole("button", { name: "Xác nhận chốt phí" }).click();
  // Chỉ có 2 người (host + 1) trong khi dự kiến 6: mức mới vượt mức đã hiện.
  await expect(host.getByRole("alert")).toContainText("cao hơn mức đã hiện");
  await host.getByRole("button", { name: "Vẫn chốt" }).click();
  await expect(
    host.getByRole("button", { name: "Mở khoá để sửa" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => Number((await regRow(ev.id, "other"))?.fee_amount), {
      timeout: 15_000,
    })
    .toBe(300_000);

  const memberCtx = await newCtx(browser);
  const member = await loginAs(memberCtx, "other");
  await member.goto(`/giao-luu/${ev.code}`);
  await expect(member.getByText(/Cần chuyển 300[.,\s]000/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(member.getByAltText("Mã QR chuyển khoản")).toBeAttached();
  await noHorizontalScroll(member);

  const paid = host.getByRole("button", { name: "Đã trả", exact: true });
  await expect(paid).toBeVisible({ timeout: 15_000 });
  await paid.click();
  await expect
    .poll(async () => Number((await regRow(ev.id, "other"))?.paid), {
      timeout: 15_000,
    })
    .toBe(1);
  await expect(paid).toHaveAttribute("aria-pressed", "true");
  await hostCtx.close();
  await memberCtx.close();
});

test("host checks in a participant", async ({ browser }) => {
  // Điểm danh chỉ mở từ 60 phút trước giờ bắt đầu: buổi bắt đầu sau 30 phút.
  const ev = await seedEvent({
    title: `${PREFIX}Diem danh`,
    startAt: iso(Date.now() + 30 * 60_000),
    endAt: inHours(2),
  });
  await seedRegistration(ev.id, "other", "approved");

  const ctx = await newCtx(browser);
  const host = await loginAs(ctx, "host");
  await host.goto(`/giao-luu/${ev.code}/quan-ly`);
  const checkIn = host.getByRole("button", { name: "Điểm danh", exact: true });
  await expect(checkIn).toBeEnabled({ timeout: 15_000 });
  await checkIn.click();
  await expect(checkIn).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => Number((await regRow(ev.id, "other"))?.checked_in), {
      timeout: 15_000,
    })
    .toBe(1);
  await ctx.close();
});

test("exchange account cannot open /giao-luu/mo or any group page", async ({
  browser,
}) => {
  const ctx = await newCtx(browser);
  const page = await loginAs(ctx, "ex");

  await page.goto("/giao-luu/mo");
  await expect(
    page.getByText("Chỉ thành viên nhóm mới mở được buổi"),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: "Mở buổi", exact: true }),
  ).toHaveCount(0);

  for (const path of ["/", "/history", "/my-fund"]) {
    await page.goto(path);
    await expect(
      page.getByText("Tài khoản này dùng để đi giao lưu"),
      path,
    ).toBeVisible({ timeout: 15_000 });
  }
  await ctx.close();
});

test("flag off: /giao-luu, /giao-luu/<code>, /admin/giao-luu return 404 and /san shows no exchange count", async ({
  browser,
  request,
}) => {
  // Với cờ bật, thẻ sân đếm buổi sắp tới (bước kiểm đối chứng).
  const on = await newCtx(browser);
  const onPage = await on.newPage();
  await onPage.goto("/san");
  await expect(onPage.getByText(VENUE).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(onPage.getByText(/giao lưu sắp tới/).first()).toBeVisible();
  await on.close();

  await setFlag(false);
  for (const path of ["/giao-luu", `/giao-luu/${listedCode}`]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
  }
  const adminCtx = await browser.newContext({
    storageState: "e2e/.auth/admin.json",
  });
  try {
    const res = await adminCtx.request.get("/admin/giao-luu");
    expect(res.status()).toBe(404);
  } finally {
    await adminCtx.close();
  }

  const off = await newCtx(browser);
  const offPage = await off.newPage();
  await offPage.goto("/san");
  await expect(offPage.getByText(VENUE).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(offPage.getByText(/giao lưu sắp tới/)).toHaveCount(0);
  await off.close();
});
