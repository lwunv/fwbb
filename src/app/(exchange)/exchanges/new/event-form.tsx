"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Controller,
  useForm,
  useWatch,
  type FieldErrors,
  type Resolver,
} from "react-hook-form";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { ChevronDown, Loader2 } from "lucide-react";
import { createExchangeEvent } from "@/actions/exchange-events";
import {
  eventFormSchema,
  RESERVE_RELEASES,
  type EventForm as EventFormOutput,
  type EventFormInput,
} from "@/lib/exchange/event-schema";
import {
  MAX_FEE_PER_HEAD,
  MAX_HOST_HEADS,
  MAX_SLOTS,
  TS_OPEN,
  type FeeMode,
} from "@/lib/exchange/constants";
import type { ExchangeFeeConfig } from "@/lib/exchange-fee";
import { SKILL_LEVELS } from "@/lib/skill-level";
import { VN_BANKS } from "@/lib/vn-banks";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { NumberStepper } from "@/components/ui/number-stepper";
import { CustomSelect } from "@/components/ui/custom-select";
import { MoneyInput } from "@/components/shared/money-input";
import { TurnstileWidget } from "@/components/security/turnstile-widget";
import { FeePreview } from "./fee-preview";
import { VenuePicker, type PickedVenue } from "./venue-picker";

type Payout = { bankBin: string; accountNo: string; accountName: string };

/**
 * Giá trị form ở dạng PHẲNG: `eventFormSchema` là union theo `feeMode`, nhưng
 * form giữ đủ mọi trường để đổi cách thu phí không mất số đã gõ. Zod lọc lại
 * theo từng biến thể khi gửi.
 */
type FormValues = Omit<
  Extract<EventFormInput, { feeMode: "fixed" }>,
  "feeMode" | "feeAmountMale"
> & {
  feeMode: FeeMode;
  feeAmountMale: number;
  feeAmountFemale: number;
  estimatedTotalCost: number;
  minHeads: number;
  feeFemalePercent: number;
};

const FEE_MODES: { value: FeeMode; key: string }[] = [
  { value: "fixed", key: "modeFixed" },
  { value: "fixed_gender", key: "modeFixedGender" },
  { value: "split_equal", key: "modeSplitEqual" },
  { value: "split_female_discount", key: "modeSplitFemale" },
];

const RELEASE_KEYS = {
  deadline: "releaseDeadline",
  h24: "releaseH24",
  h6: "releaseH6",
  never: "releaseNever",
} as const;

/** Trường nằm trong phần "Tuỳ chọn thêm": lỗi ở đây phải tự mở phần đó ra. */
const EXTRA_FIELDS = new Set([
  "skillMin",
  "skillMax",
  "femaleReservedSlots",
  "reserveRelease",
  "hostHeads",
  "allowPlusOnes",
  "depositAmount",
  "autoApprove",
  "registerDeadlineHours",
  "cancelDeadlineHours",
  "hostContact",
  "zaloGroupLink",
  "shuttleType",
  "description",
  "payoutBankBin",
  "payoutAccountNo",
  "payoutAccountName",
]);

const FIELD_MESSAGES = {
  endBeforeStart: "fieldEndBeforeStart",
  tooMany: "fieldTooMany",
  skillRange: "fieldSkillRange",
  payout: "fieldPayout",
  required: "fieldRequired",
} as const;

const selectClass =
  "bg-background min-h-11 w-full rounded-lg border px-3 text-base";

