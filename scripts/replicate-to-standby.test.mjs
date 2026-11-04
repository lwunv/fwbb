/**
 * Chốt chặn của việc nhân bản: KHÔNG ghi đè khi app đang chạy trên bản dự
 * phòng.
 *
 * Sai ở đây không phải lỗi hiển thị. Nó xoá sạch mọi thứ cả nhóm vừa nhập
 * trong lúc sự cố, và không có cách nào lấy lại.
 */
import { describe, it, expect } from "vitest";
import {
  mayOverwriteStandby,
  planSchemaSync,
} from "./replicate-to-standby.mjs";

describe("có được ghi đè lên bản dự phòng không", () => {
  it("đang chạy trên bản dự phòng: KHÔNG", () => {
    expect(mayOverwriteStandby({ active: "standby", since: "x" })).toBe(false);
  });

  it("cờ nói đang ở bản chính: được", () => {
    expect(mayOverwriteStandby({ active: "primary", since: "x" })).toBe(true);
  });

  it("chưa có cờ (chưa từng chuyển lần nào): được", () => {
    expect(mayOverwriteStandby(null)).toBe(true);
    expect(mayOverwriteStandby(undefined)).toBe(true);
  });

  it("cờ hỏng hình dạng: được, vì nó không nói là đang chuyển", () => {
    expect(mayOverwriteStandby({})).toBe(true);
    expect(mayOverwriteStandby({ active: "" })).toBe(true);
  });
});

/**
 * Đồng bộ schema trước khi nạp data: đây là chỗ vá gốc cho sự cố 04/11/2026.
 *
 * Bản dump chỉ có dữ liệu, không có cấu trúc. Khi bản chính thêm cột mà bản dự
 * phòng chưa có (vd migration 0027 thêm `signup_intent`), lệnh INSERT của
 * restore-db đổ vỡ với "no column named ...". Hàm này so schema hai bên và
 * sinh ra các lệnh DDL CỘNG-THÊM để bắt bản dự phòng kịp bản chính. Thay đổi
 * phá vỡ (xoá cột/bảng, NOT NULL không mặc định) thì KHÔNG tự làm, chỉ cảnh báo.
 */
describe("kế hoạch đồng bộ schema prod → dự phòng", () => {
  const col = (name, extra = {}) => ({
    name,
    type: "text",
    notnull: false,
    dflt_value: null,
    ...extra,
  });

  it("hai bên giống hệt: không sinh lệnh nào", () => {
    const schema = { tables: { members: { columns: [col("id"), col("name")] } } };
    const { statements, warnings } = planSchemaSync(schema, schema);
    expect(statements).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("prod có cột mới (signup_intent): sinh đúng một ALTER ADD COLUMN", () => {
    const prod = {
      tables: {
        members: {
          columns: [
            col("id"),
            col("name"),
            col("signup_intent", { dflt_value: "'group'", notnull: true }),
          ],
        },
      },
    };
    const standby = {
      tables: { members: { columns: [col("id"), col("name")] } },
    };
    const { statements, warnings } = planSchemaSync(prod, standby);
    expect(statements).toEqual([
      `ALTER TABLE "members" ADD COLUMN "signup_intent" text DEFAULT 'group' NOT NULL`,
    ]);
    expect(warnings).toEqual([]);
  });

  it("prod có bảng mới hoàn toàn: tạo bảng y hệt + index của nó", () => {
    const prod = {
      tables: {
        members: { columns: [col("id")] },
        zalo_identities: {
          columns: [col("id"), col("member_id")],
          createSql: 'CREATE TABLE "zalo_identities" ("id" text PRIMARY KEY, "member_id" integer)',
          indexes: [
            { name: "zi_member_idx", sql: 'CREATE INDEX "zi_member_idx" ON "zalo_identities" ("member_id")' },
          ],
        },
      },
    };
    const standby = { tables: { members: { columns: [col("id")] } } };
    const { statements, warnings } = planSchemaSync(prod, standby);
    expect(statements).toEqual([
      'CREATE TABLE "zalo_identities" ("id" text PRIMARY KEY, "member_id" integer)',
      'CREATE INDEX "zi_member_idx" ON "zalo_identities" ("member_id")',
    ]);
    expect(warnings).toEqual([]);
  });

  it("cột mới NOT NULL mà không có mặc định: KHÔNG tự thêm, chỉ cảnh báo", () => {
    const prod = {
      tables: {
        members: {
          columns: [col("id"), col("danger", { notnull: true, dflt_value: null })],
        },
      },
    };
    const standby = { tables: { members: { columns: [col("id")] } } };
    const { statements, warnings } = planSchemaSync(prod, standby);
    expect(statements).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("danger");
  });

  it("dự phòng có cột/bảng thừa so với prod: KHÔNG tự xoá, chỉ cảnh báo", () => {
    const prod = { tables: { members: { columns: [col("id")] } } };
    const standby = {
      tables: {
        members: { columns: [col("id"), col("old_col")] },
        legacy_table: { columns: [col("id")] },
      },
    };
    const { statements, warnings } = planSchemaSync(prod, standby);
    expect(statements).toEqual([]);
    expect(warnings.some((w) => w.includes("old_col"))).toBe(true);
    expect(warnings.some((w) => w.includes("legacy_table"))).toBe(true);
  });
});
