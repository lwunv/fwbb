import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";

/**
 * Panel "Mặc định khi tạo buổi" ngay trên Dashboard (yêu cầu 01/11/2026).
 *
 * Bài này tồn tại để chứng minh đúng một điều mà bài unit không với tới: cái
 * nút Lưu trên màn hình thật sự ghi xuống DB, và trước khi bấm nó thì DB không
 * đổi. Unit test chỉ thấy tới hàm `updateSetting` đã bị mock.
 *
 * Nó ĐỌC THẲNG app_settings thay vì nhìn lại màn hình, vì ô trên màn hình giữ
 * giá trị nháp của chính nó, xanh cả khi server từ chối.
 */

function db() {
  return createClient({ url: "file:e2e/local.db" });
}

async function storedMaxPlayers(): Promise<string | null> {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  try {
    const r = await c.execute(
      "SELECT value FROM app_settings WHERE key = 'defaultMaxPlayers'",
    );
    const v = r.rows[0]?.value;
    return v === undefined || v === null ? null : String(v);
  } finally {
    c.close();
  }
}

async function restore(previous: string | null) {
  const c = db();
  await c.execute("PRAGMA busy_timeout = 5000");
  try {
    if (previous === null) {
      await c.execute(
        "DELETE FROM app_settings WHERE key = 'defaultMaxPlayers'",
      );
    } else {
      await c.execute({
        sql: "INSERT INTO app_settings (key, value) VALUES ('defaultMaxPlayers', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        args: [previous],
      });
    }
  } finally {
    c.close();
  }
}

test("sĩ số mặc định: sửa trên Dashboard chỉ xuống DB khi bấm Lưu", async ({
  page,
}) => {
  const before = await storedMaxPlayers();

  try {
    await page.goto("/admin/dashboard", { waitUntil: "domcontentloaded" });

    // `.last()`: trang dashboard stream từng mảnh, nên lúc chưa stream xong
    // trong DOM còn một bản khung ẨN của cùng khối. Bản thật luôn là bản sau.
    const panel = page.locator('[data-slot="session-defaults-panel"]').last();
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Mặc định khi tạo buổi")).toBeVisible();

    // Năm thứ user yêu cầu phải có mặt trong panel.
    for (const label of [
      "Ngày tự tạo buổi trong tuần",
      "Giờ bắt đầu",
      "Giờ kết thúc",
      "Sân mặc định",
      "Hãng cầu mặc định",
      "Số người tối đa",
    ]) {
      await expect(panel.getByText(label)).toBeVisible();
    }

    const save = panel.getByRole("button", { name: "Lưu", exact: true });
    await expect(save).toBeDisabled();

    // Giá trị cố ý lạ, không trùng mặc định 16 lẫn các mức trong maxPlayersOptions.
    await panel.getByRole("spinbutton").fill("23");
    await expect(panel.getByText("1 thay đổi chưa lưu")).toBeVisible();

    // Chưa bấm Lưu: DB phải y nguyên.
    expect(await storedMaxPlayers()).toBe(before);

    await save.click();
    await expect(panel.getByText("Chưa có thay đổi")).toBeVisible();

    await expect
      .poll(async () => await storedMaxPlayers(), { timeout: 10_000 })
      .toBe("23");
  } finally {
    await restore(before);
  }
});
