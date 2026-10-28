import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

/**
 * Danh sách đã vote ở trang chủ: MỌI dòng cao bằng nhau, và cụm badge nằm
 * bên phải chứ không nằm dưới tên (yêu cầu 28/10/2026).
 *
 * Trước đó badge nằm thành hàng thứ ba dưới tên, nên chiều cao mỗi dòng phụ
 * thuộc người đó có biệt danh không và vote mấy thứ. Danh sách nhấp nhô và
 * dài gấp rưỡi cần thiết.
 *
 * Bài này dựng đúng ba hình dạng khác nhau trong cùng một buổi rồi ĐO, chứ
 * không đọc class: class còn nguyên mà bố cục vẫn vỡ được (ví dụ badge quá
 * rộng đẩy xuống hàng thứ ba).
 */

/** Ba ngày chơi của tuần đích, giống badmintonDatesForTargetWeek([1,3,5]). */
function targetDates(): string[] {
  const vn = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const base = new Date(`${vn(new Date())}T12:00:00+07:00`);
  const dow = base.getUTCDay();
  const fromMon = (d: number) => (d === 0 ? 6 : d - 1);
  const shift = dow === 6 || dow === 0 ? 7 : 0;
  const monOff = -fromMon(dow) + shift;
  return [1, 3, 5].map((d) =>
    vn(new Date(base.getTime() + (monOff + fromMon(d)) * 86_400_000)),
  );
}

/** Thứ Sáu của tuần đích: ngày duy nhất luôn là hôm nay hoặc tương lai dù
 *  chạy vào thứ mấy, nên chip thứ ba luôn tồn tại. */
const DATE = targetDates()[2];
const CHIP_INDEX = 2;

function db() {
  return createClient({ url: "file:e2e/local.db" });
}

/** Ba member với ba hình dạng khác nhau: đây mới là thứ bài này kiểm. */
let shapes: { id: number; name: string }[] = [];
const savedNicknames = new Map<number, string | null>();

