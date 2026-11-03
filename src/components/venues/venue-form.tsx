"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { Loader2 } from "lucide-react";
import { venueSubmitSchema } from "@/lib/validators";
import { VENUE_AMENITIES } from "@/lib/venue-amenities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/shared/money-input";
import { cn } from "@/lib/utils";

export type VenueFormInput = z.input<typeof venueSubmitSchema>;
export type VenueFormValues = z.output<typeof venueSubmitSchema>;

/**
 * Form sân dùng chung: member đề xuất (`/san/de-xuat`) và admin sửa
 * (`/admin/venues`). Không tự gọi server — `onSubmit` của trang quyết định
 * gọi action nào và xử lý kết quả (trùng sân, lỗi toạ độ).
 */
export function VenueForm({
  defaultValues,
  submitLabel,
  onSubmit,
}: {
  defaultValues?: Partial<VenueFormInput>;
  submitLabel: string;
  onSubmit: (values: VenueFormValues) => Promise<void>;
}) {
  const t = useTranslations("venues");
  const [showCoords, setShowCoords] = useState(
    defaultValues?.lat !== undefined && !defaultValues?.mapLink,
  );
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<VenueFormInput, unknown, VenueFormValues>({
    resolver: zodResolver(venueSubmitSchema),
    defaultValues: { amenities: [], confirmDuplicate: false, ...defaultValues },
  });

  const numberOrUndefined = (v: unknown) =>
    v === "" || v === null || v === undefined ? undefined : Number(v);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field id="venue-name" label={t("name")} error={errors.name?.message}>
        <Input id="venue-name" className="text-base" {...register("name")} />
      </Field>

      <Field
        id="venue-mapLink"
        label={t("mapLink")}
        hint={t("mapLinkHint")}
        error={errors.mapLink?.message}
      >
        <Input
          id="venue-mapLink"
          type="url"
          inputMode="url"
          placeholder="https://maps.app.goo.gl/..."
          className="text-base"
          {...register("mapLink")}
        />
      </Field>

      {showCoords ? (
        <div className="grid grid-cols-2 gap-3">
          <Field id="venue-lat" label={t("lat")} error={errors.lat?.message}>
            <Input
              id="venue-lat"
              inputMode="decimal"
              className="text-base"
              {...register("lat", { setValueAs: numberOrUndefined })}
            />
          </Field>
          <Field id="venue-lng" label={t("lng")} error={errors.lng?.message}>
            <Input
              id="venue-lng"
              inputMode="decimal"
              className="text-base"
              {...register("lng", { setValueAs: numberOrUndefined })}
            />
          </Field>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowCoords(true)}
          className="text-primary min-h-11 text-sm underline underline-offset-2"
        >
          {t("enterCoordsInstead")}
        </button>
      )}

      <Field id="venue-address" label={t("address")}>
        <Input
          id="venue-address"
          className="text-base"
          {...register("address")}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field
          id="venue-courtCount"
          label={t("courtCount")}
          error={errors.courtCount?.message}
        >
          <Input
            id="venue-courtCount"
            inputMode="numeric"
            className="text-base"
            {...register("courtCount", { setValueAs: numberOrUndefined })}
          />
        </Field>
        <Field id="venue-openHours" label={t("openHours")}>
          <Input
            id="venue-openHours"
            placeholder="5:00 - 23:00"
            className="text-base"
            {...register("openHours")}
          />
        </Field>
      </div>

      <Field
        id="venue-refPrice"
        label={t("refPricePerHour")}
        error={errors.refPricePerHour?.message}
      >
        <Controller
          control={control}
          name="refPricePerHour"
          render={({ field }) => (
            <MoneyInput
              value={field.value ?? 0}
              onCommit={(n) => field.onChange(n === 0 ? undefined : n)}
              suffix="đ"
              aria-label={t("refPricePerHour")}
            />
          )}
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("amenitiesLabel")}</legend>
        <Controller
          control={control}
          name="amenities"
          render={({ field }) => {
            const selected = field.value ?? [];
            return (
              <div className="flex flex-wrap gap-2">
                {VENUE_AMENITIES.map((a) => {
                  const on = selected.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        field.onChange(
                          on
                            ? selected.filter((x) => x !== a)
                            : [...selected, a],
                        )
                      }
                      className={cn(
                        "min-h-11 rounded-full border px-4 text-sm transition-colors",
                        on
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card/80 text-foreground hover:bg-accent",
                      )}
                    >
                      {t(`amenity.${a}`)}
                    </button>
                  );
                })}
              </div>
            );
          }}
        />
      </fieldset>

      <Field id="venue-phone" label={t("phone")} error={errors.phone?.message}>
        <Input
          id="venue-phone"
          type="tel"
          inputMode="tel"
          className="text-base"
          {...register("phone")}
        />
      </Field>

      <Field
        id="venue-photoLink"
        label={t("photoLink")}
        error={errors.photoLink?.message}
      >
        <Input
          id="venue-photoLink"
          type="url"
          inputMode="url"
          className="text-base"
          {...register("photoLink")}
        />
      </Field>

      {/* Nút chính dính đáy trên mobile, trong tầm ngón cái. */}
      <div className="bg-background/95 sticky bottom-0 -mx-4 border-t p-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:p-0">
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={isSubmitting}
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      {children}
      {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
