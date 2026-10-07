import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import { createRetryingFetch } from "../lib/db-fetch";

const client = createClient({
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
  await client.execute("PRAGMA foreign_keys=ON");
}

// E2E chạy trên DB dạng file (file:e2e/local.db) mà server này và fixture
// Playwright mở CÙNG lúc, nên ghi đồng thời sinh SQLITE_BUSY và làm đỏ một bài
// ngẫu nhiên mỗi lượt. Chờ lock nhả thay vì chết ngay. Chỉ áp cho URL file:
// nên Turso trên prod không đổi hành vi.
if (process.env.TURSO_DATABASE_URL?.startsWith("file:")) {
  await client.execute("PRAGMA busy_timeout = 5000");
  // journal_mode mặc định (delete) cho writer khoá TOÀN BỘ file, chặn cả
  // reader, nên busy_timeout một mình không đủ khi server và fixture cùng
  // cần ghi. WAL cho nhiều reader chạy song song với một writer. Đây là
  // thuộc tính lưu trong file nên chỉ cần đặt một lần, nhưng đặt ở đây để
  // một bản local.db mới clone về cũng tự được bật.
  await client.execute("PRAGMA journal_mode = WAL");
}

export const db = drizzle(client, { schema });
