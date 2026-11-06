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

type Payout = { bankBin: string; accountNo: string; accountName: string };

/**
 * Sửa buổi đang mở (quyết định 9): tăng slot, tiêu đề, mô tả, loại cầu, liên
 * hệ, link Zalo và tài khoản nhận tiền. Giờ, sân và cách tính phí không sửa
 * được sau khi mở. Tài khoản nhận tiền phải đủ cả ba ô hoặc trống cả ba (trống
 * thì gửi `null` để bỏ). Đóng ngay rồi gửi nền (lạc quan); lỗi thì hoàn lại số
 * slot đã hiện và báo bằng toast.
 */
export function EditEventSheet({
  open,
  onOpenChange,
  eventId,
  slotsTotal,
  title,
  shuttleType,
  payout: currentPayout,
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
  title: string;
  shuttleType: string;
  payout: Payout | null;
  description: string;
  hostContact: string;
  zaloGroupLink: string;
  onSlots: (slots: number) => void;
  onSaved: () => void;
}) {
  const t = useTranslations("exchange.manage");
  const [slots, setSlots] = useState(String(slotsTotal));
  const [name, setName] = useState(title);
  const [shuttle, setShuttle] = useState(shuttleType);
  const [desc, setDesc] = useState(description);
  const [contact, setContact] = useState(hostContact);
  const [zalo, setZalo] = useState(zaloGroupLink);
  const [bank, setBank] = useState(currentPayout?.bankBin ?? "");
  const [accNo, setAccNo] = useState(currentPayout?.accountNo ?? "");
  const [accName, setAccName] = useState(currentPayout?.accountName ?? "");
  const [tried, setTried] = useState(false);

  const slotsNum = Number(slots);
  const slotsValid =
    Number.isInteger(slotsNum) &&
    slotsNum >= slotsTotal &&
    slotsNum <= MAX_SLOTS;
  const titleLen = name.trim().length;
  const titleValid = titleLen >= 5 && titleLen <= 80;
  const payoutFilled = [bank, accNo.trim(), accName.trim()].filter(
    Boolean,
  ).length;
  const payoutPartial = payoutFilled > 0 && payoutFilled < 3;

  function clearPayout() {
    setBank("");
    setAccNo("");
    setAccName("");
  }

  function save() {
    setTried(true);
    if (!slotsValid || !titleValid || payoutPartial) return;
    const raiseSlots = slotsNum > slotsTotal;
    // Trống cả ba: bỏ tài khoản cũ (null); chưa từng có thì không gửi gì.
    const payout: Payout | null | undefined =
      payoutFilled === 3
        ? {
            bankBin: bank,
            accountNo: accNo.trim(),
            accountName: accName.trim().toUpperCase(),
          }
        : currentPayout
          ? null
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
          title: name.trim(),
          shuttleType: shuttle.trim(),
          description: desc,
          hostContact: contact,
          zaloGroupLink: zalo,
          ...(payout !== undefined ? { payout } : {}),
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
        <span className="text-base font-medium">{t("editTitleField")}</span>
        <Input
          className={input}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={tried && !titleValid}
        />
        {tried && !titleValid && (
          <p role="alert" className="text-destructive text-base">
            {t("editTitleInvalid")}
          </p>
        )}
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
        <span className="text-base font-medium">{t("editShuttle")}</span>
        <Input
          className={input}
          maxLength={60}
          value={shuttle}
          onChange={(e) => setShuttle(e.target.value)}
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
        {tried && payoutPartial && (
          <p role="alert" className="text-destructive text-base">
            {t("editPayoutPartial")}
          </p>
        )}
        {payoutFilled > 0 && (
          <button
            type="button"
            onClick={clearPayout}
            className="text-destructive inline-flex min-h-11 items-center rounded-xl border px-4 text-base font-medium"
          >
            {t("editPayoutClear")}
          </button>
        )}
      </fieldset>
    </ResponsiveSheet>
  );
}
