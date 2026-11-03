import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

/**
 * E2E cho tài khoản giao lưu (G2a) sau cờ `exchangeEnabled`.
 *
 * Cờ nằm ở bảng app_settings của e2e/local.db (server `next start` trỏ vào
 * cùng file). Mỗi nhóm test tự đặt cờ, afterAll khôi phục đúng giá trị cũ
 * (kể cả "không có dòng nào").
 *
 * Không phủ vòng đăng nhập Zalo thật: callback gọi Zalo từ phía server nên
 * page.route không giả được; route test tích hợp đã phủ phần đó.
 */

test.use({ storageState: { cookies: [], origins: [] } });

// Chặn SDK OAuth ngoài để trang đăng nhập deterministic (giống reset-password).
// Turnstile (khoá test của Cloudflare) vẫn được tải: bài kiểm widget cần nó.
test.beforeEach(async ({ page }) => {
  await page.route(
    /connect\.facebook\.net|accounts\.google\.com|apis\.google\.com|gsi\//,
    (r) => r.abort(),
  );
});

const PASSWORD = "ExchangeE2e#1";
const NAMES = {
  exchange: "E2E Giao Luu Mot",
  group: "E2E Xin Vao Nhom",
  approved: "E2E Thanh Vien Duyet",
};
const USERNAMES = {
  exchange: "e2eexch1",
  group: "e2eexch2",
  approved: "e2eexch3",
};

const ids: Record<keyof typeof NAMES, number> = {
  exchange: 0,
  group: 0,
  approved: 0,
};
let previousFlag: string | null | undefined;

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

