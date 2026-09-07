import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// libSQL/SQLite defaults foreign_keys=OFF per connection — without this every
// `.references(...)` in schema.ts is a decoration the DB never enforces. Run
// before any drizzle wrapper touches the connection.
await client.execute("PRAGMA foreign_keys=ON");

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
