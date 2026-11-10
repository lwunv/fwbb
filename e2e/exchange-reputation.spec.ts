import { createHash } from "node:crypto";
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
 * E2E cho uy tín giao lưu, người giới thiệu, nhắc chấm và đánh giá sân (G2d)
 * ở 390px.
 *
 * Seed thẳng vào e2e/local.db (server `next start` dùng cùng file). Mọi dữ
 * liệu đọc qua cache (hồ sơ 10 phút, điểm sân theo sân) được seed xong trong
 * beforeAll, trước lần xem đầu tiên, nên không bài nào thấy bản cache cũ. Mỗi
 * kịch bản sân dùng một sân riêng. Cờ `exchangeEnabled` và
 * `notificationsEnabled` được đưa về mặc định (xoá hàng) ở afterAll.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial", timeout: 120_000 });

const PASSWORD = "ReputationE2e#1";
const PREFIX = "E2E RP ";
type Seed = {
  username: string;
  name: string;
  status: "approved" | "pending";
  intent: "group" | "exchange";
  skill?: string;
};
const USERS = {
  host: {
    username: "e2erp01",
    name: "E2E RP Host",
    status: "approved",
    intent: "group",
  },
  p1: {
    username: "e2erp02",
    name: "E2E RP Mot",
    status: "pending",
    intent: "exchange",
  },
  p2: {
    username: "e2erp03",
    name: "E2E RP Hai",
    status: "pending",
    intent: "exchange",
  },
  p3: {
    username: "e2erp04",
    name: "E2E RP Ba",
    status: "pending",
    intent: "exchange",
  },
  p4: {
    username: "e2erp05",
    name: "E2E RP Bon",
    status: "pending",
    intent: "exchange",
    skill: "tby",
  },
  r1: {
    username: "e2erp06",
    name: "E2E RP Bao Mot",
    status: "approved",
    intent: "group",
  },
  r2: {
    username: "e2erp07",
    name: "E2E RP Bao Hai",
    status: "approved",
    intent: "group",
  },
  r3: {
    username: "e2erp08",
    name: "E2E RP Bao Ba",
    status: "approved",
    intent: "group",
  },
  noci: {
    username: "e2erp09",
    name: "E2E RP Chua Den",
    status: "approved",
    intent: "group",
  },
  nb1: {
    username: "e2erp10",
    name: "E2E RP Moi Mot",
    status: "pending",
    intent: "exchange",
  },
  nb2: {
    username: "e2erp11",
    name: "E2E RP Moi Hai",
    status: "pending",
    intent: "exchange",
  },
  nb3: {
    username: "e2erp12",
    name: "E2E RP Moi Ba",
    status: "pending",
    intent: "exchange",
  },
} satisfies Record<string, Seed>;
type UserKey = keyof typeof USERS;
const USER_KEYS = Object.keys(USERS) as UserKey[];
const ids = {} as Record<UserKey, number>;
const codes = {} as Record<UserKey, string>;

const VENUES = {
  A: `${PREFIX}San A`,
  B: `${PREFIX}San B`,
  C: `${PREFIX}San C`,
};
type VenueKey = keyof typeof VENUES;
const venueIds = {} as Record<VenueKey, number>;

type Ev = { id: number; code: string; startAt: string; endAt: string };
const ev = {} as Record<
  "H1" | "H2" | "H3" | "E2b" | "E2" | "E1" | "E3" | "E4" | "E5" | "N1" | "N2",
  Ev
>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

/** Nhận xét đã seed cho kịch bản báo cáo. */
const REPORTED_TEXT = "Sân C hơi trơn, nên mang giày đế tốt.";

/** Mốc id lúc spec bắt đầu: cron hằng ngày ghi tin và job cho cả dữ liệu khác. */
let notificationMark = 0;
let jobMark = 0;

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

async function scalar(sql: string, args: (string | number)[] = []) {
  return withDb(async (db) => {
    const r = await db.execute({ sql, args });
    return r.rows[0] ? Number(Object.values(r.rows[0])[0]) : 0;
  });
}

