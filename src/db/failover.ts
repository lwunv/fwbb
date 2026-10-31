import type {
  Client,
  InStatement,
  ResultSet,
  Transaction,
  TransactionMode,
} from "@libsql/client";
import { isConnectionResetError } from "@/lib/db-fetch";

/**
 * Tự chuyển sang database dự phòng khi database chính không dùng được nữa.
 *
 * Vì sao có: 24/10/2026 tài khoản Turso bị khoá, mọi trang trả 500 suốt nhiều
 * giờ. Sao lưu cứu được DỮ LIỆU nhưng không cứu được việc site đang chết. Lớp
 * này là để lần sau site tự đứng dậy mà không cần ai thức.
 *
 * ━━━ HAI THỨ PHẢI ĐÚNG, QUAN TRỌNG HƠN TÍNH NĂNG ━━━
 *
 * 1. KHÔNG khai bản dự phòng thì KHÔNG đổi gì cả. `standby` là null thì mọi
 *    lệnh đi thẳng xuống client chính, không thêm một lần gọi mạng nào. Đây là
 *    thứ cho phép mang lên prod trước khi dựng xong bản dự phòng.
 *
 * 2. KHÔNG BAO GIỜ tự quay về bản chính. Khi đã chuyển, dữ liệu mới nằm ở bản
 *    dự phòng còn bản chính thì cũ. Tự quay về là âm thầm vứt phần ghi trong
 *    lúc sự cố. Muốn về phải có người đồng bộ ngược rồi bật cờ bằng tay
 *    (`scripts/failover.mjs`).
 *
 * Cờ trạng thái cất ở CHÍNH bản dự phòng, không phải bản chính: lúc cần đọc cờ
 * là lúc bản chính đang chết. Mọi instance đọc chung một cờ nên chúng chuyển
 * cùng nhau, thay vì mỗi instance tự quyết rồi nửa này ghi một nơi, nửa kia ghi
 * nơi khác.
 */

export type DbRole = "primary" | "standby";

/** Mã lỗi của libsql thuộc tầng SQL, tức database vẫn sống và vẫn trả lời. */
const SQL_LEVEL_CODES = new Set([
  "SQL_INPUT_ERROR",
  "ARGS_INVALID",
  "ARGS_UNEXPECTED",
  "TRANSACTION_CLOSED",
  "CLIENT_CLOSED",
  "RESPONSE_TOO_LARGE",
]);

/** Mã lỗi hệ thống nghĩa là không tới được máy chủ. */
const UNREACHABLE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/**
 * Lỗi này có nghĩa "bản chính hỏng, chuyển đi" hay chỉ là "câu lệnh sai"?
 *
 * Phân biệt sai theo hướng nào cũng tệ, nhưng tệ khác nhau: coi lỗi ràng buộc
 * là hỏng thì ta chuyển cả site sang bản dự phòng chỉ vì một câu INSERT trùng
 * khoá. Nên mặc định là KHÔNG chuyển, chỉ chuyển khi nhận ra đúng dấu hiệu máy
 * chủ không phục vụ nữa.
 */
