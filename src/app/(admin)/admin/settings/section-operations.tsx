"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Cog } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CustomSelect } from "@/components/ui/custom-select";
import { fireAction } from "@/lib/optimistic-action";
import { updateSetting } from "@/actions/settings";
import type { AppSettings } from "@/lib/settings-registry";
import { VN_BANKS } from "@/lib/vn-banks";
import { AUTO_MATCH_BANK_BIN } from "@/lib/bank-account";

// Chỉ liệt kê ngân hàng hỗ trợ nhận chuyển khoản qua VietQR — ngân hàng
// không hỗ trợ vẫn nằm trong VN_BANKS (để tra BIN cũ) nhưng không có nghĩa
// để chọn ở đây.
const BANK_OPTIONS = VN_BANKS.filter((b) => b.transferSupported).map((b) => ({
  value: b.bin,
  label: b.shortName,
}));

export function SectionOperations({ settings }: { settings: AppSettings }) {
  const t = useTranslations("adminSettings");
  // Tách từng field ra biến phẳng trước khi dùng trong effect —
  // react-hooks/set-state-in-effect không nhận diện `settings.foo` (member
  // expression) là một dependency ổn định để sync, chỉ nhận identifier phẳng.
  const {
    autoCreateSessions,
    appName: appNameSetting,
    bankBin: bankBinSetting,
    bankAccountNo: bankAccountNoSetting,
    bankAccountName: bankAccountNameSetting,
  } = settings;

  const [autoCreate, setAutoCreate] = useState(autoCreateSessions);
  const [appName, setAppName] = useState(appNameSetting);
  const [bankBin, setBankBin] = useState(bankBinSetting);
  const [bankAccountNo, setBankAccountNo] = useState(bankAccountNoSetting);
  const [bankAccountName, setBankAccountName] = useState(
    bankAccountNameSetting,
  );

  // Sync khi server revalidate (settings đổi từ nơi khác, hoặc sau khi action
  // của chính component này resolve và router.refresh() props mới về) — 5 ô
  // của section này đều mirror prop server nên phải tự đồng bộ lại, xem mẫu
  // MaxPlayersToggle.
  useEffect(() => {
    setAutoCreate(autoCreateSessions);
  }, [autoCreateSessions]);
  useEffect(() => {
    setAppName(appNameSetting);
  }, [appNameSetting]);
  useEffect(() => {
    setBankBin(bankBinSetting);
  }, [bankBinSetting]);
  useEffect(() => {
    setBankAccountNo(bankAccountNoSetting);
  }, [bankAccountNoSetting]);
  useEffect(() => {
    setBankAccountName(bankAccountNameSetting);
  }, [bankAccountNameSetting]);

  function toggleAutoCreate(next: boolean) {
    const prev = autoCreate;
    setAutoCreate(next);
    fireAction(
      () => updateSetting("autoCreateSessions", next),
      () => setAutoCreate(prev),
    );
  }

  function commitAppName(next: string) {
    const trimmed = next.trim();
    if (!trimmed) return;
    const prev = appName;
    setAppName(next);
    fireAction(
      () => updateSetting("appName", trimmed),
      () => setAppName(prev),
    );
  }

  // retry: false — lỗi ở đây (BIN không có trong danh bạ VN_BANKS) là lỗi
  // validate xác định từ input, gọi lại y hệt chắc chắn lỗi lần hai. Retry
  // mặc định chỉ có ý nghĩa với lỗi tạm thời (mạng/server), không phải lỗi
  // do dữ liệu nhập sai.
  function commitBankBin(next: string) {
    const prev = bankBin;
    setBankBin(next);
    fireAction(
      () => updateSetting("bankBin", next),
      () => setBankBin(prev),
      { retry: false },
    );
  }

  // Ghi lúc rời ô (onBlur), không phải mỗi ký tự — tránh spam server action
  // lúc đang gõ dở số tài khoản. Lỗi từ server (BIN sai/số không hợp lệ)
  // không bao giờ echo lại giá trị người dùng gõ (xem message trong registry).
  // retry: false — cùng lý do commitBankBin, số không khớp regex 6-20 chữ số
  // thì gọi lại vẫn lỗi y hệt.
  function commitBankAccountNo(next: string) {
    const trimmed = next.trim();
    const prev = bankAccountNo;
    setBankAccountNo(trimmed);
    fireAction(
      () => updateSetting("bankAccountNo", trimmed),
      () => setBankAccountNo(prev),
      { retry: false },
    );
  }

  function commitBankAccountName(next: string) {
    const trimmed = next.trim();
    const prev = bankAccountName;
    setBankAccountName(trimmed);
    fireAction(
      () => updateSetting("bankAccountName", trimmed),
      () => setBankAccountName(prev),
    );
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
          <Switch checked={autoCreate} onCheckedChange={toggleAutoCreate} />
        </div>
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t("appName")}
          </span>
          <Input
            value={appName}
            className="min-h-11"
            onChange={(e) => setAppName(e.target.value)}
            onBlur={(e) => commitAppName(e.target.value)}
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
              onChange={commitBankBin}
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
                onChange={(e) => setBankAccountNo(e.target.value)}
                onBlur={(e) => commitBankAccountNo(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                {t("bankAccountName")}
              </span>
              <Input
                value={bankAccountName}
                className="min-h-11"
                onChange={(e) => setBankAccountName(e.target.value)}
                onBlur={(e) => commitBankAccountName(e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
