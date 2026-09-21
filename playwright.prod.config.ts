import { defineConfig, devices } from "@playwright/test";
import { PROD_STORAGE_STATE } from "./e2e/prod-storage-path";
import { config as loadEnv } from "dotenv";

// Đọc ADMIN_USERNAME / ADMIN_PASSWORD (không hardcode trong repo).
loadEnv({ path: ".env.local" });

const PROD_URL = process.env.PROD_URL ?? "https://lwcifer.io.vn";

/**
 * Cấu hình RIÊNG để kiểm PROD, tách hẳn khỏi `playwright.config.ts`.
 *
 * ⚠️ Bộ e2e thường TUYỆT ĐỐI KHÔNG được chạy với cấu hình này. 14 spec trong
 * `e2e/` ghi thẳng vào DB (riêng `money-flow.spec.ts` có 25 lệnh ghi và chốt sổ
 * thật), nên chạy chúng lên prod là tạo nợ giả, trừ quỹ của người thật, đổi mật
 * khẩu member thật. Vì vậy `testMatch` ở đây khoá cứng vào ĐÚNG MỘT file
 * `prod-readonly.spec.ts`, và file đó chỉ được phép điều hướng + đọc.
 *
 * Cũng KHÔNG có `webServer`: cấu hình này không dựng server local nào, nó trỏ
 * thẳng vào site đã deploy.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // Prod đi qua Internet nên chậm và nhiễu hơn local; cho phép thử lại 1 lần
  // để một cú mạng chập không bị đọc nhầm thành lỗi sản phẩm.
  retries: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: PROD_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  // Hai project: đăng nhập MỘT LẦN rồi mọi bài dùng lại phiên đó. Bản đầu để
  // mỗi bài tự đăng nhập và bị chính rate-limit của app chặn từ bài thứ hai.
  projects: [
    {
      name: "setup",
      testMatch: "prod-auth.setup.ts",
    },
    {
      name: "prod",
      testMatch: "prod-readonly.spec.ts",
      dependencies: ["setup"],
      use: { storageState: PROD_STORAGE_STATE },
    },
  ],
});
