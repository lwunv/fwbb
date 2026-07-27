import { z } from "zod";

/**
 * Khai báo một setting. Registry là nguồn sự thật duy nhất cho tên key, kiểu
 * dữ liệu và giá trị mặc định. Thêm setting mới = thêm một entry, không cần
 * migration vì bảng `app_settings` là key/value.
 */
export interface SettingDef<T> {
  /** Key trong bảng `app_settings`. Phải trùng tên thuộc tính trong SETTINGS. */
  key: string;
  schema: z.ZodType<T>;
  /** Giá trị khi chưa ai set. BẮT BUỘC khớp hành vi đang chạy. */
  default: T;
  /** Có cho override riêng theo từng buổi không. */
  perSession: boolean;
  /** Route cần revalidate sau khi đổi. */
  revalidate: string[];
}

const moneyVnd = z.number().int().nonnegative();
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ phải có dạng HH:MM");

function def<T>(d: SettingDef<T>): SettingDef<T> {
  return d;
}

export const SETTINGS = {
  // ─── Đã tồn tại trong app_settings, giữ nguyên tên key ───
  appName: def({
    key: "appName",
    schema: z.string().trim().min(1),
    default: "FWBB",
    perSession: false,
    revalidate: ["/", "/admin"],
  }),
  defaultCourtId: def({
    key: "defaultCourtId",
    schema: z.number().int().positive().nullable(),
    default: null as number | null,
    perSession: false,
    revalidate: [
      "/admin/courts",
      "/admin/sessions",
      "/admin/dashboard",
      "/admin/court-rent",
    ],
  }),
  defaultBrandId: def({
    key: "defaultBrandId",
    schema: z.number().int().positive().nullable(),
    default: null as number | null,
    perSession: false,
    revalidate: ["/admin/shuttlecocks", "/admin/sessions", "/admin/dashboard"],
  }),
  sessionDaysOfWeek: def({
    key: "sessionDaysOfWeek",
    schema: z.array(z.number().int().min(0).max(6)).min(1),
    default: [1, 3, 5],
    perSession: false,
    revalidate: ["/admin/dashboard", "/admin/sessions", "/admin/court-rent"],
  }),

  // ─── Mặc định cho buổi mới ───
  defaultStartTime: def({
    key: "defaultStartTime",
    schema: hhmm,
    default: "20:30",
    perSession: false,
    revalidate: ["/admin/sessions", "/admin/dashboard"],
  }),
  defaultEndTime: def({
    key: "defaultEndTime",
    schema: hhmm,
    default: "22:30",
    perSession: false,
    revalidate: ["/admin/sessions", "/admin/dashboard"],
  }),
  defaultCourtQuantity: def({
    key: "defaultCourtQuantity",
    schema: z.number().int().min(1).max(10),
    default: 1,
    perSession: false,
    revalidate: ["/admin/sessions", "/admin/dashboard"],
  }),
  voteDeadlineOffsetHours: def({
    key: "voteDeadlineOffsetHours",
    schema: z.number().int().min(0).max(72),
    default: 4,
    perSession: false,
    revalidate: ["/admin/sessions", "/admin/dashboard", "/"],
  }),
  defaultMaxPlayers: def({
    key: "defaultMaxPlayers",
    schema: z.number().int().min(1).max(100),
    default: 16,
    perSession: false,
    revalidate: ["/admin/sessions", "/admin/dashboard"],
  }),
  maxPlayersOptions: def({
    key: "maxPlayersOptions",
    schema: z.array(z.number().int().min(1).max(100)).min(1),
    default: [8, 12, 16, 20],
    perSession: false,
    revalidate: ["/admin/sessions", "/admin/dashboard"],
  }),

  // ─── Ngưỡng ───
  lowFundThreshold: def({
    key: "lowFundThreshold",
    schema: moneyVnd,
    default: 100_000,
    perSession: false,
    revalidate: ["/admin/fund", "/admin/dashboard", "/"],
  }),
  voteBlockDebtThreshold: def({
    key: "voteBlockDebtThreshold",
    schema: moneyVnd,
    default: 100_000,
    perSession: false,
    revalidate: ["/"],
  }),
  lowStockThresholdQua: def({
    key: "lowStockThresholdQua",
    schema: z.number().int().nonnegative(),
    default: 12,
    perSession: false,
    revalidate: ["/admin/inventory", "/admin/dashboard"],
  }),

  // ─── Vận hành ───
  autoCreateSessions: def({
    key: "autoCreateSessions",
    schema: z.boolean(),
    default: true,
    perSession: false,
    revalidate: ["/admin/dashboard", "/admin/sessions"],
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;

export type AppSettings = {
  [K in SettingKey]: (typeof SETTINGS)[K]["default"];
};

export function defaultSettings(): AppSettings {
  const out = {} as Record<string, unknown>;
  for (const [name, d] of Object.entries(SETTINGS)) {
    out[name] = d.default;
  }
  return out as AppSettings;
}

export function isPerSession(key: SettingKey): boolean {
  return SETTINGS[key].perSession;
}