function Field({
  label,
  htmlFor,
  error,
  errorId,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  /** Id cho dòng lỗi, để control không phải input nối vào bằng aria-describedby. */
  errorId?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const labelClass = "block text-sm font-medium";
  return (
    <div className={cn("space-y-1.5", className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClass}>
          {label}
        </label>
      ) : (
        <span className={labelClass}>{label}</span>
      )}
      {children}
      {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card/80 space-y-4 rounded-2xl border p-4 backdrop-blur"
    >
      {children}
    </motion.section>
  );
}

/**
 * Form mở buổi giao lưu. Không optimistic (quyết định 18): tạo buổi cấp mã
 * công khai nên phải chờ server. Gọi action thẳng, không qua `fireAction`: token
 * Turnstile dùng một lần nên không được tự gửi lại cùng closure. `idempotencyKey`
 * sinh một lần mỗi lần mở form để gửi lại sau lỗi mạng không tạo buổi thứ hai.
 */
export function EventForm({ initialPayout }: { initialPayout: Payout | null }) {
  const t = useTranslations("exchange.form");
  const tSkill = useTranslations("me.skillShort");
  const router = useRouter();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [venue, setVenue] = useState<PickedVenue | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  // R16: nữ được giảm theo % HOẶC số tiền cố định; chỉ gửi một trong hai.
  const [femaleKind, setFemaleKind] = useState<"percent" | "fixed">("percent");

  const form = useForm<FormValues, unknown, EventFormOutput>({
    resolver: zodResolver(eventFormSchema) as unknown as Resolver<
      FormValues,
      unknown,
      EventFormOutput
    >,
    defaultValues: {
      venueId: 0,
      date: "",
      startTime: "19:00",
      endTime: "21:00",
      title: "",
      description: "",
      skillMin: null,
      skillMax: null,
      slotsTotal: 8,
      femaleReservedSlots: 0,
      reserveRelease: "never",
      hostHeads: 1,
      shuttleType: "",
      depositAmount: 0,
      registerDeadlineHours: 2,
      cancelDeadlineHours: 12,
      autoApprove: false,
      allowPlusOnes: false,
      payoutBankBin: initialPayout?.bankBin ?? "",
      payoutAccountNo: initialPayout?.accountNo ?? "",
      payoutAccountName: initialPayout?.accountName ?? "",
      hostContact: "",
      zaloGroupLink: "",
      turnstileToken: "",
      idempotencyKey,
      feeMode: "fixed",
      feeAmountMale: 0,
      feeAmountFemale: 0,
      estimatedTotalCost: 0,
      minHeads: 6,
      feeFemalePercent: 50,
    },
  });
  const { register, control, setValue, handleSubmit, formState } = form;
  const { errors } = formState;
  const v = useWatch({ control });

  const feeMode = v.feeMode ?? "fixed";
  const deposit = v.depositAmount ?? 0;
  const hasDeposit = deposit > 0;
  const splits =
    feeMode === "split_equal" || feeMode === "split_female_discount";

  // Ruling R1: buổi có cọc luôn duyệt thủ công. Tắt cả giá trị đã bật trước đó,
  // không chỉ khoá công tắc, để server không nhận autoApprove true kèm cọc.
  useEffect(() => {
    if (hasDeposit && v.autoApprove) setValue("autoApprove", false);
  }, [hasDeposit, v.autoApprove, setValue]);

  const onToken = useCallback(
    (tk: string | null) => {
      setToken(tk);
      setValue("turnstileToken", tk ?? "");
    },
    [setValue],
  );

  const msg = (e?: { message?: string }) => {
    if (!e) return undefined;
    const key = FIELD_MESSAGES[e.message as keyof typeof FIELD_MESSAGES];
    return t(key ?? "fieldInvalid");
  };

  const cfg: ExchangeFeeConfig = {
    feeMode,
    feeAmountMale: v.feeAmountMale ?? 0,
    feeAmountFemale:
      feeMode === "fixed_gender" ||
      (feeMode === "split_female_discount" && femaleKind === "fixed")
        ? (v.feeAmountFemale ?? 0)
        : null,
    feeFemalePercent:
      feeMode === "split_female_discount" && femaleKind === "percent"
        ? (v.feeFemalePercent ?? 0)
        : null,
    estimatedTotalCost: v.estimatedTotalCost ?? 0,
    minHeads: v.minHeads ?? 0,
    hostHeads: v.hostHeads ?? 0,
  };

  async function onValid(values: EventFormOutput) {
    if (pending) return;
    setPending(true);
    let navigating = false;
    try {
      const payload =
        values.feeMode === "split_female_discount"
          ? femaleKind === "fixed"
            ? { ...values, feeFemalePercent: undefined }
            : { ...values, feeAmountFemale: undefined }
          : values;
      const res = await createExchangeEvent({
        ...payload,
        autoApprove: values.depositAmount > 0 ? false : values.autoApprove,
      });
      if ("error" in res) {
        // Lỗi server đã dịch sẵn: hiện nguyên văn, giữ form để sửa và gửi lại.
        toast.error(res.error);
      } else {
        navigating = true;
        router.push(`/exchanges/${res.data.code}`);
      }
    } catch {
      toast.error(t("submitFailed"));
    } finally {
      if (!navigating) setPending(false);
      // Token Turnstile dùng một lần: thành công hay lỗi đều phải xin token mới.
      setResetKey((k) => k + 1);
    }
  }

  function onInvalid(errs: FieldErrors<FormValues>) {
    toast.error(t("invalid"));
    if (Object.keys(errs).some((k) => EXTRA_FIELDS.has(k))) setShowMore(true);
  }

  const bankOptions = VN_BANKS.filter((b) => b.transferSupported).map((b) => ({
    value: b.bin,
    label: b.shortName,
  }));

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onValid, onInvalid)}
      className="space-y-4"
    >
      <Card>
        <Field
          label={t("venue")}
          error={errors.venueId ? t("fieldVenue") : undefined}
          errorId={id("venue-error")}
        >
          <VenuePicker
            value={venue}
            invalid={!!errors.venueId}
            errorId={id("venue-error")}
            onChange={(picked) => {
              setVenue(picked);
              setValue("venueId", picked.id, {
                shouldValidate: formState.isSubmitted,
              });
            }}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t("date")}
            htmlFor={id("date")}
            error={msg(errors.date)}
            className="col-span-2 sm:col-span-1"
          >
            <Input
              id={id("date")}
              type="date"
              className="min-h-11 text-base"
              {...register("date")}
            />
          </Field>
          <Field
            label={t("startTime")}
            htmlFor={id("start")}
            error={msg(errors.startTime)}
          >
            <Input
              id={id("start")}
              type="time"
              className="min-h-11 text-base"
              {...register("startTime")}
            />
          </Field>
          <Field
            label={t("endTime")}
            htmlFor={id("end")}
            error={msg(errors.endTime)}
          >
            <Input
              id={id("end")}
              type="time"
              className="min-h-11 text-base"
              {...register("endTime")}
            />
          </Field>
        </div>

        <Field
          label={t("eventTitle")}
          htmlFor={id("title")}
          error={msg(errors.title)}
        >
          <Input
            id={id("title")}
            className="min-h-11 text-base"
            maxLength={80}
            placeholder={t("eventTitlePlaceholder")}
            {...register("title")}
          />
        </Field>

        <Field label={t("slots")} error={msg(errors.slotsTotal)}>
          <Controller
            control={control}
            name="slotsTotal"
            render={({ field }) => (
              <NumberStepper
                value={field.value}
                onChange={field.onChange}
                min={1}
                max={MAX_SLOTS}
                inputAriaLabel={t("slots")}
              />
            )}
          />
        </Field>
      </Card>

      <Card>
        <div
          role="radiogroup"
          aria-label={t("feeMode")}
          className="grid grid-cols-2 gap-2"
        >
          {FEE_MODES.map((m) => {
            const active = feeMode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setValue("feeMode", m.value)}
                className={cn(
                  "min-h-12 rounded-xl border px-3 py-2 text-center text-base font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-accent",
                )}
              >
                {t(m.key)}
              </button>
            );
          })}
        </div>

        {feeMode === "fixed" && (
          <Field label={t("amount")} error={msg(errors.feeAmountMale)}>
            <MoneyInput
              aria-label={t("amount")}
              suffix="₫"
              value={v.feeAmountMale ?? 0}
              onCommit={(n) =>
                setValue("feeAmountMale", Math.min(n, MAX_FEE_PER_HEAD))
              }
            />
          </Field>
        )}

        {feeMode === "fixed_gender" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("amountMale")} error={msg(errors.feeAmountMale)}>
              <MoneyInput
                aria-label={t("amountMale")}
                suffix="₫"
                value={v.feeAmountMale ?? 0}
                onCommit={(n) =>
                  setValue("feeAmountMale", Math.min(n, MAX_FEE_PER_HEAD))
                }
              />
            </Field>
            <Field
              label={t("amountFemale")}
              error={msg((errors as FieldErrors<FormValues>).feeAmountFemale)}
            >
              <MoneyInput
                aria-label={t("amountFemale")}
                suffix="₫"
                value={v.feeAmountFemale ?? 0}
                onCommit={(n) =>
                  setValue("feeAmountFemale", Math.min(n, MAX_FEE_PER_HEAD))
                }
              />
            </Field>
          </div>
        )}

        {splits && (
          <div className="space-y-4">
            <Field
              label={t("totalCost")}
              error={msg(errors.estimatedTotalCost)}
            >
              <MoneyInput
                aria-label={t("totalCost")}
                suffix="₫"
                value={v.estimatedTotalCost ?? 0}
                onCommit={(n) => setValue("estimatedTotalCost", n)}
              />
            </Field>
            <Field label={t("minHeads")} error={msg(errors.minHeads)}>
              <Controller
                control={control}
                name="minHeads"
                render={({ field }) => (
                  <NumberStepper
                    value={field.value}
                    onChange={field.onChange}
                    min={1}
                    max={MAX_SLOTS}
                    inputAriaLabel={t("minHeads")}
                  />
                )}
              />
            </Field>
            {feeMode === "split_female_discount" && (
              <div
                role="radiogroup"
                aria-label={t("modeSplitFemale")}
                className="grid grid-cols-2 gap-2"
              >
                {(["percent", "fixed"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={femaleKind === k}
                    onClick={() => setFemaleKind(k)}
                    className={cn(
                      "min-h-11 rounded-xl border px-3 py-2 text-base font-medium transition-colors",
                      femaleKind === k
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-accent",
                    )}
                  >
                    {t(
                      k === "percent" ? "femaleKindPercent" : "femaleKindFixed",
                    )}
                  </button>
                ))}
              </div>
            )}
            {feeMode === "split_female_discount" && femaleKind === "fixed" && (
              <Field
                label={t("amountFemaleFixed")}
                error={msg(errors.feeAmountFemale)}
              >
                <MoneyInput
                  aria-label={t("amountFemaleFixed")}
                  suffix="₫"
                  value={v.feeAmountFemale ?? 0}
                  onCommit={(n) =>
                    setValue("feeAmountFemale", Math.min(n, MAX_FEE_PER_HEAD))
                  }
                />
              </Field>
            )}
            {feeMode === "split_female_discount" &&
              femaleKind === "percent" && (
                <Field
                  label={t("femalePercent")}
                  error={msg(errors.feeFemalePercent)}
                >
                  <Controller
                    control={control}
                    name="feeFemalePercent"
                    render={({ field }) => (
                      <NumberStepper
                        value={field.value}
                        onChange={field.onChange}
                        min={0}
                        max={100}
                        step={5}
                        inputAriaLabel={t("femalePercent")}
                      />
                    )}
                  />
                </Field>
              )}
          </div>
        )}
      </Card>

      <FeePreview cfg={cfg} />

      <Card>
        <button
          type="button"
          aria-expanded={showMore}
          onClick={() => setShowMore((s) => !s)}
          className="flex min-h-11 w-full items-center justify-between text-base font-semibold"
        >
          {showMore ? t("lessOptions") : t("moreOptions")}
          <ChevronDown
            className={cn(
              "h-5 w-5 transition-transform",
              showMore && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        <AnimatePresence initial={false}>
          {showMore && (
            <motion.div
              key="more"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="space-y-4 overflow-hidden"
            >
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={t("skillMin")}
                  htmlFor={id("skillMin")}
                  error={msg(errors.skillMin)}
                >
                  <select
                    id={id("skillMin")}
                    className={selectClass}
                    {...register("skillMin", {
                      setValueAs: (x: string) => (x === "" ? null : x),
                    })}
                  >
                    <option value="">{t("skillAny")}</option>
                    {SKILL_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {tSkill(l)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("skillMax")} htmlFor={id("skillMax")}>
                  <select
                    id={id("skillMax")}
                    className={selectClass}
                    {...register("skillMax", {
                      setValueAs: (x: string) => (x === "" ? null : x),
                    })}
                  >
                    <option value="">{t("skillAny")}</option>
                    {SKILL_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {tSkill(l)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field
                label={t("femaleSlots")}
                error={msg(errors.femaleReservedSlots)}
              >
                <Controller
                  control={control}
                  name="femaleReservedSlots"
                  render={({ field }) => (
                    <NumberStepper
                      value={field.value ?? 0}
                      onChange={field.onChange}
                      min={0}
                      max={v.slotsTotal ?? MAX_SLOTS}
                      inputAriaLabel={t("femaleSlots")}
                    />
                  )}
                />
              </Field>
              {(v.femaleReservedSlots ?? 0) > 0 && (
                <Field label={t("reserveRelease")} htmlFor={id("release")}>
                  <select
                    id={id("release")}
                    className={selectClass}
                    {...register("reserveRelease")}
                  >
                    {RESERVE_RELEASES.map((r) => (
                      <option key={r} value={r}>
                        {t(RELEASE_KEYS[r])}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <Field label={t("hostHeads")} error={msg(errors.hostHeads)}>
                <Controller
                  control={control}
                  name="hostHeads"
                  render={({ field }) => (
                    <NumberStepper
                      value={field.value ?? 0}
                      onChange={field.onChange}
                      min={0}
                      max={MAX_HOST_HEADS}
                      inputAriaLabel={t("hostHeads")}
                    />
                  )}
                />
              </Field>

              <div className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-base">{t("allowPlusOnes")}</span>
                <Controller
                  control={control}
                  name="allowPlusOnes"
                  render={({ field }) => (
                    <Switch
                      aria-label={t("allowPlusOnes")}
                      checked={!!field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>

              <Field label={t("deposit")} error={msg(errors.depositAmount)}>
                <MoneyInput
                  aria-label={t("deposit")}
                  suffix="₫"
                  value={deposit}
                  onCommit={(n) =>
                    setValue("depositAmount", Math.min(n, MAX_FEE_PER_HEAD))
                  }
                />
              </Field>

              <div className="space-y-1">
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <span className="text-base">{t("autoApprove")}</span>
                  <Controller
                    control={control}
                    name="autoApprove"
                    render={({ field }) => (
                      <Switch
                        aria-label={t("autoApprove")}
                        checked={!hasDeposit && !!field.value}
                        disabled={hasDeposit}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </div>
                {hasDeposit && (
                  <p className="text-muted-foreground text-sm">
                    {t("autoApproveDepositHint")}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={t("registerDeadline")}
                  error={msg(errors.registerDeadlineHours)}
                >
                  <Controller
                    control={control}
                    name="registerDeadlineHours"
                    render={({ field }) => (
                      <NumberStepper
                        value={field.value ?? 0}
                        onChange={field.onChange}
                        min={0}
                        max={72}
                        inputAriaLabel={t("registerDeadline")}
                      />
                    )}
                  />
                </Field>
                <Field
                  label={t("cancelDeadline")}
                  error={msg(errors.cancelDeadlineHours)}
                >
                  <Controller
                    control={control}
                    name="cancelDeadlineHours"
                    render={({ field }) => (
                      <NumberStepper
                        value={field.value ?? 0}
                        onChange={field.onChange}
                        min={0}
                        max={72}
                        inputAriaLabel={t("cancelDeadline")}
                      />
                    )}
                  />
                </Field>
              </div>

              <Field
                label={t("hostContact")}
                htmlFor={id("contact")}
                error={msg(errors.hostContact)}
              >
                <Input
                  id={id("contact")}
                  inputMode="tel"
                  className="min-h-11 text-base"
                  maxLength={100}
                  {...register("hostContact")}
                />
              </Field>
              <Field
                label={t("zaloGroup")}
                htmlFor={id("zalo")}
                error={msg(errors.zaloGroupLink)}
              >
                <Input
                  id={id("zalo")}
                  inputMode="url"
                  className="min-h-11 text-base"
                  maxLength={200}
                  {...register("zaloGroupLink")}
                />
              </Field>
              <Field label={t("shuttle")} htmlFor={id("shuttle")}>
                <Input
                  id={id("shuttle")}
                  className="min-h-11 text-base"
                  maxLength={60}
                  {...register("shuttleType")}
                />
              </Field>
              <Field label={t("description")} htmlFor={id("desc")}>
                <textarea
                  id={id("desc")}
                  rows={3}
                  maxLength={2000}
                  className="bg-background w-full rounded-lg border px-3 py-2 text-base"
                  {...register("description")}
                />
              </Field>

              <fieldset className="space-y-3 rounded-xl border p-3">
                <legend className="px-1 text-sm font-semibold">
                  {t("payoutTitle")}
                </legend>
                <p className="text-muted-foreground text-sm">
                  {t("payoutHint")}
                </p>
                <Field label={t("bank")} error={msg(errors.payoutBankBin)}>
                  <CustomSelect
                    options={bankOptions}
                    value={v.payoutBankBin ?? ""}
                    onChange={(bin) => setValue("payoutBankBin", bin)}
                    placeholder={t("bankPlaceholder")}
                    searchable
                    searchPlaceholder={t("bankSearch")}
                  />
                </Field>
                <Field label={t("accountNo")} htmlFor={id("accNo")}>
                  <Input
                    id={id("accNo")}
                    inputMode="numeric"
                    className="min-h-11 text-base"
                    maxLength={20}
                    {...register("payoutAccountNo")}
                  />
                </Field>
                <Field label={t("accountName")} htmlFor={id("accName")}>
                  <Input
                    id={id("accName")}
                    className="min-h-11 text-base uppercase"
                    maxLength={50}
                    autoCapitalize="characters"
                    {...register("payoutAccountName")}
                  />
                </Field>
              </fieldset>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      <div className="space-y-1">
        <TurnstileWidget
          action={TS_OPEN}
          onToken={onToken}
          resetKey={resetKey}
        />
        {!token && (
          <p className="text-muted-foreground text-sm">{t("captchaWaiting")}</p>
        )}
      </div>

      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <motion.button
          type="submit"
          whileTap={{ scale: 0.98 }}
          disabled={pending || !token}
          className="bg-primary text-primary-foreground flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-medium disabled:opacity-60 sm:w-auto sm:px-8"
        >
          {pending && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
          {pending ? t("submitting") : t("submit")}
        </motion.button>
      </div>
    </form>
  );
}
