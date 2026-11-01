/**
 * Lớp tự chuyển sang database dự phòng.
 *
 * Thứ đáng khoá lại không phải "có chuyển được không", mà là KHI NÀO KHÔNG
 * ĐƯỢC CHUYỂN. Chuyển nhầm vì một lỗi ràng buộc nghĩa là từ đó mọi người ghi
 * vào một database khác, còn bản chính vẫn sống và vẫn nhận ghi từ chỗ khác.
 * Hai nơi cùng được ghi là kiểu hỏng không có cách sửa tự động.
 */
import { describe, it, expect, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import {
  createFailoverClient,
  isPrimaryUnavailable,
  validateStandbyConfig,
} from "./failover";

/** Lỗi giả của libsql: mang `code` giống thật. */
function libsqlError(message: string, code?: string) {
  const e = new Error(message) as Error & { code?: string };
  if (code) e.code = code;
  return e;
}

/** Client chính giả, đếm số lần bị gọi và ném lỗi theo kịch bản. */
function fakePrimary(opts: { failWith?: Error } = {}) {
  const calls = { execute: 0, batch: 0, transaction: 0 };
  const client = {
    closed: false,
    protocol: "http",
    async execute() {
      calls.execute++;
      if (opts.failWith) throw opts.failWith;
      return { rows: [{ from: "primary" }] };
    },
    async batch() {
      calls.batch++;
      if (opts.failWith) throw opts.failWith;
      return [];
    },
    async transaction() {
      calls.transaction++;
      if (opts.failWith) throw opts.failWith;
      return { from: "primary" };
    },
    async executeMultiple() {},
    async migrate() {
      return [];
    },
    async sync() {
      return { frame_no: 0, frames_synced: 0 };
    },
    close() {},
  } as unknown as Client;
  return { client, calls };
}

function memoryStandby(): Client {
  return createClient({ url: ":memory:" });
}

describe("nhận diện bản chính hỏng", () => {
  it("kết nối đứt, DNS chết, bị từ chối: đều là hỏng", () => {
    expect(isPrimaryUnavailable(libsqlError("socket hang up"))).toBe(true);
    expect(isPrimaryUnavailable(libsqlError("x", "ECONNRESET"))).toBe(true);
    expect(isPrimaryUnavailable(libsqlError("x", "ENOTFOUND"))).toBe(true);
    expect(isPrimaryUnavailable(libsqlError("x", "ECONNREFUSED"))).toBe(true);
  });

  it("tài khoản bị khoá (đúng ca 24/10/2026): là hỏng", () => {
    expect(
      isPrimaryUnavailable(
        libsqlError("Server returned HTTP status 403: account blocked"),
      ),
    ).toBe(true);
    expect(isPrimaryUnavailable(libsqlError("exceeded your usage quota"))).toBe(
      true,
    );
  });

  it("máy chủ họ lỗi 5xx: là hỏng", () => {
    expect(
      isPrimaryUnavailable(libsqlError("Server returned HTTP status 500")),
    ).toBe(true);
  });

  /** Ca quan trọng nhất của cả file. */
  it("lỗi tầng SQL: KHÔNG phải hỏng, tuyệt đối không được chuyển", () => {
    expect(
      isPrimaryUnavailable(
        libsqlError("UNIQUE constraint failed", "SQLITE_CONSTRAINT"),
      ),
    ).toBe(false);
    expect(isPrimaryUnavailable(libsqlError("x", "SQLITE_BUSY"))).toBe(false);
    expect(isPrimaryUnavailable(libsqlError("x", "SQL_INPUT_ERROR"))).toBe(
      false,
    );
    expect(isPrimaryUnavailable(libsqlError("cú pháp sai ở đâu đó"))).toBe(
      false,
    );
  });

  /**
   * Đây là lý do tồn tại của chốt "thấy mã SQL thì dừng hẳn".
   *
   * Thông báo lỗi ràng buộc có kèm tên cột. Cột nào mang chữ như `quota`,
   * `blocked`, `forbidden` là thông báo đó trúng bộ lọc từ khoá bên dưới, và
   * một câu INSERT trùng khoá sẽ kéo cả site sang database dự phòng. Mã lỗi
   * phải được xét TRƯỚC và phải cắt đứt việc xét tiếp.
   */
  it("lỗi ràng buộc trên cột có chữ 'quota': vẫn KHÔNG được chuyển", () => {
    expect(
      isPrimaryUnavailable(
        libsqlError(
          "UNIQUE constraint failed: settings.quota_key",
          "SQLITE_CONSTRAINT",
        ),
      ),
    ).toBe(false);
  });

  it("mã SQL nằm trong `cause` cũng phải nhận ra, không đào tiếp", () => {
    const inner = libsqlError("UNIQUE constraint failed", "SQLITE_CONSTRAINT");
    const outer = new Error("ghi thất bại", { cause: inner });
    expect(isPrimaryUnavailable(outer)).toBe(false);
  });
});

describe("chưa dựng bản dự phòng", () => {
  it("trả về đúng client chính, không bọc thêm lớp nào", () => {
    const { client } = fakePrimary();
    const fo = createFailoverClient({ primary: client, standby: null });
    expect(fo).toBe(client);
  });
});

describe("khi bản chính hỏng", () => {
  it("chuyển sang bản dự phòng và trả kết quả của nó", async () => {
    const { client: primary, calls } = fakePrimary({
      failWith: libsqlError("HTTP status 403 blocked"),
    });
    const standby = memoryStandby();
    await standby.execute("CREATE TABLE t (v TEXT)");
    await standby.execute("INSERT INTO t VALUES ('standby')");

    const onSwitch = vi.fn();
    const fo = createFailoverClient({ primary, standby, onSwitch });

    const r = await fo.execute("SELECT v FROM t");
    expect(r.rows[0]?.v).toBe("standby");
    expect(calls.execute).toBe(1);
    expect(onSwitch).toHaveBeenCalledWith("standby", expect.any(Error));
  });

  it("ghi cờ xuống bản dự phòng để các instance khác cùng chuyển", async () => {
    const { client: primary } = fakePrimary({
      failWith: libsqlError("x", "ECONNREFUSED"),
    });
    const standby = memoryStandby();
    await standby.execute("CREATE TABLE t (v TEXT)");

    const fo = createFailoverClient({ primary, standby });
    await fo.execute("SELECT v FROM t");

    const flag = await standby.execute("SELECT * FROM replica_state");
    expect(flag.rows[0]?.active).toBe("standby");
    expect(flag.rows[0]?.since).toBeTruthy();
    // Lý do chỉ lưu MÃ lỗi, không lưu thông báo: thông báo có thể kèm mảnh
    // câu truy vấn, mà câu truy vấn thì chứa dữ liệu cá nhân.
    expect(flag.rows[0]?.reason).toBe("ECONNREFUSED");
  });

  it("đã chuyển rồi thì không gọi bản chính nữa", async () => {
    const { client: primary, calls } = fakePrimary({
      failWith: libsqlError("x", "ECONNRESET"),
    });
    const standby = memoryStandby();
    await standby.execute("CREATE TABLE t (v TEXT)");

    const fo = createFailoverClient({ primary, standby });
    await fo.execute("SELECT 1 FROM t");
    await fo.execute("SELECT 1 FROM t");
    await fo.execute("SELECT 1 FROM t");

    expect(calls.execute).toBe(1);
  });

  it("lỗi ràng buộc thì ném lên như cũ, KHÔNG đụng tới bản dự phòng", async () => {
    const { client: primary } = fakePrimary({
      failWith: libsqlError("UNIQUE constraint failed", "SQLITE_CONSTRAINT"),
    });
    const standby = memoryStandby();
    const fo = createFailoverClient({ primary, standby });

    await expect(fo.execute("INSERT INTO t VALUES (1)")).rejects.toThrow(
      /UNIQUE/,
    );
    // Không có cờ nào được ghi, tức là chưa hề chuyển.
    await expect(
      standby.execute("SELECT * FROM replica_state"),
    ).rejects.toThrow();
  });
});

describe("cờ trạng thái dùng chung", () => {
  it("instance mới đọc cờ thấy đã chuyển thì đi theo, không cần tự vấp lỗi", async () => {
    const standby = memoryStandby();
    await standby.execute(
      `CREATE TABLE replica_state (id INTEGER PRIMARY KEY, active TEXT, since TEXT, reason TEXT)`,
    );
    await standby.execute(
      `INSERT INTO replica_state VALUES (1, 'standby', '2026-10-30T00:00:00Z', 'ECONNRESET')`,
    );
    await standby.execute("CREATE TABLE t (v TEXT)");
    await standby.execute("INSERT INTO t VALUES ('standby')");

    const { client: primary, calls } = fakePrimary();
    const fo = createFailoverClient({ primary, standby });

    const r = await fo.execute("SELECT v FROM t");
    expect(r.rows[0]?.v).toBe("standby");
    expect(calls.execute, "không được chạm vào bản chính").toBe(0);
  });

  it("đang ở bản dự phòng thì cờ 'primary' KHÔNG kéo được về", async () => {
    const { client: primary, calls } = fakePrimary({
      failWith: libsqlError("x", "ECONNRESET"),
    });
    const standby = memoryStandby();
    await standby.execute("CREATE TABLE t (v TEXT)");

    let clock = 0;
    const fo = createFailoverClient({
      primary,
      standby,
      cacheMs: 10,
      now: () => clock,
    });
    await fo.execute("SELECT 1 FROM t");
    expect(calls.execute).toBe(1);

    // Ai đó sửa cờ về 'primary' mà chưa đồng bộ ngược dữ liệu.
    await standby.execute("UPDATE replica_state SET active = 'primary'");
    clock += 10_000;
    await fo.execute("SELECT 1 FROM t");

    // Vẫn ở bản dự phòng. Tự quay về là vứt mất phần ghi trong lúc sự cố.
    expect(calls.execute).toBe(1);
  });

  it("bản dự phòng cũng không với tới được thì coi như chưa chuyển", async () => {
    const { client: primary, calls } = fakePrimary();
    const deadStandby = {
      async execute() {
        throw libsqlError("x", "ENOTFOUND");
      },
      close() {},
    } as unknown as Client;

    const fo = createFailoverClient({ primary, standby: deadStandby });
    const r = await fo.execute("SELECT 1");
    expect(r.rows[0]?.from).toBe("primary");
    expect(calls.execute).toBe(1);
  });
});

describe("kiểm cấu hình bản dự phòng trước khi nối", () => {
  const TOKEN = "token-gia";

  it("https / libsql / wss kèm token: nhận", () => {
    for (const url of [
      "https://db.vi-du.com",
      "libsql://db.vi-du.com",
      "wss://db.vi-du.com",
    ]) {
      expect(validateStandbyConfig(url, TOKEN), url).toEqual({ ok: true });
    }
  });

  /**
   * Ca quan trọng nhất. Bản dự phòng giữ TOÀN BỘ dữ liệu nhóm, gồm số tài
   * khoản ngân hàng và mã băm mật khẩu. Nối qua http là phát hết ra mạng, và
   * token cũng lộ theo mỗi request.
   */
  it("http / ws (không mã hoá): TỪ CHỐI", () => {
    for (const url of ["http://db.vi-du.com", "ws://db.vi-du.com"]) {
      const r = validateStandbyConfig(url, TOKEN);
      expect(r.ok, url).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/không mã hoá/);
    }
  });

  it("database ở xa mà không có token: TỪ CHỐI", () => {
    const r = validateStandbyConfig("https://db.vi-du.com", undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/token/i);
  });

  it("file cục bộ (chạy test tại máy): nhận, không đòi token", () => {
    expect(validateStandbyConfig("file:./a.db", undefined)).toEqual({
      ok: true,
    });
  });

  it("scheme lạ: TỪ CHỐI thay vì đoán", () => {
    expect(validateStandbyConfig("ftp://db.vi-du.com", TOKEN).ok).toBe(false);
    expect(validateStandbyConfig("db.vi-du.com", TOKEN).ok).toBe(false);
  });

  it("chưa khai gì: TỪ CHỐI, nhưng đó là trạng thái bình thường", () => {
    expect(validateStandbyConfig(undefined, undefined).ok).toBe(false);
  });
});
