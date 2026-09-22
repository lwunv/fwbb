import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import { saveSettings } from "./utils";

/**
 * Công tắc "Tính tiền theo giới tính" phải lưu được qua nút Lưu.
 *
 * Từ 22/9/2026 trang Cài đặt gom mọi thay đổi vào một bản nháp, server chỉ
 * nhận khi bấm Lưu. Công tắc này quyết định ba nhóm nữ có hiệu lực hay không,
 * tức là quyết định tiền, nên nó phải đi trọn vòng: gạt → Lưu → reload → vẫn
 * đúng trạng thái đó, và giá trị trong DB cũng đúng.
 */

async function db() {
  const c = createClient({ url: "file:e2e/local.db" });
  await c.execute("PRAGMA busy_timeout = 5000");
  return c;
}

async function readSetting(): Promise<string | null> {
  const c = await db();
  try {
    const r = await c.execute(
      "SELECT value FROM app_settings WHERE key='genderPricingEnabled'",
    );
    return r.rows[0] ? String(r.rows[0].value) : null;
  } finally {
    c.close();
  }
}

test.afterAll(async () => {
  const c = await db();
  await c.execute("DELETE FROM app_settings WHERE key='genderPricingEnabled'");
  c.close();
});

test("gạt công tắc giới tính rồi bấm Lưu: giá trị xuống DB và sống qua reload", async ({
  page,
}) => {
  const c = await db();
  await c.execute({
    sql: "INSERT INTO app_settings (key, value) VALUES ('genderPricingEnabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [JSON.stringify(false)],
  });
  c.close();

  await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
  const sw = page.getByRole("switch", { name: "Tính tiền theo giới tính" });
  await expect(sw).toBeVisible({ timeout: 20_000 });
  await expect(sw).toHaveAttribute("aria-checked", "false");

  // Gạt BẬT nhưng CHƯA lưu: DB phải giữ nguyên giá trị cũ.
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  expect(await readSetting()).toBe("false");

  await saveSettings(page);
  expect(await readSetting()).toBe("true");

  // Sống qua reload, và ba nhóm nữ mọc ra theo.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("switch", { name: "Tính tiền theo giới tính" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("button", { name: "Cách tính: Thành viên nữ", exact: true }),
  ).toBeVisible();

  // Gạt TẮT lại cũng phải lưu được — chiều ngược lại hay bị bỏ quên.
  const sw2 = page.getByRole("switch", { name: "Tính tiền theo giới tính" });
  await sw2.click();
  await saveSettings(page);
  expect(await readSetting()).toBe("false");
});
