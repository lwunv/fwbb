import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Nơi cất phiên admin của lần kiểm prod.
 *
 * Để ở thư mục tạm của HỆ ĐIỀU HÀNH chứ không phải trong repo: file này chứa
 * cookie phiên admin THẬT, lỡ commit lên là trao quyền admin cho bất kỳ ai đọc
 * được repo. `.gitignore` không bảo vệ được thứ nằm ngoài tầm với của nó, mà
 * để ngoài repo thì không cần bảo vệ.
 */
export const PROD_STORAGE_STATE = join(tmpdir(), "fwbb-prod-admin-state.json");
