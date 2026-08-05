"use client";

import { useState } from "react";
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

// Chỉ liệt kê ngân hàng hỗ trợ nhận chuyển khoản qua VietQR — ngân hàng
// không hỗ trợ vẫn nằm trong VN_BANKS (để tra BIN cũ) nhưng không có nghĩa
// để chọn ở đây.
const BANK_OPTIONS = VN_BANKS.filter((b) => b.transferSupported).map((b) => ({
  value: b.bin,
  label: b.shortName,
}));

export function SectionOperations({ settings }: { settings: AppSettings }) {
  const t = useTranslations("adminSettings");
  const [autoCreate, setAutoCreate] = useState(settings.autoCreateSessions);
  const [appName, setAppName] = useState(settings.appName);
  const [bankBin, setBankBin] = useState(settings.bankBin);
  const [bankAccountNo, setBankAccountNo] = useState(settings.bankAccountNo);
  const [bankAccountName, setBankAccountName] = useState(
    settings.bankAccountName,
  );

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

  function commitBankBin(next: string) {
    const prev = bankBin;
    setBankBin(next);
    fireAction(
      () => updateSetting("bankBin", next),
      () => setBankBin(prev),
    );
  }

  // Ghi lúc rời ô (onBlur), không phải mỗi ký tự — tránh spam server action
  // lúc đang gõ dở số tài khoản. Lỗi từ server (BIN sai/số không hợp lệ)
  // không bao giờ echo lại giá trị người dùng gõ (xem message trong registry).
  function commitBankAccountNo(next: string) {
    const trimmed = next.trim();
    const prev = bankAccountNo;
    setBankAccountNo(trimmed);
    fireAction(
      () => updateSetting("bankAccountNo", trimmed),
      () => setBankAccountNo(prev),
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">
                {t("bankAccountNo")}
              </span>
              <Input
                value={bankAccountNo}
                inputMode="numeric"
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
