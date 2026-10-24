import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import { createRetryingFetch } from "../lib/db-fetch";

const rawClient = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
  // Thay fetch mặc định (node-fetch@2) để không chết vì socket keep-alive đã bị
  // Turso đóng. Lý do chi tiết ở src/lib/db-fetch.ts. URL file: bỏ qua option này.
  fetch: createRetryingFetch(),
});

// Chỉ chạy PRAGMA cho DB dạng file. Với Turso từ xa, KHÔNG được có lệnh mạng
// nào ở cấp module: kết nối đứt đúng lúc nạp module (ECONNRESET) làm module
// hỏng, Next giữ module hỏng đó cho mọi request sau và instance trả 500 tới khi
// bị thay (tái hiện 07/10/2026, test ở index.test.ts). Turso vốn đã bật
// foreign_keys=1 cho mọi kết nối mới (đã kiểm trên prod cùng ngày), còn qua HTTP
// mỗi request lại là một kết nối riêng nên PRAGMA ở đây cũng không giữ được.
if (process.env.TURSO_DATABASE_URL?.startsWith("file:")) {
  // SQLite file mặc định foreign_keys=OFF theo từng kết nối. Thiếu dòng này thì
  // mọi `.references(...)` trong schema.ts chỉ là trang trí, DB không kiểm.
  await rawClient.execute("PRAGMA foreign_keys=ON");
}

// E2E chạy trên DB dạng file (file:e2e/local.db) mà server này và fixture
// Playwright mở CÙNG lúc, nên ghi đồng thời sinh SQLITE_BUSY và làm đỏ một bài
// ngẫu nhiên mỗi lượt. Chờ lock nhả thay vì chết ngay. Chỉ áp cho URL file:
// nên Turso trên prod không đổi hành vi.
if (process.env.TURSO_DATABASE_URL?.startsWith("file:")) {
  await rawClient.execute("PRAGMA busy_timeout = 5000");
  // journal_mode mặc định (delete) cho writer khoá TOÀN BỘ file, chặn cả
  // reader, nên busy_timeout một mình không đủ khi server và fixture cùng
  // cần ghi. WAL cho nhiều reader chạy song song với một writer. Đây là
  // thuộc tính lưu trong file nên chỉ cần đặt một lần, nhưng đặt ở đây để
  // một bản local.db mới clone về cũng tự được bật.
  await rawClient.execute("PRAGMA journal_mode = WAL");
}

/**
 * Bộ đếm số DÒNG mỗi câu truy vấn đọc ra, chỉ bật khi có biến môi trường
 * `DB_QUERY_LOG`. Mặc định trả về đúng client gốc nên đường chạy thật không
 * thêm một lớp nào.
 *
 * Giữ lại vì nó là thứ đã tìm ra nguyên nhân sự cố 24/10/2026: Turso tính theo
 * SỐ DÒNG ĐỌC, mà không có cách nào biết một trang ngốn bao nhiêu dòng nếu chỉ
 * nhìn code. Cách dùng: chạy server trỏ vào DB file rồi mở trang cần đo
 *
 *   TURSO_DATABASE_URL=file:e2e/local.db DB_QUERY_LOG=1 pnpm start
 *
 * rồi cộng cột đầu của các dòng `[SQLROWS]` trong log.
 */
function withQueryLog(c: typeof rawClient): typeof rawClient {
  if (!process.env.DB_QUERY_LOG) return c;

  const countRows = (res: unknown): number => {
    if (Array.isArray(res)) {
      return res.reduce<number>((n, r) => n + countRows(r), 0);
    }
    const rows = (res as { rows?: unknown[] } | null)?.rows;
    return Array.isArray(rows) ? rows.length : 0;
  };

  return new Proxy(c, {
    get(target, prop, receiver) {
      if (prop !== "execute" && prop !== "batch") {
        return Reflect.get(target, prop, receiver);
      }
      const orig = Reflect.get(target, prop, receiver) as (
        ...a: never[]
      ) => Promise<unknown>;
      return async (...args: never[]) => {
        const res = await orig.apply(target, args);
        const sql =
          typeof args[0] === "string" ? args[0] : JSON.stringify(args[0]);
        console.log(
          `[SQLROWS] ${countRows(res)} :: ${String(sql).replace(/\s+/g, " ").slice(0, 150)}`,
        );
        return res;
      };
    },
  });
}

export const db = drizzle(withQueryLog(rawClient), { schema });
