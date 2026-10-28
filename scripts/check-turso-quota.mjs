import { pathToFileURL } from "node:url";

/**
 * Cảnh báo hạn mức đọc của Turso TRƯỚC khi nó chạm trần.
 *
 * Ngày 24/10/2026 cả web sập vì tài khoản bị khoá do vượt hạn mức đọc. Nhìn
 * lại thì hoàn toàn thấy trước được: con số leo dần trong nhiều ngày, chỉ là
 * không ai nhìn. Script này để lần sau có người nhìn hộ.
 *
 * Dùng Platform API: GET /v1/organizations/{slug}/usage
 * Token tạo bằng: turso auth api-tokens mint <ten>
 *
 * Biến môi trường:
 *   TURSO_API_TOKEN    (bắt buộc) token Platform
 *   TURSO_ORG          (bắt buộc) slug tổ chức, ví dụ "lwcifer"
 *   ROWS_READ_LIMIT    hạn mức đọc mỗi chu kỳ, mặc định 500000000 (gói free)
 *   ALERT_PERCENT      ngưỡng cảnh báo, mặc định 70
 *
 * Thoát 0 nếu còn an toàn, 1 nếu đã quá ngưỡng hoặc không đọc được số liệu.
 */

/**
 * Lấy số dòng đã đọc ra khỏi phần `usage` mà API trả về.
 *
 * Tên trường KHÔNG được đoán bừa: API từng đổi hình dạng, và đoán sai thì
 * script báo "an toàn" trong khi thật ra sắp chết. Thử vài tên đã biết, không
 * khớp cái nào thì trả null để chỗ gọi báo đỏ thay vì im lặng cho qua.
 */
export function pickRowsRead(usage) {
  if (!usage || typeof usage !== "object") return null;
  const candidates = [
    usage.rows_read,
    usage.rowsRead,
    usage.rows,
    usage.total?.rows_read,
    usage.total?.rowsRead,
  ];
  for (const v of candidates) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Quyết định có kêu hay không. Hàm thuần để test được mà không cần mạng. */
export function evaluate(rowsRead, limit, alertPercent) {
  const percent = limit > 0 ? (rowsRead / limit) * 100 : 0;
  return {
    percent,
    rowsRead,
    limit,
    alert: percent >= alertPercent,
  };
}

// Chạy trực tiếp mới gọi mạng; import vào test thì không.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const token = process.env.TURSO_API_TOKEN;
  const org = process.env.TURSO_ORG;
  const limit = Number(process.env.ROWS_READ_LIMIT ?? 500_000_000);
  const alertPercent = Number(process.env.ALERT_PERCENT ?? 70);

  if (!token || !org) {
    console.error(
      "Thiếu TURSO_API_TOKEN hoặc TURSO_ORG.\n" +
        "Tạo token: turso auth api-tokens mint canh-bao-han-muc\n" +
        "Rồi khai hai bí mật đó trong repo. Xem docs/backup-restore.md.",
    );
    process.exit(1);
  }

  const res = await fetch(
    `https://api.turso.tech/v1/organizations/${org}/usage`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    console.error(`API trả về ${res.status}. Không đọc được số liệu.`);
    process.exit(1);
  }

  const body = await res.json();
  const rowsRead = pickRowsRead(body?.usage ?? body);
  if (rowsRead === null) {
    // Không nhận ra hình dạng dữ liệu thì PHẢI báo đỏ. Một cảnh báo im lặng
    // còn tệ hơn không có cảnh báo, vì nó tạo cảm giác an toàn giả.
    console.error(
      "Không tìm thấy số dòng đã đọc trong phản hồi. Hình dạng trả về:\n" +
        JSON.stringify(body).slice(0, 500),
    );
    process.exit(1);
  }

  const r = evaluate(rowsRead, limit, alertPercent);
  const line =
    `Đã đọc ${r.rowsRead.toLocaleString("vi-VN")} / ` +
    `${r.limit.toLocaleString("vi-VN")} dòng = ${r.percent.toFixed(1)}%`;

  if (r.alert) {
    console.error(`::error::HẠN MỨC ĐỌC SẮP ĐẦY — ${line}`);
    console.error(
      "\nVượt 100% là KHOÁ CẢ TÀI KHOẢN, mọi trang trả 500, và lúc đó cũng\n" +
        "không xuất được dữ liệu ra vì export cũng tính là đọc.\n" +
        "Xem chỗ nào đang đọc nhiều: DB_QUERY_LOG=1 (src/db/index.ts).",
    );
    process.exit(1);
  }
  console.log(`Còn an toàn. ${line} (ngưỡng cảnh báo ${alertPercent}%)`);
}
