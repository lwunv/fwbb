"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { increaseSlots } from "@/actions/exchange-host";
import { updateExchangeEvent } from "@/actions/exchange-events";
import { ResponsiveSheet } from "@/components/exchange/responsive-sheet";
import { CustomSelect } from "@/components/ui/custom-select";
import { Input } from "@/components/ui/input";
import { MAX_SLOTS } from "@/lib/exchange/constants";
import { fireAction } from "@/lib/optimistic-action";
import { VN_BANKS } from "@/lib/vn-banks";

const bankOptions = VN_BANKS.filter((b) => b.transferSupported).map((b) => ({
  value: b.bin,
  label: b.shortName,
}));

/**
 * Sửa buổi đang mở: tăng slot, mô tả, liên hệ, link Zalo và tài khoản nhận
 * tiền. Giờ, sân và cách tính phí không sửa được sau khi mở. Đóng ngay rồi gửi
 * nền (lạc quan); lỗi thì hoàn lại số slot đã hiện và báo bằng toast.
 */
export function EditEventSheet({
  open,
  onOpenChange,
  eventId,
  slotsTotal,
  description,
  hostContact,
  zaloGroupLink,
  onSlots,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number;
  slotsTotal: number;
  description: string;
  hostContact: string;
  zaloGroupLink: string;
  onSlots: (slots: number) => void;
  onSaved: () => void;
}) {
  const t = useTranslations("exchange.manage");
  const [slots, setSlots] = useState(String(slotsTotal));
  const [desc, setDesc] = useState(description);
  const [contact, setContact] = useState(hostContact);
  const [zalo, setZalo] = useState(zaloGroupLink);
  const [bank, setBank] = useState("");
  const [accNo, setAccNo] = useState("");
  const [accName, setAccName] = useState("");

  const slotsNum = Number(slots);
  const slotsValid =
    Number.isInteger(slotsNum) &&
    slotsNum >= slotsTotal &&
    slotsNum <= MAX_SLOTS;

  function save() {
    if (!slotsValid) return;
    const raiseSlots = slotsNum > slotsTotal;
    const payout =
      bank && accNo.trim() && accName.trim()
        ? {
            bankBin: bank,
            accountNo: accNo.trim(),
            accountName: accName.trim().toUpperCase(),
          }
        : undefined;
    onOpenChange(false);
    if (raiseSlots) onSlots(slotsNum);
    // Không retry: `increaseSlots` chỉ chạy khi slot mới lớn hơn slot hiện có.
    fireAction(
      async () => {
        if (raiseSlots) {
          const r = await increaseSlots({ eventId, slotsTotal: slotsNum });
          if ("error" in r) return r;
        }
        return updateExchangeEvent({
          eventId,
          description: desc,
          hostContact: contact,
          zaloGroupLink: zalo,
          ...(payout ? { payout } : {}),
        });
      },
      () => onSlots(slotsTotal),
      { retry: false, onSuccess: onSaved },
    );
  }

  const field = "space-y-2 block";
  const input = "min-h-11 text-base";

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("editTitle")}
      footer={
        <button
          type="button"
          disabled={!slotsValid}
          onClick={save}
          className="bg-primary text-primary-foreground min-h-12 w-full rounded-xl text-base font-semibold disabled:opacity-50"
        >
          {t("editSave")}
        </button>
      }
    >
      <label className={field}>
        <span className="text-base font-medium">{t("editSlots")}</span>
        <Input
          inputMode="numeric"
          className={input}
          value={slots}
          onChange={(e) => setSlots(e.target.value.replace(/\D/g, ""))}
          aria-invalid={!slotsValid}
        />
      </label>
      <label className={field}>
        <span className="text-base font-medium">{t("editDescription")}</span>
        <textarea
          value={desc}
          maxLength={2000}
          rows={4}
          onChange={(e) => setDesc(e.target.value)}
          className="bg-background w-full rounded-xl border p-3 text-base"
        />
      </label>
      <label className={field}>
        <span className="text-base font-medium">{t("editContact")}</span>
        <Input
          className={input}
          maxLength={100}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
      </label>
      <label className={field}>
        <span className="text-base font-medium">{t("editZalo")}</span>
        <Input
          className={input}
          maxLength={200}
          value={zalo}
          onChange={(e) => setZalo(e.target.value)}
        />
      </label>
      <fieldset className="space-y-3 rounded-xl border p-3">
        <legend className="px-1 text-base font-semibold">
          {t("editPayout")}
        </legend>
        <div className="space-y-2">
          <span className="text-base font-medium">{t("editBank")}</span>
          <CustomSelect
            options={bankOptions}
            value={bank}
            onChange={setBank}
            placeholder={t("editBankPlaceholder")}
            searchable
            searchPlaceholder={t("editBankSearch")}
          />
        </div>
        <label className={field}>
          <span className="text-base font-medium">{t("editAccountNo")}</span>
          <Input
            inputMode="numeric"
            className={input}
            maxLength={20}
            value={accNo}
            onChange={(e) => setAccNo(e.target.value)}
          />
        </label>
        <label className={field}>
          <span className="text-base font-medium">{t("editAccountName")}</span>
          <Input
            className={`${input} uppercase`}
            maxLength={50}
            autoCapitalize="characters"
            value={accName}
            onChange={(e) => setAccName(e.target.value)}
          />
        </label>
      </fieldset>
    </ResponsiveSheet>
  );
}