test.beforeAll(async () => {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");

  const rows = (
    await c.execute(
      "SELECT id, name, nickname FROM members WHERE is_active=1 AND approval_status='approved' ORDER BY id LIMIT 3",
    )
  ).rows;
  shapes = rows.map((r) => ({ id: Number(r.id), name: String(r.name) }));
  for (const r of rows) {
    savedNicknames.set(
      Number(r.id),
      r.nickname == null ? null : String(r.nickname),
    );
  }

  // Người thứ nhất KHÔNG biệt danh (một dòng chữ), hai người sau CÓ (hai
  // dòng). Nếu chiều cao còn ăn theo số dòng chữ thì ba dòng này lệch nhau.
  await c.execute("UPDATE members SET nickname=NULL WHERE id=?", [
    shapes[0].id,
  ]);
  await c.execute("UPDATE members SET nickname='Biệt danh dài' WHERE id=?", [
    shapes[1].id,
  ]);
  await c.execute("UPDATE members SET nickname='Tí' WHERE id=?", [
    shapes[2].id,
  ]);

  const court = (await c.execute("SELECT id FROM courts LIMIT 1")).rows[0];
  await c.execute("DELETE FROM sessions WHERE date=?", [DATE]);
  const dl = new Date(Date.now() + 6 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const deadline = `${dl.getFullYear()}-${p(dl.getMonth() + 1)}-${p(dl.getDate())}T${p(dl.getHours())}:${p(dl.getMinutes())}:${p(dl.getSeconds())}`;
  const ins = await c.execute({
    sql: `INSERT INTO sessions (date, start_time, end_time, court_id, court_quantity, court_price, status, vote_deadline)
          VALUES (?, '20:30', '22:30', ?, 1, 200000, 'voting', ?)`,
    args: [DATE, court?.id ?? null, deadline],
  });
  const sessionId = Number(ins.lastInsertRowid);

  // Ba hình dạng: ít badge nhất, nhiều badge nhất, và một ca ở giữa.
  const votes: [number, number, number, number][] = [
    [shapes[0].id, 1, 0, 0], // chỉ cầu lông
    [shapes[1].id, 1, 1, 1], // cầu + nhậu + đi 2 người (ba badge)
    [shapes[2].id, 0, 1, 0], // chỉ nhậu
  ];
  for (const [memberId, play, dine, partner] of votes) {
    await c.execute({
      sql: `INSERT INTO votes (session_id, member_id, will_play, will_dine, with_partner)
            VALUES (?, ?, ?, ?, ?)`,
      args: [sessionId, memberId, play, dine, partner],
    });
  }
  c.close();
});

test.afterAll(async () => {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  await c.execute("DELETE FROM sessions WHERE date=?", [DATE]);
  for (const [id, nickname] of savedNicknames) {
    await c.execute("UPDATE members SET nickname=? WHERE id=?", [nickname, id]);
  }
  c.close();
});

test("ba dòng vote ba hình dạng khác nhau vẫn cao bằng nhau, badge nằm bên phải", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const chips = page.getByRole("button", { name: /Thứ/ });
  await expect(chips).toHaveCount(3, { timeout: 20_000 });
  await chips.nth(CHIP_INDEX).click();

  const rows = page.locator("[data-slot='vote-row']");
  await expect(rows).toHaveCount(3, { timeout: 20_000 });
  // Hoạt ảnh trượt vào của framer-motion làm phép đo sai nếu đo quá sớm.
  await page.waitForTimeout(500);

  const heights: number[] = [];
  for (let i = 0; i < 3; i++) {
    const box = await rows.nth(i).boundingBox();
    if (!box) throw new Error(`khong do duoc dong vote thu ${i}`);
    heights.push(Math.round(box.height));
  }

  expect(
    new Set(heights).size,
    `chiều cao ba dòng: ${heights.join("px, ")}px`,
  ).toBe(1);

  // Và phải THẤP hơn bản cũ. Bản cũ xếp badge thành hàng thứ ba nên dòng cao
  // khoảng 100px; con số 84 ở đây là trần để lần sau ai đó nhét thêm một hàng
  // chữ vào là bài đỏ ngay.
  expect(heights[0], `dòng vote cao ${heights[0]}px`).toBeLessThanOrEqual(84);

  // Cụm badge phải nằm BÊN PHẢI tên, không phải bên dưới: mép trái của cụm
  // badge phải nằm sau mép phải của khối tên.
  const rowWithThreeBadges = rows.nth(1);
  const badges = rowWithThreeBadges.locator("[data-slot='vote-row-badges']");
  const badgeBox = await badges.boundingBox();
  const rowBox = await rowWithThreeBadges.boundingBox();
  if (!badgeBox || !rowBox) throw new Error("khong do duoc cum badge");
  expect(
    badgeBox.x,
    "cụm badge phải nằm ở nửa bên phải của dòng",
  ).toBeGreaterThan(rowBox.x + rowBox.width / 2);
  // Ba badge phải gãy thành HAI hàng, không kéo thành một hàng dài.
  const items = badges.locator(":scope > *");
  expect(await items.count(), "dòng này phải có đủ ba badge").toBe(3);

  // Badge CUỐI (nằm một mình ở hàng dưới) phải canh sát lề phải, chứ không
  // thụt về bên trái dưới badge đầu. Đo chính badge đó, không đo cả cụm: cả
  // cụm thì bỏ `justify-end` đi vẫn xanh, vì khung cụm do flex cha đẩy sang
  // phải rồi.
  const lastBox = await items.last().boundingBox();
  if (!lastBox) throw new Error("khong do duoc badge cuoi");
  expect(
    Math.round(rowBox.x + rowBox.width - (lastBox.x + lastBox.width)),
    "badge cuối phải canh sát lề phải",
  ).toBeLessThanOrEqual(16);
  expect(
    Math.round(badgeBox.height),
    `cụm ba badge cao ${Math.round(badgeBox.height)}px, phải là hai hàng`,
  ).toBeGreaterThan(30);
});
