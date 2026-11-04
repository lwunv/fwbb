"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Cog } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CustomSelect } from "@/components/ui/custom-select";
import { useSettingsDraft } from "@/components/settings/settings-draft";
import { SETTINGS, normalizeContactHotline } from "@/lib/settings-registry";
import { VN_BANKS } from "@/lib/vn-banks";
import { AUTO_MATCH_BANK_BIN } from "@/lib/bank-account";

// Chỉ liệt kê ngân hàng hỗ trợ nhận chuyển khoản qua VietQR — ngân hàng
// không hỗ trợ vẫn nằm trong VN_BANKS (để tra BIN cũ) nhưng không có nghĩa
// để chọn ở đây.
const BANK_OPTIONS = VN_BANKS.filter((b) => b.transferSupported).map((b) => ({
  value: b.bin,
  label: b.shortName,
}));

const LOCK_HOURS_MIN = 1;
const LOCK_HOURS_MAX = 72;

export function SectionOperations() {
  const t = useTranslations("adminSettings");
  // Đọc/ghi thẳng bản nháp chung, server chỉ nhận khi bấm Lưu. Bảy cặp
  // state + useEffect đồng bộ trước đây không còn cần: bản nháp tự trả về
  // giá trị server cho khoá nào chưa sửa.
  const { get, set, reset } = useSettingsDraft();

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

  // Link Zalo sai KHÔNG vào bản nháp (registry sẽ từ chối lúc Lưu và admin chỉ
  // thấy lỗi muộn). Giữ chữ đang gõ ở state cục bộ, nháp quay về giá trị server.
  const [badZaloText, setBadZaloText] = useState<string | null>(null);
  function changeZalo(raw: string) {
    const v = raw.trim();
    if (SETTINGS.zaloGroupUrl.schema.safeParse(v).success) {
      setBadZaloText(null);
      set("zaloGroupUrl", v);
    } else {
      setBadZaloText(raw);
      reset("zaloGroupUrl");
    }
  }

  // Số giờ: giá trị hợp lệ vào nháp ngay (để bấm Lưu liền không cần rời ô);
  // chữ dở dang hoặc ngoài khoảng chỉ nằm ở state cục bộ tới lúc rời ô.
  const [lockHoursText, setLockHoursText] = useState<string | null>(null);
  function changeLockHours(raw: string) {
    const n = Number(raw);
    if (
      raw.trim() !== "" &&
      Number.isInteger(n) &&
      n >= LOCK_HOURS_MIN &&
      n <= LOCK_HOURS_MAX
    ) {
      setLockHoursText(null);
      set("courtLockHoursBefore", n);
    } else {
      setLockHoursText(raw);
    }
  }
  function blurLockHours() {
    if (lockHoursText === null) return;
    const n = Number(lockHoursText);
    if (lockHoursText.trim() === "" || !Number.isFinite(n)) {
      reset("courtLockHoursBefore");
    } else {
      set(
        "courtLockHoursBefore",
        Math.min(LOCK_HOURS_MAX, Math.max(LOCK_HOURS_MIN, Math.round(n))),
      );
    }
    setLockHoursText(null);
  }

  function blurHotline(raw: string) {
    // Dùng đúng hàm registry export ra, không chép lại regex.
    set("contactHotline", normalizeContactHotline(raw));
  }

  return (
    <SectionCard tone="slate" icon={Cog} title={t("operations")}>
      <div className="space-y-3">
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

        <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">{t("exchangeEnabled")}</div>
            <p className="text-muted-foreground text-xs">
              {t("exchangeEnabledHint")}
            </p>
          </div>
          <Switch
            checked={get("exchangeEnabled")}
            onCheckedChange={(v) => set("exchangeEnabled", v)}
            aria-label={t("exchangeEnabled")}
          />
        </div>

        <div className="space-y-3 border-t pt-3">
          <div className="text-sm font-medium">{t("notificationsTitle")}</div>
          <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">
                {t("notificationsEnabled")}
              </div>
              <p className="text-muted-foreground text-xs">
                {t("notificationsEnabledHint")}
              </p>
            </div>
            <Switch
              checked={get("notificationsEnabled")}
              onCheckedChange={(v) => set("notificationsEnabled", v)}
              aria-label={t("notificationsEnabled")}
            />
          </div>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t("zaloGroupUrl")}
            </span>
            <Input
              value={badZaloText ?? get("zaloGroupUrl")}
              type="url"
              inputMode="url"
              placeholder="https://zalo.me/g/..."
              className="min-h-11"
              aria-label={t("zaloGroupUrl")}
              aria-invalid={badZaloText !== null}
              onChange={(e) => changeZalo(e.target.value)}
            />
            {badZaloText !== null ? (
              <span className="text-destructive mt-1 block text-xs">
                {t("zaloGroupUrlInvalid")}
              </span>
            ) : (
              <span className="text-muted-foreground mt-1 block text-xs">
                {t("zaloGroupUrlHint")}
              </span>
            )}
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t("courtLockHoursBefore")}
            </span>
            <Input
              value={lockHoursText ?? String(get("courtLockHoursBefore"))}
              type="number"
              inputMode="numeric"
              min={LOCK_HOURS_MIN}
              max={LOCK_HOURS_MAX}
              aria-label={t("courtLockHoursBefore")}
              className="min-h-11"
              onChange={(e) => changeLockHours(e.target.value)}
              onBlur={blurLockHours}
            />
            <span className="text-muted-foreground mt-1 block text-xs">
              {t("courtLockHoursBeforeHint")}
            </span>
          </label>
        </div>

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
