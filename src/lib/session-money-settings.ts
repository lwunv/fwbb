import {
  SETTINGS,
  type AppSettings,
  type SettingKey,
} from "./settings-registry";
import { resolveForSession } from "./settings-resolve";

/**
 * Parse snapshot JSON thành `AppSettings`, validate từng key qua schema của
 * registry giống `resolveGlobal`. Key hỏng/thiếu thì rơi về giá trị của
 * `fallback` (không phải default cứng) — snapshot cũ có thể chỉ chứa các key
 * tồn tại lúc chốt sổ, key registry thêm sau đó phải có chỗ để rơi về.
 * Không bao giờ ném lỗi: JSON hỏng hay không phải object → coi như không có
 * snapshot, để một cột dữ liệu hỏng không chặn admin chốt sổ.
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
    if (!(k in SETTINGS)) continue;
    const key = k as SettingKey;
    const parsed = SETTINGS[key].schema.safeParse(v);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as AppSettings;
}

/** Đóng gói toàn bộ `AppSettings` thành JSON để ghi vào `sessions.settings_snapshot`. */
export function serializeSnapshot(settings: AppSettings): string {
  return JSON.stringify(settings);
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
