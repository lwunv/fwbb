import { z } from "zod";
import { findBankByBin } from "./vn-banks";
import { DEFAULT_GROUP_POLICIES } from "./group-policy";

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

// `.strict()` ở cả nhóm và toàn bảng: key lạ (gõ nhầm tên nhóm, field cũ còn
// sót sau đổi tên) bị CHẶN thay vì âm thầm bỏ qua. Đối xứng với quy tắc thiếu
// nhóm cũng bị chặn — sai lệch cấu hình tiền phải lộ ra ngay lúc lưu, không
// lộ ra sau ở số tiền member bị tính.
const groupPolicySchema = z
  .object({
    mode: z.enum(["equal", "floor", "fixed", "percent"]),
    amount: z.number().int().nonnegative(),
    capAtEqual: z.boolean(),
    // `.optional()` ở ĐÂY là bắt buộc, không phải nới lỏng cho tiện.
    //
    // `sessions.settings_snapshot` của mọi buổi đã chốt sổ trước 22/9/2026
    // đều KHÔNG có field này. `parseSnapshot` coi "có mặt nhưng sai schema"
    // là hỏng CẢ snapshot và rơi về cấu hình hiện tại, nên bắt buộc field
    // mới đồng nghĩa với việc mọi buổi lịch sử bị tính lại theo cấu hình
    // hôm nay. Khuyết thì `percentFactor` tính như 100% (trả bằng nam), tức
    // hướng thu đủ. Lưu ý phân biệt với quy tắc cấm `.optional()` cho SÁU
    // NHÓM bên dưới: thiếu cả một nhóm là mất cấu hình, còn thiếu field này
    // chỉ là bản ghi cũ chưa biết tới cách tính mới.
    percent: z.number().int().min(0).max(100).optional(),
  })
  .strict();

/** Ba nhóm không phải nữ: không có nhóm gốc nào để lấy phần trăm. */
const NON_FEMALE_GROUPS = ["member", "guestMember", "guestAdmin"] as const;

function def<T>(d: SettingDef<T>): SettingDef<T> {
  return d;
}

// Người dùng gõ số điện thoại tự nhiên kiểu "090 765 4321" hay
// "090.765.4321". Bỏ dấu cách/dấu chấm/dấu gạch ngang — giá trị nằm trong DB
// dùng thẳng làm href `tel:`, và một `tel:` href có dấu cách không tin cậy
// trên mọi dialer di động. Export ra để component ô nhập (section-operations)
// dùng LẠI ĐÚNG hàm này cho state lạc quan — không chép lại regex, tránh lệch
// giữa giá trị hiện trên UI và giá trị thật sẽ được server chuẩn hoá rồi lưu.
export function normalizeContactHotline(v: string): string {
  return v.trim().replace(/[\s.-]/g, "");
}

// Nhận đầu số `0` hoặc `+84`, giữ nguyên đầu số admin gõ (không tự quy đổi
// qua lại giữa hai dạng). Theo sau ĐÚNG 9 chữ số — số di động VN chuẩn là
// 10 số bắt đầu bằng 0 (0 + 9 số) hoặc +84 + 9 số (bỏ số 0 đầu). Cố tình
// KHÔNG dùng khoảng {8,9}: số thiếu 1 chữ số vẫn phải bị chặn, không cho qua
// như số hợp lệ (xem regression test "chặn số thiếu đúng 1 chữ số"). Không
// hỗ trợ landline nhiều số hơn — hotline nhóm trong thực tế luôn là di động
// cá nhân của admin/BTC.
const contactHotlineSchema = z
  .string()
  .transform(normalizeContactHotline)
  .refine((v) => v === "" || /^(0|\+84)\d{9}$/.test(v), {
    message: "Số hotline không hợp lệ",
  });