// Cùng bảng chữ với `newPublicCode` (bỏ i, l, o, 0, 1).
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function randomCode(): string {
  let out = "";
  for (let i = 0; i < 10; i++)
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

/** Ngày hiển thị theo giờ Việt Nam, như `vnDisplayDate` của app. */
function vnDate(ms: number): string {
  const [y, m, d] = new Date(ms + 7 * HOUR)
    .toISOString()
    .slice(0, 10)
    .split("-");
  return `${d}/${m}/${y}`;
}

const memberSql = () => `(${USER_KEYS.map(() => "?").join(",")})`;
const memberArgs = () => USER_KEYS.map((k) => USERS[k].username);

/** Xoá mọi dòng của spec theo thứ tự khoá ngoại. */
async function cleanup() {
  await withDb(async (db) => {
    const members = (
      await db.execute({
        sql: `SELECT id FROM members WHERE username IN ${memberSql()}`,
        args: memberArgs(),
      })
    ).rows.map((r) => Number(r.id));
    const venues = (
      await db.execute({
        sql: "SELECT id FROM venues WHERE name LIKE ?",
        args: [`${PREFIX}%`],
      })
    ).rows.map((r) => Number(r.id));
    const mIn = members.length ? members.join(",") : "-1";
    const vIn = venues.length ? venues.join(",") : "-1";
    const events = (
      await db.execute(
        `SELECT id FROM exchange_events WHERE host_member_id IN (${mIn})
         OR venue_id IN (${vIn})`,
      )
    ).rows.map((r) => Number(r.id));
    const eIn = events.length ? events.join(",") : "-1";
    const reviews = `(SELECT id FROM venue_reviews WHERE venue_id IN (${vIn}) OR member_id IN (${mIn}))`;

    await db.execute(
      `DELETE FROM peer_feedback WHERE event_id IN (${eIn})
       OR from_member_id IN (${mIn}) OR to_member_id IN (${mIn})`,
    );
    await db.execute(
      `DELETE FROM host_feedback WHERE event_id IN (${eIn})
       OR from_member_id IN (${mIn})`,
    );
    await db.execute(
      `DELETE FROM referrals WHERE referrer_member_id IN (${mIn})
       OR referee_member_id IN (${mIn})`,
    );
    await db.execute(
      `DELETE FROM abuse_reports WHERE reporter_member_id IN (${mIn})
       OR (target_type = 'review' AND target_id IN ${reviews})
       OR (target_type = 'venue' AND target_id IN (${vIn}))
       OR (target_type = 'member' AND target_id IN (${mIn}))
       OR (target_type = 'event' AND target_id IN (${eIn}))`,
    );
    await db.execute(`DELETE FROM venue_reviews WHERE id IN ${reviews}`);
    await db.execute(
      `DELETE FROM host_flag_reviews WHERE host_member_id IN (${mIn})`,
    );
    await db.execute(
      `DELETE FROM member_ip_signals WHERE member_id IN (${mIn})`,
    );
    for (const id of events) {
      await db.execute({
        sql: "DELETE FROM scheduled_jobs WHERE job_key LIKE ?",
        args: [`xrate:${id}:%`],
      });
    }
    if (jobMark > 0) {
      await db.execute({
        sql: "DELETE FROM scheduled_jobs WHERE id > ?",
        args: [jobMark],
      });
    }
    // Tin của member spec, và mọi tin tạo từ mốc đầu spec (cron hằng ngày ghi
    // cả tin nhắc nợ của dữ liệu khác trong file DB này).
    const notifWhere = `(recipient_type = 'member' AND recipient_id IN (${mIn}))${
      notificationMark > 0 ? ` OR id > ${notificationMark}` : ""
    }`;
    await db.execute(
      `DELETE FROM notification_deliveries WHERE notification_id IN
       (SELECT id FROM notifications WHERE ${notifWhere})`,
    );
    await db.execute(`DELETE FROM notifications WHERE ${notifWhere}`);
    for (const m of members) {
      for (const p of [
        "exchange-feedback",
        "venue-review",
        "exchange-report",
        "exchange-referral",
      ]) {
        await db.execute({
          sql: "DELETE FROM rate_limit_buckets WHERE key = ?",
          args: [`${p}:${m}`],
        });
      }
    }
    await db.execute(
      `DELETE FROM exchange_comment_reads WHERE member_id IN (${mIn})
       OR event_id IN (${eIn})`,
    );
    await db.execute(
      `DELETE FROM exchange_registrations WHERE member_id IN (${mIn})
       OR event_id IN (${eIn})`,
    );
    await db.execute(`DELETE FROM exchange_events WHERE id IN (${eIn})`);
    await db.execute(`DELETE FROM venues WHERE id IN (${vIn})`);
    await db.execute(`DELETE FROM members WHERE id IN (${mIn})`);
  });
}

async function seedAll() {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const now = Date.now();
  const nowIso = iso(now);
  await withDb(async (db) => {
    for (const k of USER_KEYS) {
      const u: Seed = USERS[k];
      const code = randomCode();
      const r = await db.execute({
        sql: `INSERT INTO members
          (name, username, password_hash, approval_status, signup_intent,
           is_active, default_with_partner, skill_level, public_code)
          VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?) RETURNING id`,
        args: [
          u.name,
          u.username,
          hash,
          u.status,
          u.intent,
          u.skill ?? null,
          code,
        ],
      });
      ids[k] = Number(r.rows[0].id);
      codes[k] = code;
    }
    for (const k of Object.keys(VENUES) as VenueKey[]) {
      const r = await db.execute({
        sql: "INSERT INTO venues (name, lat, lng, status) VALUES (?, ?, ?, 'approved') RETURNING id",
        args: [VENUES[k], 9.6, 106.3],
      });
      venueIds[k] = Number(r.rows[0].id);
    }

    async function event(
      key: keyof typeof ev,
      venue: VenueKey,
      startMs: number,
      opts: { status?: string; plusOnes?: boolean } = {},
    ) {
      const code = randomCode();
      const startAt = iso(startMs);
      const endAt = iso(startMs + 2 * HOUR);
      const r = await db.execute({
        sql: `INSERT INTO exchange_events
          (public_code, host_member_id, venue_id, title, start_at, end_at,
           slots_total, host_heads, fee_mode, fee_amount_male, deposit_amount,
           register_deadline, cancel_deadline, auto_approve, allow_plus_ones,
           status, lock_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 12, 1, 'fixed', 50000, 0, ?, ?, 0, ?,
                  ?, 0, ?, ?)
          RETURNING id`,
        args: [
          code,
          ids.host,
          venueIds[venue],
          `${PREFIX}${key}`,
          startAt,
          endAt,
          iso(startMs - 2 * HOUR),
          iso(startMs - 12 * HOUR),
          opts.plusOnes ? 1 : 0,
          opts.status ?? (startMs < now ? "done" : "open"),
          nowIso,
          nowIso,
        ],
      });
      ev[key] = { id: Number(r.rows[0].id), code, startAt, endAt };
    }
    // Buổi đã qua đủ lâu để mỗi người viết đánh giá có từ 3 lần điểm danh.
    await event("H1", "A", now - 40 * DAY);
    await event("H2", "B", now - 30 * DAY);
    await event("H3", "C", now - 20 * DAY);
    // Buổi đã đóng chấm: E2b chỉ có 2 người chấm, E2 có đủ 3.
    await event("E2b", "A", now - 9 * DAY - 2 * HOUR);
    await event("E2", "A", now - 8 * DAY - 2 * HOUR);
    // Buổi vừa kết thúc 2 giờ trước: cửa sổ chấm đang mở.
    await event("E1", "A", now - 4 * HOUR);
    await event("E3", "A", now - 4 * HOUR);
    // Buổi sắp tới: trang quản lý và đăng ký có người đi cùng.
    await event("E4", "A", now + 3 * DAY);
    await event("E5", "A", now + 4 * DAY, { plusOnes: true });
    // Hai lần vắng của người được giới thiệu trong 30 ngày đầu.
    await event("N1", "A", now - 10 * DAY);
    await event("N2", "A", now - 6 * DAY);

    async function reg(
      e: keyof typeof ev,
      user: UserKey,
      status = "approved",
      checkedIn = true,
    ) {
      await db.execute({
        sql: `INSERT INTO exchange_registrations
          (event_id, member_id, status, male_count, female_count, checked_in,
           checked_in_at, created_at, updated_at)
          VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?)`,
        args: [
          ev[e].id,
          ids[user],
          status,
          checkedIn ? 1 : 0,
          checkedIn ? ev[e].startAt : null,
          ev[e].startAt,
          ev[e].startAt,
        ],
      });
    }
    for (const h of ["H1", "H2", "H3"] as const)
      for (const u of ["p1", "p2", "p3", "p4", "r1", "r2", "r3"] as const)
        await reg(h, u);
    for (const u of ["p1", "p2", "p4"] as const) await reg("E2b", u);
    for (const u of ["p1", "p2", "p3", "p4"] as const) {
      await reg("E2", u);
      await reg("E1", u);
    }
    await reg("E3", "p2");
    await reg("E3", "p3");
    await reg("E4", "p1", "approved", false);
    await reg("E4", "p4", "approved", false);
    await reg("E4", "nb3", "pending", false);
    await reg("N1", "nb2", "no_show", false);
    await reg("N2", "nb2", "no_show", false);

    async function peer(
      e: keyof typeof ev,
      from: UserKey,
      to: UserKey,
      tags: string[],
      skill: string | null,
      playAgain: boolean,
    ) {
      const at = iso(Date.parse(ev[e].endAt) + HOUR);
      await db.execute({
        sql: `INSERT INTO peer_feedback
          (event_id, from_member_id, to_member_id, play_again, tags,
           skill_level, rater_weight, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 5, ?, ?)`,
        args: [
          ev[e].id,
          ids[from],
          ids[to],
          playAgain ? 1 : 0,
          JSON.stringify(tags),
          skill,
          at,
          at,
        ],
      });
    }
    async function hostAnswer(e: keyof typeof ev, from: UserKey) {
      const at = iso(Date.parse(ev[e].endAt) + HOUR);
      await db.execute({
        sql: `INSERT INTO host_feedback
          (event_id, from_member_id, as_described, fee_as_promised,
           rater_weight, created_at, updated_at)
          VALUES (?, ?, 1, 1, 5, ?, ?)`,
        args: [ev[e].id, ids[from], at, at],
      });
    }
    // Phần trăm host chỉ hiện từ HOST_PCT_MIN_RATERS (5) người chấm: thêm một
    // buổi cũ đã đóng có đủ 3 người chấm (r1..r3 đều được điểm danh ở H1), cộng
    // với p1..p3 ở E2 là 6 người, đều trả lời "có".
    for (const u of ["r1", "r2", "r3"] as const) await hostAnswer("H1", u);
    // Đủ 3 người chấm ở buổi đã đóng: được cộng vào hồ sơ của p4 và host.
    for (const u of ["p1", "p2", "p3"] as const) {
      await peer("E2", u, "p4", ["on_time", "friendly"], "tb", true);
      await hostAnswer("E2", u);
    }
    // Buổi đã đóng mà chỉ 2 người chấm, và buổi còn mở: không được cộng.
    for (const u of ["p1", "p2"] as const)
      await peer("E2b", u, "p4", ["nice_play"], "tbk", true);
    for (const u of ["p2", "p3"] as const)
      await peer("E1", u, "p4", ["fair_play"], "tbk", true);
    // p2 đã chấm buổi E3, p3 thì chưa.
    await hostAnswer("E3", "p2");

    // p2 giới thiệu nb2 12 ngày trước; nb2 vắng 2 lần sau đó.
    await db.execute({
      sql: `INSERT INTO referrals (referrer_member_id, referee_member_id, created_at)
            VALUES (?, ?, ?)`,
      args: [ids.p2, ids.nb2, iso(now - 12 * DAY)],
    });

    async function review(
      venue: VenueKey,
      user: UserKey,
      daysAgo: number,
      comment: string,
    ) {
      const at = iso(now - daysAgo * DAY);
      await db.execute({
        sql: `INSERT INTO venue_reviews
          (venue_id, member_id, score_surface, score_lighting,
           score_ventilation, score_price, score_parking, score_owner,
           comment, status, report_count, rater_weight, created_at, updated_at)
          VALUES (?, ?, 4, 4, 4, 4, 4, 4, ?, 'visible', 0, 5, ?, ?)`,
        args: [venueIds[venue], ids[user], comment, at, at],
      });
    }
    await review("A", "r1", 5, "Sân A mặt thảm ổn, đèn đủ sáng.");
    await review("A", "r2", 3, "Chủ sân A dễ chịu, giá hợp lý.");
    await review("C", "p3", 4, REPORTED_TEXT);
  });
}

test.beforeAll(async () => {
  await cleanup();
  // Về mặc định (hàng không tồn tại) thay vì tin giá trị đang có: lần chạy bị
  // ngắt giữa chừng có thể để cờ bật, và giữ nguyên là giữ luôn rò rỉ đó.
  await writeSetting("exchangeEnabled", null);
  await writeSetting("notificationsEnabled", null);
  await writeSetting("exchangeEnabled", "true");
  await writeSetting("notificationsEnabled", "true");
  notificationMark = await scalar(
    "SELECT COALESCE(MAX(id), 0) FROM notifications",
  );
  jobMark = await scalar("SELECT COALESCE(MAX(id), 0) FROM scheduled_jobs");
  await seedAll();
});

test.afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await writeSetting("exchangeEnabled", null);
    await writeSetting("notificationsEnabled", null);
  }
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
  // Mỗi lần đăng nhập mật khẩu ghi một dòng rate limit; giữ khoá của G2d.
  await withDb((db) =>
    db.execute(
      "DELETE FROM rate_limit_buckets WHERE key NOT LIKE 'exchange-%' AND key NOT LIKE 'venue-review:%'",
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

async function adminPage(browser: Browser): Promise<{
  ctx: BrowserContext;
  page: Page;
}> {
  const ctx = await browser.newContext({
    storageState: "e2e/.auth/admin.json",
    viewport: { width: 390, height: 844 },
  });
  return { ctx, page: await ctx.newPage() };
}

/**
 * Bấm tab lọc tới khi nó được chọn: trang admin tải xong HTML trước khi React
 * gắn sự kiện, nên cú bấm quá sớm bị nuốt mà không báo lỗi.
 */
async function selectTab(page: Page, name: string | RegExp) {
  const tab = page.getByRole("tab", { name, exact: true });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
}

/** Khối đánh giá của trang sân ("Gửi xe" cũng là một tiện ích sân ở trên). */
const reviewsSection = (page: Page): Locator =>
  page.locator('[data-section="venue-reviews"]');

async function openVenue(page: Page, venue: VenueKey) {
  await page.goto(`/venues/${venueIds[venue]}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(reviewsSection(page)).toBeVisible({ timeout: 20_000 });
}

async function openEvent(page: Page, e: keyof typeof ev, query = "") {
  await page.goto(`/exchanges/${ev[e].code}${query}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: `${PREFIX}${e}` }),
  ).toBeVisible({ timeout: 20_000 });
}

