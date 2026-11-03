/**
 * Cấu hình drizzle-kit trỏ vào database DỰ PHÒNG, không phải bản chính.
 *
 * Vì sao có file riêng thay vì sửa `drizzle.config.ts`: file kia nạp
 * `.env.local`, mà `.env.local` của máy này trỏ thẳng vào DB PROD. Chạy
 * `drizzle-kit migrate` với cấu hình đó là đụng vào prod. File này KHÔNG nạp
 * `.env.local`, chỉ đọc biến truyền vào lúc chạy, nên không có đường nào tự
 * tìm về prod.
 *
 * Chạy:
 *   STANDBY_DATABASE_URL=libsql://... STANDBY_AUTH_TOKEN=... \
 *     pnpm drizzle-kit migrate --config=drizzle.standby.config.ts
 */

import { defineConfig } from "drizzle-kit";

const url = process.env.STANDBY_DATABASE_URL;
const authToken = process.env.STANDBY_AUTH_TOKEN;

if (!url) {
  throw new Error(
    "Thiếu STANDBY_DATABASE_URL. File này CHỈ dùng cho bản dự phòng; " +
      "muốn chạy migration cho bản chính thì dùng drizzle.config.ts.",
  );
}

// Chốt chặn: dự phòng mà trùng bản chính thì dừng. Gõ nhầm một biến ở đây là
// chạy migration vào prod, nên thà chết ngay còn hơn chạy im lặng.
if (process.env.TURSO_DATABASE_URL && url === process.env.TURSO_DATABASE_URL) {
  throw new Error(
    "STANDBY_DATABASE_URL đang trùng TURSO_DATABASE_URL (bản chính). Dừng.",
  );
}

// Database ở xa mà không token thì ai cũng ghi được. Cùng luật với
// `validateStandbyConfig` trong src/db/failover.ts.
if (!url.startsWith("file:") && !authToken) {
  throw new Error("Thiếu STANDBY_AUTH_TOKEN cho database ở xa.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "turso",
  dbCredentials: { url, authToken },
});
