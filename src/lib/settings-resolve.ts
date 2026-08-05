import {
  SETTINGS,
  defaultSettings,
  type AppSettings,
  type SettingKey,
} from "./settings-registry";

/**
 * Value trong `app_settings` là text. Dữ liệu cũ lưu dạng trần (`"7"`,
 * `"1,3,5"`, `"FWBB"`), dữ liệu mới lưu JSON. Hàm này thử JSON trước, không
 * được thì rơi về cách đọc cũ để không phải migrate dữ liệu đang có.
 */
function parseRaw(key: SettingKey, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Định dạng cũ: danh sách phân cách bằng dấu phẩy.
    if (raw.includes(",")) {
      const parts = raw.split(",").map((s) => Number(s.trim()));
      if (parts.every((n) => Number.isFinite(n))) return parts;
    }
    // Định dạng cũ: số trần.
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n)) return n;
    return raw;
  }
}

/** Gộp các dòng `app_settings` thô thành object đã parse. Không bao giờ ném lỗi. */
export function resolveGlobal(
  rows: ReadonlyArray<{ key: string; value: string }>,
): AppSettings {
  const out = defaultSettings() as Record<string, unknown>;
  for (const row of rows) {
    if (!(row.key in SETTINGS)) continue;
    const key = row.key as SettingKey;
    const parsed = SETTINGS[key].schema.safeParse(parseRaw(key, row.value));
    if (parsed.success) out[key] = parsed.data;
    // Hỏng thì giữ default. Không ném lỗi vì một ô hỏng không được làm chết
    // cả trang.
  }
  return out as AppSettings;
}

/** Đè cấu hình riêng của một buổi lên trên setting chung. */
export function resolveForSession(
  global: AppSettings,
  overrideJson: string | null,
): AppSettings {
  if (!overrideJson) return global;
  let raw: unknown;
  try {
    raw = JSON.parse(overrideJson);
  } catch {
    return global;
  }
  if (typeof raw !== "object" || raw === null) return global;

  const out = { ...global } as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in SETTINGS)) continue;
    const key = k as SettingKey;
    if (!SETTINGS[key].perSession) continue;
    const parsed = SETTINGS[key].schema.safeParse(v);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as AppSettings;
}

/** Đóng gói giá trị để ghi vào cột text. Luôn ghi JSON cho dữ liệu mới. */
export function serializeSetting<K extends SettingKey>(
  _key: K,
  value: AppSettings[K],
): string {
  return JSON.stringify(value);
}