export function isPrimaryUnavailable(err: unknown): boolean {
  if (isConnectionResetError(err)) return true;

  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      // Lỗi tầng SQL: database vẫn sống. Dừng hẳn, đừng đi xuống `cause` nữa.
      if (SQL_LEVEL_CODES.has(code) || code.startsWith("SQLITE_")) return false;
      if (UNREACHABLE_CODES.has(code)) return true;
    }
    const msg = current.message ?? "";
    // 24/10/2026 Turso khoá tài khoản thì trả 403 kèm chữ "blocked". 5xx là
    // phía họ hỏng. Hai cái này đều là lý do chính đáng để chuyển.
    if (/\b(403|401|429|50[0-4])\b/.test(msg)) return true;
    if (/blocked|quota|usage limit|unauthorized|forbidden/i.test(msg)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

const STATE_TABLE = "replica_state";

async function readRole(standby: Client): Promise<DbRole | null> {
  try {
    const r = await standby.execute(
      `SELECT active FROM ${STATE_TABLE} WHERE id = 1`,
    );
    const v = r.rows[0]?.active;
    return v === "standby" || v === "primary" ? v : null;
  } catch {
    // Bảng chưa có, hoặc chính bản dự phòng cũng không với tới được. Cả hai
    // đều không phải lý do để ngã sang bản dự phòng, nên coi như chưa chuyển.
    return null;
  }
}

/**
 * Tạo client tự chuyển. Hình dạng giống hệt client libsql nên
 * `drizzle(client)` và toàn bộ code gọi DB không cần biết lớp này tồn tại.
 */
export function createFailoverClient(opts: {
  primary: Client;
  /** null = chưa dựng bản dự phòng; mọi thứ chạy như chưa từng có lớp này. */
  standby: Client | null;
  /** Bao lâu mới đọc lại cờ trạng thái một lần. */
  cacheMs?: number;
  now?: () => number;
  /** Gọi khi vừa chuyển, để ghi log. Không được ném lỗi. */
  onSwitch?: (role: DbRole, err: unknown) => void;
}): Client {
  const { primary, standby, onSwitch } = opts;
  const cacheMs = opts.cacheMs ?? 30_000;
  const now = opts.now ?? Date.now;

  if (!standby) return primary;

  let active: DbRole = "primary";
  let checkedAt = Number.NEGATIVE_INFINITY;

  async function currentClient(): Promise<Client> {
    if (active === "primary" && now() - checkedAt >= cacheMs) {
      checkedAt = now();
      const flag = await readRole(standby!);
      // Chỉ nhận tín hiệu CHUYỂN ĐI từ cờ. Cờ nói "primary" không kéo được
      // instance đang ở standby quay về, vì quay về phải do người quyết.
      if (flag === "standby") active = "standby";
    }
    return active === "primary" ? primary : standby!;
  }

  async function promote(err: unknown): Promise<void> {
    active = "standby";
    checkedAt = now();
    try {
      await standby!.batch(
        [
          `CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
             id INTEGER PRIMARY KEY CHECK (id = 1),
             active TEXT NOT NULL,
             since TEXT NOT NULL,
             reason TEXT
           )`,
          {
            sql: `INSERT INTO ${STATE_TABLE} (id, active, since, reason)
                  VALUES (1, 'standby', ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                    active = 'standby', since = excluded.since,
                    reason = excluded.reason`,
            args: [
              new Date(now()).toISOString(),
              // Chỉ lấy mã lỗi và câu đầu. Thông báo lỗi của DB có thể kèm
              // mảnh câu truy vấn, mà câu truy vấn thì có dữ liệu cá nhân.
              String((err as { code?: unknown })?.code ?? "UNKNOWN"),
            ],
          },
        ],
        "write",
      );
    } catch {
      // Ghi cờ hỏng thì instance này vẫn chuyển (biến `active` đã đổi). Mất
      // cờ chỉ làm các instance khác chuyển chậm hơn, không làm hỏng dữ liệu.
    }
    try {
      onSwitch?.("standby", err);
    } catch {
      // Hàm log của người gọi không được phép làm chết đường chạy DB.
    }
  }

  async function run<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = await currentClient();
    if (c !== primary) return fn(c);
    try {
      return await fn(primary);
    } catch (err) {
      if (!isPrimaryUnavailable(err)) throw err;
      await promote(err);
      return fn(standby!);
    }
  }

  return {
    get closed() {
      return primary.closed;
    },
    get protocol() {
      return primary.protocol;
    },
    execute: ((...args: unknown[]) =>
      run((c) =>
        (c.execute as (...a: unknown[]) => Promise<ResultSet>)(...args),
      )) as Client["execute"],
    batch: ((stmts: InStatement[], mode?: TransactionMode) =>
      run((c) => c.batch(stmts, mode))) as Client["batch"],
    transaction: ((mode?: TransactionMode) =>
      run((c) =>
        c.transaction(mode as TransactionMode),
      )) as Client["transaction"],
    executeMultiple: (sql: string) => run((c) => c.executeMultiple(sql)),
    migrate: (stmts: InStatement[]) => run((c) => c.migrate(stmts)),
    sync: () => run((c) => c.sync()),
    close: () => {
      primary.close();
      standby.close();
    },
  } as Client;
}

export type { Transaction };
