/**
 * Gộp cấu hình tài khoản nhận tiền thành một nguồn duy nhất, thay cho ba
 * `const` đọc trực tiếp `process.env.NEXT_PUBLIC_TIMO_*` từng nằm rải trong
 * payment-qr.tsx và getFWBBPaymentQRUrl (đã xoá).
 *
 * Quy tắc lùi env: setting đã có giá trị (admin nhập ở trang Cài đặt) thì
 * setting thắng; setting còn rỗng thì lùi về env cũ; env cũng rỗng thì ra
 * chuỗi rỗng như hành vi hôm nay. Đây quan trọng vì prod hiện chạy hoàn toàn
 * bằng env, admin chưa nhập gì — không lùi thì QR trắng, member không chuyển
 * tiền được.
 *
 * `bankBin` không cần lùi: registry đã có default `"970454"` nên setting
 * luôn có giá trị.
 *
 * Hàm thuần, không đọc `process.env` bên trong — nhận env qua tham số để
 * test không phải chọc vào biến môi trường thật, và để component client (nơi
 * duy nhất còn cần đọc `NEXT_PUBLIC_*`) là nơi truyền vào.
 */
import type { AppSettings } from "./settings-registry";

export interface BankAccountEnv {
  /** Ứng với NEXT_PUBLIC_TIMO_ACCOUNT_NO. */
  accountNo: string;
  /** Ứng với NEXT_PUBLIC_TIMO_ACCOUNT_NAME. */
  accountName: string;
}

export interface ResolvedBankAccount {
  bankBin: string;
  accountNo: string;
  accountName: string;
}

export function resolveBankAccount(
  settings: Pick<AppSettings, "bankBin" | "bankAccountNo" | "bankAccountName">,
  env: BankAccountEnv,
): ResolvedBankAccount {
  return {
    bankBin: settings.bankBin,
    accountNo: settings.bankAccountNo || env.accountNo,
    accountName: settings.bankAccountName || env.accountName,
  };
}