// Rỗng = chưa cấu hình. Không rỗng thì phải là email hợp lệ.
const contactEmailSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || z.email().safeParse(v).success, {
    message: "Email không hợp lệ",
  });

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

  // ─── Tài khoản nhận tiền (QR chuyển khoản) ───
  // Mặc định "970454" = BIN của Timo/VietCapitalBank (BVBank), đúng giá trị
  // fallback env hôm nay (NEXT_PUBLIC_TIMO_BANK_BIN) nên chưa cấu hình vẫn ra
  // đúng hành vi cũ.
  // Chặn BIN tự do bằng .refine() qua VN_BANKS — chọn từ dropdown, không gõ tay.
  bankBin: def({
    key: "bankBin",
    schema: z.string().refine((bin) => findBankByBin(bin) !== undefined, {
      message: "Mã ngân hàng không hợp lệ",
    }),
    default: "970454",
    perSession: false,
    revalidate: ["/", "/admin/fund"],
  }),
  // Rỗng = chưa cấu hình, lùi về env (xem src/lib/bank-account.ts). Không rỗng
  // thì phải là 6-20 chữ số liền, không dấu cách.
  bankAccountNo: def({
    key: "bankAccountNo",
    schema: z.string().refine((v) => v === "" || /^\d{6,20}$/.test(v), {
      message: "Số tài khoản không hợp lệ",
    }),
    default: "",
    perSession: false,
    revalidate: ["/", "/admin/fund"],
  }),
  // Rỗng = chưa cấu hình, lùi về env. Trim để không lưu khoảng trắng đầu/cuối
  // gõ nhầm.
  bankAccountName: def({
    key: "bankAccountName",
    schema: z.string().trim().max(100, "Tên chủ tài khoản tối đa 100 ký tự"),
    default: "",
    perSession: false,
    revalidate: ["/", "/admin/fund"],
  }),

  // ─── Liên hệ nhóm (hiện ở màn vote khi đã cấu hình) ───
  // Mặc định rỗng = admin chưa cấu hình → khối liên hệ ở màn vote KHÔNG
  // render gì (không phải box trống, không phải "chưa có"). Hôm nay chưa ai
  // cấu hình nên đây là trạng thái đa số member sẽ thấy — màn vote phải
  // giống hệt lúc chưa có hai setting này. Hai setting độc lập, không bắt
  // buộc phải điền cả hai. perSession: false vì đây là thông tin liên hệ của
  // cả nhóm, không có lý do khác nhau theo từng buổi.
  contactHotline: def({
    key: "contactHotline",
    schema: contactHotlineSchema,
    default: "",
    perSession: false,
    // /vote/[id] đọc cookie member (getUserFromCookie) nên trang luôn render
    // động mỗi request — không có route cache tĩnh nào cần revalidate.
    revalidate: [],
  }),
  contactEmail: def({
    key: "contactEmail",
    schema: contactEmailSchema,
    default: "",
    perSession: false,
    revalidate: [],
  }),

  // ─── Chia tiền — ba setting đầu tiên perSession: true ───
  minDeductionAmount: def({
    key: "minDeductionAmount",
    schema: moneyVnd,
    default: 60_000,
    perSession: true,
    revalidate: ["/admin/sessions", "/admin/dashboard", "/"],
  }),
  genderPricingEnabled: def({
    key: "genderPricingEnabled",
    schema: z.boolean(),
    default: false,
    perSession: true,
    revalidate: ["/admin/sessions", "/admin/dashboard", "/", "/admin/members"],
  }),
  // Caller (form admin, action lưu setting...) LUÔN phải gửi đủ 6 nhóm, không
  // bao giờ PATCH một phần. Schema `.strict()` bên dưới chặn thiếu/dư nhóm
  // đúng vì lý do này: một patch một phần lặng lẽ làm 2 nhóm còn lại rơi về
  // default chỉ lộ ra sau ở số tiền member bị tính, không lộ lúc lưu. Đừng
  // "sửa" lỗi thiếu-field bằng `.partial()` hay field `.optional()` — làm vậy
  // là mở lại đúng lỗ hổng này.
  groupPolicies: def({
    key: "groupPolicies",
    schema: z
      .object({
        member: groupPolicySchema,
        memberFemale: groupPolicySchema,
        guestMember: groupPolicySchema,
        guestMemberFemale: groupPolicySchema,
        guestAdmin: groupPolicySchema,
        guestAdminFemale: groupPolicySchema,
      })
      .strict()
      // Cách tính phần trăm chỉ có nghĩa với nhóm nữ (nữ = X% nhóm nam tương
      // ứng). Đặt cho nhóm nam thì không có gốc để nhân: bộ tính tiền coi như
      // chia đều, và một cài đặt không có tác dụng nhưng vẫn hiện trên màn
      // hình là kiểu sai âm thầm. Chặn ngay lúc lưu để admin thấy lỗi.
      .superRefine((v, ctx) => {
        // Chọn cách tính phần trăm mà không kèm số thì `percentInt` hiểu là
        // 100% (nữ trả bằng nam) — màn hình ghi một đằng, tiền tính một nẻo.
        // Giao diện đã điền sẵn 80, đây là chốt chặn cho đường ghi setting
        // không qua giao diện. Không đụng bản chụp cũ: bản chụp cũ không có
        // nhóm nào ở mode percent.
        for (const [k, p] of Object.entries(v)) {
          if (p.mode === "percent" && p.percent === undefined) {
            ctx.addIssue({
              code: "custom",
              path: [k, "percent"],
              message:
                "Chọn cách tính theo phần trăm thì phải kèm số phần trăm.",
            });
          }
        }
        for (const k of NON_FEMALE_GROUPS) {
          if (v[k].mode === "percent") {
            ctx.addIssue({
              code: "custom",
              path: [k, "mode"],
              message:
                "Cách tính theo phần trăm chỉ dùng được cho nhóm nữ, vì nó lấy theo suất của nhóm nam tương ứng.",
            });
          }
        }
      }),
    default: DEFAULT_GROUP_POLICIES,
    perSession: true,
    revalidate: ["/admin/sessions", "/admin/dashboard", "/"],
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
