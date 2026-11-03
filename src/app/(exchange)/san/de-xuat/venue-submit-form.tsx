"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { submitVenue } from "@/actions/venues";
import { Button } from "@/components/ui/button";
import { BaseModal } from "@/components/shared/base-modal";
import {
  VenueForm,
  type VenueFormValues,
} from "@/components/venues/venue-form";

/**
 * Không dùng `fireAction` (optimistic): kết quả server quyết định bước tiếp
 * theo (trùng sân thì hỏi lại, lỗi toạ độ thì sửa link), nên phải chờ phản
 * hồi. Nút gửi có trạng thái đang gửi trong `VenueForm`.
 */
export function VenueSubmitForm() {
  const t = useTranslations("venues");
  const router = useRouter();
  const [dup, setDup] = useState<{
    id: number;
    name: string;
    distanceM: number;
    isPublic: boolean;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const pending = useRef<VenueFormValues | null>(null);

  async function send(values: VenueFormValues) {
    pending.current = values;
    let r: Awaited<ReturnType<typeof submitVenue>>;
    try {
      r = await submitVenue(values);
    } catch {
      // Mất mạng hoặc server lỗi: phải báo, không để nút bấm xong im lặng.
      toast.error(t("saveFailed"));
      return;
    }
    if ("duplicate" in r) {
      setDup(r.duplicate);
      return;
    }
    if ("error" in r) {
      toast.error(r.error);
      return;
    }
    toast.success(t("submittedToast"));
    router.push("/san");
  }

  return (
    <>
      <VenueForm submitLabel={t("submit")} onSubmit={send} />
      <BaseModal open={dup !== null} onClose={() => setDup(null)}>
        {dup && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t("duplicateTitle")}</h2>
            <p className="text-base">
              {t("duplicateBody", { name: dup.name, meters: dup.distanceM })}
            </p>
            <div className="flex flex-col gap-2">
              <Button
                className="min-h-11"
                disabled={sending}
                onClick={async () => {
                  if (!pending.current) return;
                  setSending(true);
                  try {
                    setDup(null);
                    await send({ ...pending.current, confirmDuplicate: true });
                  } finally {
                    setSending(false);
                  }
                }}
              >
                {t("submitAnyway")}
              </Button>
              {dup.isPublic && (
                <Link
                  href={`/san/${dup.id}`}
                  className="bg-card inline-flex min-h-11 items-center justify-center rounded-lg border text-sm font-medium"
                >
                  {t("viewThatVenue")}
                </Link>
              )}
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={() => setDup(null)}
              >
                {t("cancel")}
              </Button>
            </div>
          </div>
        )}
      </BaseModal>
    </>
  );
}
