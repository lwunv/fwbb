import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

/**
 * Admin đổi giờ chơi của một buổi đã tạo (yêu cầu 01/11/2026).
 *
 * Trước đó giờ chơi chỉ đặt được lúc TẠO buổi, tạo nhầm thì phải xoá buổi rồi
 * tạo lại, kéo theo hoàn quỹ và mất sạch lượt vote.
 *
 * Bài đi hết đường thật (bấm trên màn hình) rồi ĐỌC THẲNG DB, chứ không chỉ
 * nhìn con số trên thẻ: thẻ đổi ngay lúc bấm theo lối optimistic, nên nhìn thẻ
 * thì xanh cả khi server từ chối.
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

const DATE = targetDates()[2];
/** Giờ cố ý LẠ, để cái nút giờ trên trang là duy nhất, không trùng buổi khác. */
const SEED_START = "06:15";
const SEED_END = "07:45";

function db() {
  return createClient({ url: "file:e2e/local.db" });
}

async function storedTime(): Promise<string> {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  try {
    const r = await c.execute({
      sql: "SELECT start_time, end_time FROM sessions WHERE date = ?",
      args: [DATE],
    });
    const row = r.rows[0];
    return `${row?.start_time}-${row?.end_time}`;
  } finally {
    c.close();
  }
}

async function seed(status: string) {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  const court = (await c.execute("SELECT id FROM courts LIMIT 1")).rows[0];
  await c.execute("DELETE FROM sessions WHERE date = ?", [DATE]);
  await c.execute({
    sql: `INSERT INTO sessions (date, start_time, end_time, court_id, court_quantity, court_price, status)
          VALUES (?, ?, ?, ?, 1, 200000, ?)`,
    args: [DATE, SEED_START, SEED_END, court?.id ?? null, status],
  });
  c.close();
}

test.afterAll(async () => {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  await c.execute("DELETE FROM sessions WHERE date = ?", [DATE]);
  c.close();
});

test("admin đổi giờ chơi của buổi đang vote, giờ mới xuống tới DB", async ({
  page,
}) => {
  await seed("voting");
  // Lọc đúng ngày đã seed. Mở trống `/admin/sessions` thì buổi này có thể
  // nằm ở trang sau, hoặc rơi ngoài bộ lọc mặc định khi các bài khác đã tạo
  // thêm buổi: chạy riêng thì xanh, chạy cả bộ thì "không thấy nút" (dính
  // 01/11/2026). Cùng cách `money-flow.spec.ts` làm.
  await page.goto(`/admin/sessions?from=${DATE}&to=${DATE}`, {
    waitUntil: "domcontentloaded",
  });

  const trigger = page.getByRole("button", { name: "Đổi giờ chơi" }).first();
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await expect(trigger).toHaveText(new RegExp(SEED_START));
  await trigger.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Mỗi ô giờ là hai dropdown tự viết: ô giờ rồi ô phút.
  await dialog.getByRole("button", { name: "06h" }).click();
  await page.getByRole("button", { name: "19h", exact: true }).click();
  await dialog.getByRole("button", { name: "45", exact: true }).click();
  await page.getByRole("button", { name: "00", exact: true }).click();

  await dialog.getByRole("button", { name: "Lưu giờ" }).click();

  // Thứ duy nhất chứng minh nó lưu thật.
  await expect.poll(storedTime, { timeout: 15_000 }).toBe("19:15-07:00");
});

test("buổi đã chốt sổ: không có nút đổi giờ", async ({ page }) => {
  await seed("completed");
  await page.goto(`/admin/sessions?status=all&from=${DATE}&to=${DATE}`, {
    waitUntil: "domcontentloaded",
  });

  // Phải soi ĐÚNG thẻ của buổi này. Trang còn buổi khác đang vote, và chúng
  // có nút đổi giờ thật, nên đếm nút trên cả trang thì bài luôn đỏ dù code
  // đúng (dính đúng kiểu này lần chạy đầu).
  const card = page
    .locator("[data-slot='card']")
    .filter({ hasText: `${SEED_START} – ${SEED_END}` })
    .first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  // Giờ vẫn hiện ra, nhưng là chữ thường chứ không phải nút bấm được.
  await expect(card.getByRole("button", { name: "Đổi giờ chơi" })).toHaveCount(
    0,
  );
  expect(await storedTime()).toBe(`${SEED_START}-${SEED_END}`);
});
