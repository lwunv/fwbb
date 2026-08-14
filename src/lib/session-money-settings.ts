import {
  SETTINGS,
  type AppSettings,
  type SettingKey,
} from "./settings-registry";
import { resolveForSession } from "./settings-resolve";

/**
 * Parse snapshot JSON thành `AppSettings`, validate từng key qua schema của
 * registry giống `resolveGlobal`. Không bao giờ ném lỗi: JSON hỏng hay không
 * phải object → coi như không có snapshot, để một cột dữ liệu hỏng không
 * chặn admin chốt sổ.
 *
 * `serializeSnapshot` chỉ ghi các key `perSession: true` (xem hàm đó), nên
 * hàm này CHỈ đọc key `perSession: true` từ `raw` — key khác (kể cả key hợp
 * lệ) bị bỏ qua thay vì áp dụng, vì hai lý do:
 *  - Key không có trong registry nữa (đổi tên/xoá) — tàn dư vô hại.
 *  - Key có trong registry nhưng `perSession: false` (vd `bankAccountNo`,
 *    `appName`) — tàn dư từ ĐỊNH DẠNG SNAPSHOT CŨ (bản trước Task 10 fix-2
 *    lưu TOÀN BỘ AppSettings, gồm cả số tài khoản ngân hàng — sai, đã sửa).
 *    Đọc lại các key này sẽ đóng băng dữ liệu không liên quan tiền (hoặc tệ
 *    hơn là thông tin ngân hàng) vào một buổi cụ thể — không phải mục đích
 *    của snapshot. Bỏ qua, không áp dụng, và KHÔNG coi là hỏng.
 *
 * PHÂN BIỆT QUAN TRỌNG cho key `perSession: true`:
 *  - VẮNG MẶT trong `raw` (registry thêm setting tiền mới SAU khi buổi này
 *    đã đóng băng) → bình thường, rơi về `fallback` cho riêng key đó, không
 *    ảnh hưởng các key khác.
 *  - CÓ MẶT trong `raw` nhưng sai schema (vd registry thắt chặt validation,
 *    field bắt buộc mới trong `groupPolicySchema`) → coi CẢ snapshot hỏng,
 *    trả `null` để caller rơi về NGUYÊN VẸN cấu hình hiện tại (nhất quán)
 *    thay vì trộn "floor cũ + group-split mới" — một cấu hình CHƯA TỪNG tồn
 *    tại ở bất kỳ thời điểm nào. Rơi riêng lẻ từng key sẽ tạo ra đúng loại
 *    lỗi âm thầm mà task này được tạo ra để vá, chỉ là ở lớp cao hơn.
 */
function parseSnapshot(
  json: string,
  fallback: AppSettings,
): AppSettings | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;

  const out = { ...fallback } as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in SETTINGS)) continue; // key lạ/đã bỏ khỏi registry — tàn dư vô hại
    const key = k as SettingKey;
    if (!SETTINGS[key].perSession) continue; // tàn dư định dạng cũ — bỏ qua, không áp dụng
    const parsed = SETTINGS[key].schema.safeParse(v);
    if (!parsed.success) return null; // CÓ MẶT nhưng sai schema → cả snapshot hỏng
    out[key] = parsed.data;
  }
  return out as AppSettings;
}

/**
 * Đóng gói cấu hình cần đóng băng thành JSON để ghi vào
 * `sessions.settings_snapshot`. CHỈ lấy các key `perSession: true` trong
 * registry — đây đã đúng là định nghĩa "giá trị có thể khác nhau theo từng
 * buổi", chính xác là thứ một snapshot theo-buổi cần chụp lại. Lấy danh sách
 * key TẠI RUNTIME từ `SETTINGS` (không hardcode tên) để không bao giờ quên
 * một setting tiền mới thêm sau này — nó chỉ cần khai `perSession: true`
 * trong registry là tự động được đóng băng.
 *
 * KHÔNG lưu toàn bộ `AppSettings` như lần viết đầu (Task 10 bản gốc) — làm
 * vậy vô tình sao chép `bankAccountNo`/`bankAccountName` (thông tin ngân
 * hàng của club) vào MỌI buổi đã chốt sổ, mãi mãi, không có lợi ích gì và vi
 * phạm nguyên tắc không rải thông tin tài khoản ngân hàng ra nhiều nơi.
 */
export function serializeSnapshot(settings: AppSettings): string {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SETTINGS) as SettingKey[]) {
    if (SETTINGS[key].perSession) {
      out[key] = settings[key];
    }
  }
  return JSON.stringify(out);
}

export interface ResolveSessionSettingsInput {
  /** Setting chung hiện tại, đã resolve từ `app_settings`. */
  global: AppSettings;
  /** `sessions.settings_override` thô (JSON hoặc null). */
  override: string | null;
  /** `sessions.settings_snapshot` thô (JSON hoặc null). */
  snapshot: string | null;
}

export interface ResolveSessionSettingsResult {
  settings: AppSettings;
  /**
   * `true` nếu cấu hình trả về được đọc từ snapshot đã đóng băng (buổi đã
   * chốt sổ trước đó). `false` nếu chưa có snapshot hợp lệ — caller
   * (`finalizeSession`) dùng cờ này để biết có cần ghi snapshot mới không.
   */
  fromSnapshot: boolean;
}

/**
 * Gộp ba tầng cấu hình cho một buổi, theo đúng thứ tự ưu tiên:
 * snapshot > override của buổi > setting chung.
 *
 * Snapshot thắng override vì snapshot là ảnh chụp cấu hình ĐÃ ÁP DỤNG THẬT
 * lúc chốt sổ lần đầu — cấu hình đó vốn đã gộp override vào rồi. Đọc lại
 * override sau đó là đọc một giá trị admin có thể đã sửa sau khi buổi chốt
 * xong, làm tiền lịch sử đổi theo cấu hình mới (chính là bug task này vá).
 */
export function resolveSessionSettings(
  input: ResolveSessionSettingsInput,
): ResolveSessionSettingsResult {
  const withOverride = resolveForSession(input.global, input.override);

  if (input.snapshot) {
    const frozen = parseSnapshot(input.snapshot, withOverride);
    if (frozen) return { settings: frozen, fromSnapshot: true };
    // Snapshot hỏng (JSON lỗi hoặc không phải object) → rơi về tầng dưới,
    // báo fromSnapshot=false để finalizeSession ghi lại snapshot mới, thay
    // thế cho cột dữ liệu hỏng.
  }

  return { settings: withOverride, fromSnapshot: false };
}
