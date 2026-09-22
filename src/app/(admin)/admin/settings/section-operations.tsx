"use client";

import { useTranslations } from "next-intl";
import { Cog } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CustomSelect } from "@/components/ui/custom-select";
import { useSettingsDraft } from "./settings-draft";
import { normalizeContactHotline } from "@/lib/settings-registry";
import { VN_BANKS } from "@/lib/vn-banks";
import { AUTO_MATCH_BANK_BIN } from "@/lib/bank-account";

// Chỉ liệt kê ngân hàng hỗ trợ nhận chuyển khoản qua VietQR — ngân hàng
// không hỗ trợ vẫn nằm trong VN_BANKS (để tra BIN cũ) nhưng không có nghĩa
// để chọn ở đây.
const BANK_OPTIONS = VN_BANKS.filter((b) => b.transferSupported).map((b) => ({
  value: b.bin,
  label: b.shortName,
}));

export function SectionOperations() {
  const t = useTranslations("adminSettings");
  // Đọc/ghi thẳng bản nháp chung, server chỉ nhận khi bấm Lưu. Bảy cặp
  // state + useEffect đồng bộ trước đây không còn cần: bản nháp tự trả về
  // giá trị server cho khoá nào chưa sửa.
  const { get, set, reset } = useSettingsDraft();

  const autoCreate = get("autoCreateSessions");
  const appName = get("appName");
  const bankBin = get("bankBin");
  const bankAccountNo = get("bankAccountNo");
  const bankAccountName = get("bankAccountName");
  const contactHotline = get("contactHotline");
  const contactEmail = get("contactEmail");

  // Gõ tới đâu vào nháp tới đó; lúc RỜI ô mới chuẩn hoá (trim, hotline bỏ dấu
  // cách/chấm/gạch). Chuẩn hoá ngay khi gõ sẽ nhảy con trỏ giữa chừng.
  function blurTrim(
    key: "appName" | "bankAccountNo" | "bankAccountName" | "contactEmail",
    raw: string,
  ) {
    const trimmed = raw.trim();
    // Tên app để trống thì registry chặn, lưu lên chắc chắn lỗi. Trả ô về
    // đúng giá trị server thay vì giữ chuỗi rỗng chờ báo lỗi lúc bấm Lưu.
    if (key === "appName" && !trimmed) {
      reset("appName");
      return;
    }
    set(key, trimmed);
  }

  function blurHotline(raw: string) {
    // Dùng đúng hàm registry export ra, không chép lại regex.
    set("contactHotline", normalizeContactHotline(raw));
  }

  return (
    <SectionCard tone="slate" icon={Cog} title={t("operations")}>
      <div className="space-y-3">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{t("autoCreate")}</div>
            <p className="text-muted-foreground text-xs">
              {t("autoCreateHint")}
            </p>
          </div>
          <Switch
            checked={autoCreate}
            onCheckedChange={(v) => set("autoCreateSessions", v)}
          />
        </div>
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t("appName")}
          </span>
          <Input
            value={appName}
            className="min-h-11"
            onChange={(e) => set("appName", e.target.value)}
            onBlur={(e) => blurTrim("appName", e.target.value)}
          />
        </label>

        <div className="space-y-3 border-t pt-3">
          <div className="text-sm font-medium">{t("bankAccount")}</div>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t("bankName")}
            </span>
            <CustomSelect
              value={bankBin}
              onChange={(v) => set("bankBin", v)}
              placeholder={t("bankPlaceholder")}
              searchable
              options={BANK_OPTIONS}
            />
          </label>
          {/* Auto-match qua email chỉ hiểu Timo/BVBank (AUTO_MATCH_BANK_BIN) —
              webhook lọc cứng From: support@timo.vn, không đọc setting này.
              Đổi ngân hàng khác không đổi logic khớp tiền, chỉ cảnh báo để
              admin biết phải xác nhận tay. */}
          {bankBin !== AUTO_MATCH_BANK_BIN && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                ⚠️ {t("bankAutoMatchWarning")}
              </p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                {t("bankAccountNo")}
              </span>
              <Input
                value={bankAccountNo}
                inputMode="numeric"
                maxLength={20}
                className="min-h-11"
                onChange={(e) => set("bankAccountNo", e.target.value)}
                onBlur={(e) => blurTrim("bankAccountNo", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                {t("bankAccountName")}
              </span>
              <Input
                value={bankAccountName}
                className="min-h-11"
                onChange={(e) => set("bankAccountName", e.target.value)}
                onBlur={(e) => blurTrim("bankAccountName", e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="space-y-3 border-t pt-3">
          <div className="text-sm font-medium">{t("contactInfo")}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                {t("contactHotline")}
              </span>
              <Input
                value={contactHotline}
                type="tel"
                inputMode="tel"
                className="min-h-11"
                onChange={(e) => set("contactHotline", e.target.value)}
                onBlur={(e) => blurHotline(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                {t("contactEmail")}
              </span>
              <Input
                value={contactEmail}
                type="email"
                inputMode="email"
                className="min-h-11"
                onChange={(e) => set("contactEmail", e.target.value)}
                onBlur={(e) => blurTrim("contactEmail", e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