const CRITERIA = [
  "Mặt sân",
  "Ánh sáng",
  "Thoáng mát",
  "Giá",
  "Gửi xe",
  "Chủ sân",
];

/** Chấm đủ 6 tiêu chí, ghi nhận xét, chờ Turnstile rồi gửi. */
async function writeReview(page: Page, stars: number, comment: string) {
  await reviewsSection(page)
    .getByRole("button", { name: "Viết đánh giá" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Viết đánh giá sân" });
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  for (const c of CRITERIA) {
    await sheet
      .getByRole("radiogroup", { name: c, exact: true })
      .getByRole("radio", { name: `${stars} sao` })
      .click();
  }
  await sheet.getByPlaceholder(/Kể ngắn về sân/).fill(comment);
  const submit = sheet.getByRole("button", { name: "Gửi đánh giá" });
  await expect(submit).toBeEnabled({ timeout: 60_000 });
  await submit.click();
}

test("checked-in player rates co-players and the host after the event and sees their answers when reopening", async ({
  browser,
}) => {
  const ctx = await newCtx(browser);
  const page = await loginAs(ctx, "p1");
  await openEvent(page, "E1");
  const rate = page.getByRole("button", { name: "Đánh giá buổi này" });
  await expect(rate.first()).toBeVisible({ timeout: 20_000 });
  await rate.first().click();

  const sheet = page.getByRole("dialog", { name: "Đánh giá buổi này" });
  const described = () =>
    sheet.getByRole("radiogroup", { name: "Buổi đúng như mô tả?" });
  const fee = () =>
    sheet.getByRole("radiogroup", { name: "Phí đúng như đã báo?" });
  await expect(described()).toBeVisible({ timeout: 20_000 });
  await described().getByRole("radio", { name: "Có" }).click();
  await fee().getByRole("radio", { name: "Không" }).click();

  const p2 = () => sheet.getByRole("group", { name: USERS.p2.name });
  await p2().getByRole("switch", { name: "Muốn chơi lại cùng" }).click();
  await p2().getByRole("button", { name: "Đúng giờ" }).click();
  await p2().getByRole("button", { name: "TB", exact: true }).click();
  // Host không nằm trong danh sách người chơi cùng.
  await expect(sheet.getByRole("group", { name: USERS.host.name })).toHaveCount(
    0,
  );

  const submit = sheet.getByRole("button", { name: "Gửi đánh giá" });
  await expect(submit).toBeEnabled({ timeout: 60_000 });
  await submit.click();
  await expect
    .poll(
      () =>
        scalar(
          `SELECT COUNT(*) FROM host_feedback WHERE event_id = ? AND from_member_id = ?
           AND as_described = 1 AND fee_as_promised = 0`,
          [ev.E1.id, ids.p1],
        ),
      { timeout: 30_000 },
    )
    .toBe(1);
  // Chỉ người vừa được chấm mới có dòng; người không chạm vào thì không.
  expect(
    await scalar(
      `SELECT COUNT(*) FROM peer_feedback WHERE event_id = ? AND from_member_id = ?
       AND to_member_id = ? AND play_again = 1 AND skill_level = 'tb'
       AND tags LIKE '%on_time%'`,
      [ev.E1.id, ids.p1, ids.p2],
    ),
  ).toBe(1);
  expect(
    await scalar(
      "SELECT COUNT(*) FROM peer_feedback WHERE event_id = ? AND from_member_id = ?",
      [ev.E1.id, ids.p1],
    ),
  ).toBe(1);
  await expect(sheet).toHaveCount(0, { timeout: 20_000 });

  // Mở lại qua ?feedback=1: phiếu điền sẵn câu trả lời của chính mình.
  await openEvent(page, "E1", "?feedback=1");
  await expect(described()).toBeVisible({ timeout: 20_000 });
  await expect(described().getByRole("radio", { name: "Có" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(fee().getByRole("radio", { name: "Không" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    p2().getByRole("switch", { name: "Muốn chơi lại cùng" }),
  ).toBeChecked();
  await expect(p2().getByRole("button", { name: "Đúng giờ" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    p2().getByRole("button", { name: "TB", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const p3 = sheet.getByRole("group", { name: USERS.p3.name });
  await expect(
    p3.getByRole("switch", { name: "Muốn chơi lại cùng" }),
  ).not.toBeChecked();
  await ctx.close();
});

test("profile shows Mới for a new account, and kudos plus peer skill only from the closed event with three raters", async ({
  browser,
}) => {
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();

  await page.goto(`/players/${codes.nb3}`, { waitUntil: "domcontentloaded" });
  const main = page.locator("main");
  await expect(main.getByText(USERS.nb3.name).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(main.getByText("Mới", { exact: true })).toBeVisible();
  await expect(
    main.getByText("Chưa có buổi nào được điểm danh."),
  ).toBeVisible();

  await page.goto(`/players/${codes.p4}`, { waitUntil: "domcontentloaded" });
  await expect(main.getByText(USERS.p4.name).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(main.getByText("Mới", { exact: true })).toHaveCount(0);
  await expect(
    main.getByText("Tự khai: TBY · Người chơi cùng đánh giá: TB (3 lượt)"),
  ).toBeVisible();
  await expect(main.getByText("Muốn chơi lại cùng")).toBeVisible();
  await expect(main.getByText("Đúng giờ")).toBeVisible();
  await expect(main.getByText("Vui vẻ")).toBeVisible();
  await expect(main.getByText("Từ 3 người chơi cùng")).toBeVisible();
  // E2b chỉ có 2 người chấm, E1 còn trong 7 ngày chấm: không được cộng.
  await expect(main.getByText("Đánh đẹp")).toHaveCount(0);
  await expect(main.getByText("Fair play")).toHaveCount(0);
  await expect(main.getByText("TBK")).toHaveCount(0);
  // Không lộ người chấm, buổi nào hay ở đâu.
  const html = await page.content();
  for (const k of ["p1", "p2", "p3"] as const) {
    expect(html).not.toContain(USERS[k].name);
    expect(html).not.toContain(codes[k]);
  }
  expect(html).not.toContain(`${PREFIX}E2`);
  expect(html).not.toContain(VENUES.A);
  await ctx.close();
});

test("event page host line opens the host profile, which has no rater names", async ({
  browser,
}) => {
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await openEvent(page, "E4");
  const line = page
    .locator(`a[href="/players/${codes.host}"]`)
    .filter({ hasText: /Đã tổ chức \d+ buổi/ });
  await expect(line).toBeVisible({ timeout: 20_000 });
  // Chỉ buổi đã đóng chấm có đủ 3 người chấm được tính (E2 + H1 = 6 người).
  await expect(line).toContainText("Đúng mô tả 100%");
  await expect(line).toContainText("Đúng phí 100%");
  await line.click();
  await expect(page).toHaveURL(new RegExp(`/players/${codes.host}$`), {
    timeout: 20_000,
  });
  const main = page.locator("main");
  await expect(main.getByText(USERS.host.name).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(main.getByText("Khi làm host")).toBeVisible();
  const html = await page.content();
  for (const k of ["p1", "p2", "p3", "p4"] as const) {
    expect(html).not.toContain(USERS[k].name);
    expect(html).not.toContain(codes[k]);
  }
  await ctx.close();
});

test("eligible player reviews the venue; under 3 reviews the venue shows Chưa đủ đánh giá, with 3 it shows a score", async ({
  browser,
}) => {
  const ctx = await newCtx(browser);
  const page = await loginAs(ctx, "p1");
  await openVenue(page, "A");
  const section = reviewsSection(page);
  await expect(section.getByText("Chưa đủ đánh giá")).toBeVisible();
  await expect(section.getByText("2 đánh giá")).toBeVisible();
  await expect(section.getByText("Đã chơi ở đây")).toHaveCount(2);

  const text = "Sân thoáng, đèn sáng, chủ sân vui vẻ.";
  await writeReview(page, 5, text);
  await expect
    .poll(
      () =>
        scalar(
          "SELECT COUNT(*) FROM venue_reviews WHERE venue_id = ? AND member_id = ? AND status = 'visible'",
          [venueIds.A, ids.p1],
        ),
      { timeout: 30_000 },
    )
    .toBe(1);

  await openVenue(page, "A");
  await expect(section.getByText("Chưa đủ đánh giá")).toHaveCount(0);
  await expect(section.getByText("3 đánh giá")).toBeVisible();
  await expect(
    section.getByRole("img", {
      name: new RegExp(`^Điểm [\\d,.]+ trên 5 cho ${VENUES.A}$`),
    }),
  ).toBeVisible();
  await expect(section.getByText(text)).toBeVisible();
  await ctx.close();
});

test("a review with a phone is held, a guest does not see it, the admin approves it in the reputation tab", async ({
  browser,
}) => {
  const ctx = await newCtx(browser);
  const page = await loginAs(ctx, "p2");
  await openVenue(page, "B");
  const text = "Muốn đặt sân thì gọi chủ sân số 0912 345 678 nhé.";
  await writeReview(page, 4, text);
  await expect(
    page.getByText("Đánh giá của bạn đang chờ duyệt").first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      () =>
        scalar(
          `SELECT COUNT(*) FROM venue_reviews WHERE venue_id = ? AND member_id = ?
           AND status = 'held' AND hold_reason = 'contact'`,
          [venueIds.B, ids.p2],
        ),
      { timeout: 30_000 },
    )
    .toBe(1);
  await ctx.close();

  const guestCtx = await newCtx(browser);
  const guest = await guestCtx.newPage();
  await openVenue(guest, "B");
  await expect(reviewsSection(guest).getByText(text)).toHaveCount(0);
  await expect(
    reviewsSection(guest).getByText("Chưa có đánh giá nào."),
  ).toBeVisible();

  const admin = await adminPage(browser);
  await admin.page.goto("/admin/exchanges?tab=reputation", {
    waitUntil: "domcontentloaded",
  });
  await selectTab(admin.page, "Chờ duyệt");
  await expect(admin.page.getByText(text)).toBeVisible({ timeout: 20_000 });
  await admin.page
    .locator("div")
    .filter({ hasText: text })
    .filter({
      has: admin.page.getByRole("button", { name: "Duyệt", exact: true }),
    })
    .last()
    .getByRole("button", { name: "Duyệt", exact: true })
    .click();
  await expect(admin.page.getByText("Đã duyệt đánh giá")).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(
      () =>
        scalar(
          "SELECT COUNT(*) FROM venue_reviews WHERE venue_id = ? AND member_id = ? AND status = 'visible'",
          [venueIds.B, ids.p2],
        ),
      { timeout: 20_000 },
    )
    .toBe(1);
  await admin.ctx.close();

  await openVenue(guest, "B");
  await expect(reviewsSection(guest).getByText(text)).toBeVisible({
    timeout: 20_000,
  });
  await guestCtx.close();
});

test("three established members report a review and it disappears; the admin unhides it", async ({
  browser,
}) => {
  // Ba lần đăng nhập, mỗi lần một Turnstile: bài này chậm hơn các bài khác.
  test.setTimeout(240_000);
  const reviewId = await scalar(
    "SELECT id FROM venue_reviews WHERE venue_id = ? AND member_id = ?",
    [venueIds.C, ids.p3],
  );
  for (const key of ["r1", "r2", "r3"] as const) {
    const ctx = await newCtx(browser);
    const page = await loginAs(ctx, key);
    await openVenue(page, "C");
    const item = reviewsSection(page)
      .locator("article")
      .filter({ hasText: REPORTED_TEXT });
    await expect(item).toBeVisible({ timeout: 20_000 });
    await item.getByRole("button", { name: "Báo cáo" }).click();
    const submit = page.getByRole("button", { name: "Gửi báo cáo" });
    await expect(submit).toBeEnabled({ timeout: 40_000 });
    await submit.click();
    await expect(page.getByText("Đã gửi báo cáo. Cảm ơn bạn.")).toBeVisible({
      timeout: 20_000,
    });
    await ctx.close();
  }
  await expect
    .poll(
      () =>
        scalar(
          "SELECT COUNT(*) FROM venue_reviews WHERE id = ? AND status = 'hidden'",
          [reviewId],
        ),
      { timeout: 20_000 },
    )
    .toBe(1);

  const guestCtx = await newCtx(browser);
  const guest = await guestCtx.newPage();
  await openVenue(guest, "C");
  await expect(reviewsSection(guest).getByText(REPORTED_TEXT)).toHaveCount(0);

  const admin = await adminPage(browser);
  await admin.page.goto("/admin/exchanges?tab=reputation", {
    waitUntil: "domcontentloaded",
  });
  await selectTab(admin.page, "Đang ẩn");
  await expect(admin.page.getByText(REPORTED_TEXT)).toBeVisible({
    timeout: 20_000,
  });
  await admin.page
    .locator("div")
    .filter({ hasText: REPORTED_TEXT })
    .filter({
      has: admin.page.getByRole("button", { name: "Bỏ ẩn", exact: true }),
    })
    .last()
    .getByRole("button", { name: "Bỏ ẩn", exact: true })
    .click();
  await expect(admin.page.getByText("Đã bỏ ẩn đánh giá")).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(
      () =>
        scalar(
          "SELECT COUNT(*) FROM venue_reviews WHERE id = ? AND status = 'visible'",
          [reviewId],
        ),
      { timeout: 20_000 },
    )
    .toBe(1);
  await admin.ctx.close();

  await openVenue(guest, "C");
  await expect(reviewsSection(guest).getByText(REPORTED_TEXT)).toBeVisible({
    timeout: 20_000,
  });
  await guestCtx.close();
});

test("a member without a check-in at the venue sees why they cannot review", async ({
  browser,
}) => {
  const ctx = await newCtx(browser);
  const page = await loginAs(ctx, "noci");
  await openVenue(page, "A");
  await reviewsSection(page)
    .getByRole("button", { name: "Viết đánh giá" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Viết đánh giá sân" });
  await expect(
    sheet.getByText(
      "Bạn cần được điểm danh ở một buổi tại sân này để đánh giá.",
    ),
  ).toBeVisible({ timeout: 20_000 });
  await expect(sheet.getByRole("button", { name: "Gửi đánh giá" })).toHaveCount(
    0,
  );
  await expect(sheet.getByRole("radiogroup")).toHaveCount(0);
  await ctx.close();
});

test("the host sees attendance numbers and a profile link for each registrant on the manage page", async ({
  browser,
}) => {
  const ctx = await newCtx(browser);
  const page = await loginAs(ctx, "host");
  await page.goto(`/exchanges/${ev.E4.code}/manage`, {
    waitUntil: "domcontentloaded",
  });
  const rowOf = (k: UserKey) =>
    page
      .locator("li, article, div")
      .filter({ hasText: USERS[k].name })
      .filter({
        has: page.getByRole("link", { name: `Hồ sơ của ${USERS[k].name}` }),
      })
      .last();
  // Nick mới (tab Chờ duyệt mở sẵn) chỉ có chip "Mới", không có dòng số liệu.
  const nb3 = rowOf("nb3");
  await expect(nb3).toBeVisible({ timeout: 20_000 });
  await expect(nb3.getByText("Mới", { exact: true })).toBeVisible();
  await expect(nb3).not.toContainText("Đến ");
  await expect(
    page.getByRole("link", { name: `Hồ sơ của ${USERS.nb3.name}` }),
  ).toHaveAttribute("href", `/players/${codes.nb3}`);

  await selectTab(page, /^Tham gia/);
  for (const k of ["p1", "p4"] as const) {
    const link = page.getByRole("link", { name: `Hồ sơ của ${USERS[k].name}` });
    await expect(link).toBeVisible({ timeout: 20_000 });
    await expect(link).toHaveAttribute("href", `/players/${codes[k]}`);
    // H1, H2, H3, E2b, E2, E1: 6 lần đến trên 6 đăng ký đã duyệt đã qua.
    await expect(rowOf(k)).toContainText("Đến 6/6 buổi");
  }
  await ctx.close();
});

test("an eligible member refers a new account from its profile; the new account can then register with a companion", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const companions = (page: Page) =>
    page.getByRole("dialog").getByText("Người đi cùng");

  // Trước khi được giới thiệu: nick mới không dắt thêm người được.
  const nbCtx = await newCtx(browser);
  const nb = await loginAs(nbCtx, "nb1");
  await openEvent(nb, "E5");
  await nb.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await expect(
    nb.getByRole("button", { name: /Gửi đăng ký|Đang kiểm tra/ }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(companions(nb)).toHaveCount(0);

  const ctx = await newCtx(browser);
  const page = await loginAs(ctx, "p1");
  await page.goto(`/players/${codes.nb1}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Giới thiệu người này" }).click();
  const confirm = page.getByRole("button", { name: "Xác nhận giới thiệu" });
  await expect(confirm).toBeEnabled({ timeout: 60_000 });
  await confirm.click();
  await expect(
    page.locator("main").getByText("Được giới thiệu").first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        scalar(
          "SELECT COUNT(*) FROM referrals WHERE referrer_member_id = ? AND referee_member_id = ?",
          [ids.p1, ids.nb1],
        ),
      { timeout: 20_000 },
    )
    .toBe(1);
  await ctx.close();

  // Sau khi được giới thiệu: đăng ký kèm 1 người đi cùng.
  await openEvent(nb, "E5");
  await nb.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await expect(companions(nb)).toBeVisible({ timeout: 20_000 });
  await nb
    .getByRole("dialog")
    .getByRole("button", { name: "Tăng 1" })
    .first()
    .click();
  const send = nb.getByRole("button", { name: "Gửi đăng ký" });
  await expect(send).toBeEnabled({ timeout: 60_000 });
  await send.click();
  await expect
    .poll(
      () =>
        scalar(
          `SELECT COUNT(*) FROM exchange_registrations WHERE event_id = ? AND member_id = ?
           AND male_count + female_count = 2`,
          [ev.E5.id, ids.nb1],
        ),
      { timeout: 30_000 },
    )
    .toBe(1);
  await nbCtx.close();
});

test("a referral broken by two no-shows blocks the referrer, who no longer sees the refer button and sees the reopen date", async ({
  browser,
}) => {
  // Lần vắng thứ 2 (giờ bắt đầu N2) + 30 ngày.
  const date = vnDate(Date.parse(ev.N2.startAt) + 30 * DAY);
  const blocked = `Bạn tạm không giới thiệu được tới ${date}`;

  const ctx = await newCtx(browser);
  const page = await loginAs(ctx, "p2");
  await page.goto(`/players/${codes.nb3}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main").getByText(blocked)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole("button", { name: "Giới thiệu người này" }),
  ).toHaveCount(0);

  await page.goto("/exchanges/mine", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(blocked)).toBeVisible({ timeout: 20_000 });
  await ctx.close();
});

test("the daily cron sends the rating reminder once; the bell item opens the rating sheet", async ({
  browser,
  request,
}) => {
  const secret = process.env.CRON_SECRET;
  expect(secret, "CRON_SECRET must be set (source test-env.sh)").toBeTruthy();
  const jobKey = `xrate:${ev.E3.id}:${createHash("sha256")
    .update(ev.E3.endAt)
    .digest("hex")
    .slice(0, 8)}`;
  const now = iso(Date.now());
  await withDb((db) =>
    db.execute({
      sql: `INSERT INTO scheduled_jobs (job_key, kind, run_at, status, payload, created_at, updated_at)
            VALUES (?, 'exchange_rate_reminder', ?, 'scheduled', '{}', ?, ?)`,
      args: [jobKey, iso(Date.parse(ev.E3.endAt) + 3_600_000), now, now],
    }),
  );

  const count = (k: UserKey) =>
    scalar(
      `SELECT COUNT(*) FROM notifications WHERE kind = 'exchange_rate_reminder'
       AND recipient_type = 'member' AND recipient_id = ? AND entity_id = ?`,
      [ids[k], ev.E3.id],
    );
  for (let i = 0; i < 2; i++) {
    const res = await request.get("/api/cron/notifications-daily", {
      headers: { Authorization: `Bearer ${secret}` },
      timeout: 60_000,
    });
    expect(res.status()).toBe(200);
  }
  expect(await count("p3")).toBe(1);
  expect(await count("p2")).toBe(0);
  expect(
    await scalar(
      "SELECT COUNT(*) FROM scheduled_jobs WHERE job_key = ? AND status = 'done'",
      [jobKey],
    ),
  ).toBe(1);

  const ctx = await newCtx(browser);
  const page = await loginAs(ctx, "p3");
  await openEvent(page, "E3");
  const bell = page.getByRole("button", { name: /^Thông báo, \d+ chưa đọc/ });
  await expect(bell.first()).toBeVisible({ timeout: 20_000 });
  await bell.first().click();
  await page.getByText("Chấm buổi giao lưu vừa chơi").first().click();
  await expect(page).toHaveURL(
    new RegExp(`/exchanges/${ev.E3.code}\\?feedback=1`),
    { timeout: 20_000 },
  );
  await expect(
    page
      .getByRole("dialog", { name: "Đánh giá buổi này" })
      .getByRole("radiogroup", { name: "Buổi đúng như mô tả?" }),
  ).toBeVisible({ timeout: 20_000 });
  await ctx.close();
});

test("with the flag off the profile is 404 and the venue page shows the coming soon block", async ({
  browser,
}) => {
  const ctx = await newCtx(browser);
  try {
    await writeSetting("exchangeEnabled", "false");
    const page = await ctx.newPage();
    const res = await page.goto(`/players/${codes.p4}`, {
      waitUntil: "domcontentloaded",
    });
    expect(res?.status()).toBe(404);
    await openVenue(page, "A");
    await expect(
      reviewsSection(page).getByText("Đánh giá sân: sắp có"),
    ).toBeVisible();
    await expect(reviewsSection(page).getByText("Đã chơi ở đây")).toHaveCount(
      0,
    );
  } finally {
    await ctx.close();
    await writeSetting("exchangeEnabled", "true");
  }
});