async function setFlag(on: boolean) {
  await withDb((db) =>
    db.execute({
      sql: `INSERT INTO app_settings (key, value) VALUES ('exchangeEnabled', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [JSON.stringify(on)],
    }),
  );
}

async function memberRow(id: number) {
  return withDb(async (db) => {
    const r = await db.execute({
      sql: "SELECT approval_status, signup_intent FROM members WHERE id = ?",
      args: [id],
    });
    return r.rows[0];
  });
}

async function insertMember(
  key: keyof typeof NAMES,
  status: "pending" | "approved",
  intent: "group" | "exchange",
) {
  await withDb(async (db) => {
    await db.execute({
      sql: "DELETE FROM members WHERE username = ?",
      args: [USERNAMES[key]],
    });
    const r = await db.execute({
      sql: `INSERT INTO members
        (name, username, password_hash, approval_status, signup_intent,
         is_active, default_with_partner)
        VALUES (?, ?, ?, ?, ?, 1, 0) RETURNING id`,
      args: [
        NAMES[key],
        USERNAMES[key],
        bcrypt.hashSync(PASSWORD, 12),
        status,
        intent,
      ],
    });
    ids[key] = Number(r.rows[0].id);
  });
}

test.beforeAll(async () => {
  await withDb(async (db) => {
    // Mỗi lần đăng nhập mật khẩu ghi một dòng rate limit; xoá để nhiều bài
    // trong suite không chạm ngưỡng.
    await db.execute("DELETE FROM rate_limit_buckets").catch(() => {});
    const r = await db.execute(
      "SELECT value FROM app_settings WHERE key = 'exchangeEnabled'",
    );
    previousFlag = r.rows[0] ? String(r.rows[0].value) : null;
  });
});

test.afterAll(async () => {
  await withDb(async (db) => {
    for (const id of Object.values(ids)) {
      if (!id) continue;
      await db.execute({
        sql: "DELETE FROM members WHERE id = ?",
        args: [id],
      });
    }
    if (previousFlag === null || previousFlag === undefined) {
      await db.execute(
        "DELETE FROM app_settings WHERE key = 'exchangeEnabled'",
      );
    } else {
      await db.execute({
        sql: "UPDATE app_settings SET value = ? WHERE key = 'exchangeEnabled'",
        args: [previousFlag],
      });
    }
  });
});

async function loginWithPassword(page: Page, username: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Username / SĐT / Email").fill(username);
  await page.getByPlaceholder("Mật khẩu (≥ 8 ký tự)").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByPlaceholder("Username / SĐT / Email")).toHaveCount(0, {
    timeout: 20_000,
  });
}

const noHorizontalScroll = async (page: Page) => {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

test.describe.configure({ mode: "serial" });

test.describe("cờ tắt", () => {
  test.beforeAll(async () => {
    await setFlag(false);
    await insertMember("exchange", "pending", "exchange");
  });

  test("/giao-luu và /giao-luu/dang-nhap trả 404; POST zalo/start trả 404", async ({
    request,
  }) => {
    for (const path of ["/giao-luu", "/giao-luu/dang-nhap"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
    }
    const start = await request.post("/api/auth/zalo/start", {
      form: { "cf-turnstile-response": "x", next: "/" },
      maxRedirects: 0,
    });
    expect(start.status()).toBe(404);
  });

  test("member pending vẫn thấy màn chờ duyệt ở / và /san mở được", async ({
    page,
  }) => {
    await loginWithPassword(page, USERNAMES.exchange);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Đang chờ admin duyệt" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("Tài khoản này dùng để đi giao lưu"),
    ).toHaveCount(0);

    const res = await page.goto("/san");
    expect(res?.status()).toBe(200);
  });
});

test.describe("cờ bật, khách", () => {
  test.beforeAll(async () => {
    await setFlag(true);
  });

  test("/giao-luu có nút đăng nhập, không cuộn ngang", async ({ page }) => {
    const res = await page.goto("/giao-luu");
    expect(res?.status()).toBe(200);
    const cta = page.getByRole("link", { name: "Đăng nhập để giao lưu" });
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await expect(cta).toHaveAttribute(
      "href",
      "/giao-luu/dang-nhap?next=%2Fgiao-luu",
    );
    await noHorizontalScroll(page);
  });

  test("nút Đăng nhập ở header /san trỏ /giao-luu/dang-nhap?next=/san", async ({
    page,
  }) => {
    await page.goto("/san");
    const login = page.getByRole("link", { name: "Đăng nhập" }).first();
    await expect(login).toBeVisible({ timeout: 15_000 });
    const href = await login.getAttribute("href");
    expect(href).toContain("/giao-luu/dang-nhap");
    expect(decodeURIComponent(href ?? "")).toContain("next=/san");
  });

  test("/giao-luu/dang-nhap có widget Turnstile và nút Zalo mở sau khi có token", async ({
    page,
  }) => {
    const res = await page.goto("/giao-luu/dang-nhap");
    expect(res?.status()).toBe(200);
    const zalo = page.getByRole("button", { name: "Đăng nhập bằng Zalo" });
    await expect(zalo).toBeVisible({ timeout: 15_000 });
    // Script Cloudflare đã tải và vẽ widget (iframe do Cloudflare tự đặt,
    // src của nó có thể đổi nên không so theo URL).
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              typeof (window as unknown as { turnstile?: { render?: unknown } })
                .turnstile?.render,
          ),
        {
          timeout: 20_000,
        },
      )
      .toBe("function");
    // Khoá test của Cloudflare tự qua: token về thì nút mở.
    await expect(zalo).toBeEnabled({ timeout: 30_000 });
    await expect(
      page.locator(
        'form[action="/api/auth/zalo/start"] input[name="cf-turnstile-response"]',
      ),
    ).not.toHaveValue("");
    await noHorizontalScroll(page);
  });
});

test.describe("cờ bật, tài khoản giao lưu", () => {
  test.beforeAll(async () => {
    await setFlag(true);
    await insertMember("exchange", "pending", "exchange");
  });

  test("/giao-luu có thẻ tài khoản, /san xem được, trang nhóm thấy màn tài khoản giao lưu", async ({
    page,
  }) => {
    await loginWithPassword(page, USERNAMES.exchange);

    await page.goto("/giao-luu");
    await expect(
      page.getByRole("heading", { name: `Chào ${NAMES.exchange}` }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "Xin vào nhóm" }),
    ).toBeVisible();

    const san = await page.goto("/san");
    expect(san?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Đang chờ admin duyệt" }),
    ).toHaveCount(0);

    for (const path of ["/", "/history", "/my-fund"]) {
      await page.goto(path);
      await expect(
        page.getByText("Tài khoản này dùng để đi giao lưu"),
        path,
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole("heading", { name: "Đang chờ admin duyệt" }),
        path,
      ).toHaveCount(0);
    }
  });
});

test.describe("cờ bật, xin vào nhóm", () => {
  test.beforeAll(async () => {
    await setFlag(true);
    await insertMember("group", "pending", "exchange");
  });

  test("bấm Xin vào nhóm, admin thấy trong hàng chờ, bấm Không nhận thì quay về tài khoản giao lưu", async ({
    page,
    browser,
  }) => {
    await loginWithPassword(page, USERNAMES.group);
    await page.goto("/giao-luu");
    await page.getByRole("button", { name: "Xin vào nhóm" }).click();
    await expect(page.getByText("Đã gửi, chờ admin duyệt")).toBeVisible();
    await expect
      .poll(async () => (await memberRow(ids.group)).signup_intent, {
        timeout: 15_000,
      })
      .toBe("group");

    // Reload: vẫn mở được và thẻ vẫn ở trạng thái đã gửi.
    const reload = await page.reload();
    expect(reload?.status()).toBe(200);
    await expect(page.getByText("Đã gửi, chờ admin duyệt")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: "Xin vào nhóm" }),
    ).toHaveCount(0);

    for (const path of ["/", "/history"]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: "Đang chờ admin duyệt" }),
        path,
      ).toBeVisible({ timeout: 15_000 });
    }

    // Admin: người này nằm trong hàng chờ duyệt, bấm "Không nhận vào nhóm".
    const adminCtx = await browser.newContext({
      storageState: "e2e/.auth/admin.json",
    });
    try {
      const admin = await adminCtx.newPage();
      await admin.goto("/admin/members");
      const row = admin
        .locator("div.rounded-xl.border")
        .filter({ hasText: NAMES.group })
        .filter({
          has: admin.getByRole("button", { name: "Không nhận vào nhóm" }),
        });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await row.getByRole("button", { name: "Không nhận vào nhóm" }).click();
      await expect
        .poll(async () => (await memberRow(ids.group)).signup_intent, {
          timeout: 15_000,
        })
        .toBe("exchange");
    } finally {
      await adminCtx.close();
    }

    expect((await memberRow(ids.group)).approval_status).toBe("pending");
    await page.goto("/giao-luu");
    await expect(
      page.getByRole("button", { name: "Xin vào nhóm" }),
    ).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("cờ bật, member đã duyệt", () => {
  test.beforeAll(async () => {
    await setFlag(true);
    await insertMember("approved", "approved", "group");
  });

  test("/, /history, /san như cũ và menu đủ mục", async ({ page }) => {
    await loginWithPassword(page, USERNAMES.approved);

    for (const path of ["/", "/history", "/san"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(
        page.getByText("Tài khoản này dùng để đi giao lưu"),
        path,
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Đang chờ admin duyệt" }),
        path,
      ).toHaveCount(0);
    }

    // Màn rộng không có thanh dưới, menu nằm ở ngăn kéo bên trái.
    await page.goto("/");
    await page.getByRole("button", { name: "Mở menu" }).click();
    const drawer = page.locator("nav").filter({
      has: page.locator('a[href="/history"]'),
    });
    for (const href of ["/", "/history", "/my-fund", "/stats", "/san", "/me"]) {
      await expect(
        drawer.locator(`a[href="${href}"]`).first(),
        href,
      ).toBeVisible({
        timeout: 15_000,
      });
    }
  });
});
