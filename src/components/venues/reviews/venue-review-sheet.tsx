"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, EyeOff, Info, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  getMyVenueReview,
  submitVenueReview,
  type MyVenueReview,
} from "@/actions/venue-reviews";
import { ResponsiveSheet } from "@/components/exchange/responsive-sheet";
import { TurnstileWidget } from "@/components/security/turnstile-widget";
import { Skeleton } from "@/components/ui/skeleton";
import type { AppLocale } from "@/lib/date-fns-locale";
import { formatSessionDate, ymdInVN } from "@/lib/date-format";
import { fireAction } from "@/lib/optimistic-action";
import {
  REVIEW_COMMENT_MAX,
  REVIEW_EDIT_COOLDOWN_DAYS,
  TS_REVIEW,
  VENUE_CRITERIA,
  type VenueCriterion,
} from "@/lib/reputation/constants";
import type { VenueReviewView } from "@/lib/reputation/venue-review-read";
import { cn } from "@/lib/utils";
import { StarInput } from "./star-input";
import { VenueReviewItem } from "./venue-review-item";

/** id tạm của đánh giá mới đang gửi (id thật luôn dương). */
export const PENDING_REVIEW_ID = -1;

type Scores = Record<VenueCriterion, number>;
type FormValues = { scores: Scores; comment: string };
type OwnReview = NonNullable<MyVenueReview["review"]>;

const EMPTY_SCORES = Object.fromEntries(
  VENUE_CRITERIA.map((c) => [c, 0]),
) as Scores;

export function myVenueReviewKey(venueId: number) {
  return ["my-venue-review", venueId] as const;
}

function valuesOf(review: OwnReview | null | undefined): FormValues {
  return {
    scores: review ? { ...review.scores } : { ...EMPTY_SCORES },
    comment: review?.comment ?? "",
  };
}

function asView(review: OwnReview): VenueReviewView {
  return {
    id: review.id,
    scores: review.scores,
    comment: review.comment,
    month: review.month,
    edited: review.editedAt !== null,
  };
}

/**
 * Viết hoặc sửa đánh giá sân của chính mình. Phần riêng (đủ điều kiện, đánh
 * giá cũ, mốc sửa lại) chỉ tải khi mở sheet; server là nguồn sự thật, phiếu chỉ
 * hiện khi server nói được viết. Gửi theo kiểu optimistic: đóng sheet, báo
 * `onOptimistic` để danh sách hiện dòng "Đang gửi…" ngay; lỗi thì hoàn lại và
 * mở lại phiếu với chữ đã gõ. Token Turnstile chỉ dùng một lần nên không bao
 * giờ tự gửi lại, và sau mỗi lần gửi luôn lấy token mới.
 */
export function VenueReviewSheet({
  open,
  onOpenChange,
  venueId,
  onOptimistic,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venueId: number;
  /** Dòng tạm cho danh sách công khai; `null` để bỏ dòng tạm. */
  onOptimistic?: (row: VenueReviewView | null) => void;
}) {
  const t = useTranslations("venueReviews");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sending, setSending] = useState(false);
  // Giữ khoá khi mất phản hồi (lỗi mạng) để lần bấm lại được server trả kết quả
  // cũ thay vì thành một lần sửa; có câu trả lời rõ ràng hoặc đổi nội dung thì đổi khoá.
  const keyRef = useRef<{ sig: string; key: string } | null>(null);

  const mine = useQuery({
    queryKey: myVenueReviewKey(venueId),
    queryFn: async () => {
      const r = await getMyVenueReview(venueId);
      if ("error" in r) throw new Error(r.error);
      return r.data;
    },
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });
  const data = mine.data;
  const review = data?.review ?? null;

  const schema = useMemo(() => {
    const score = (c: VenueCriterion) =>
      z
        .number()
        .int()
        .min(1, t("scoreRequired", { criterion: t(`criteria.${c}`) }))
        .max(5);
    return z.object({
      scores: z.object({
        surface: score("surface"),
        lighting: score("lighting"),
        ventilation: score("ventilation"),
        price: score("price"),
        parking: score("parking"),
        owner: score("owner"),
      }),
      comment: z
        .string()
        .refine(
          (s) => s.trim().length <= REVIEW_COMMENT_MAX,
          t("commentTooLong", { max: REVIEW_COMMENT_MAX }),
        ),
    });
  }, [t]);

  // `values` cập nhật phiếu khi phần riêng về hoặc đổi sau khi lưu; ô đã gõ
  // dở thì giữ nguyên.
  const values = useMemo(() => valuesOf(review), [review]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: valuesOf(null),
    values,
    resetOptions: { keepDirtyValues: true },
  });
  const comment = useWatch({ control: form.control, name: "comment" }) ?? "";
  const errors = form.formState.errors;

  // Server chỉ trả mốc khi nó còn ở tương lai (null = sửa được ngay).
  const nextEditAt = data?.nextEditAt ?? null;
  const canWrite =
    !!data && data.eligible && review?.status !== "hidden" && !nextEditAt;

  function send(v: FormValues) {
    if (sending || !token || !canWrite) return;
    const text = v.comment.trim();
    const payload = {
      venueId,
      scores: { ...v.scores },
      comment: text === "" ? null : text,
    };
    const sig = JSON.stringify(payload);
    if (keyRef.current?.sig !== sig) {
      keyRef.current = { sig, key: crypto.randomUUID() };
    }
    const idempotencyKey = keyRef.current.key;
    const turnstileToken = token;
    const existing = review;
    const month = ymdInVN().slice(0, 7);
    let saved: { id: number; status: string } | null = null;

    setSending(true);
    setToken(null);
    onOptimistic?.({
      id: existing?.id ?? PENDING_REVIEW_ID,
      scores: payload.scores,
      comment: payload.comment,
      month: existing?.month ?? month,
      edited: existing !== null,
    });
    onOpenChange(false);

    const settle = () => {
      setSending(false);
      setResetKey((k) => k + 1);
    };

    fireAction(
      async () => {
        const r = await submitVenueReview({
          ...payload,
          idempotencyKey,
          turnstileToken,
        });
        // Server đã trả lời (được hay không): lần sau là một lần gửi mới.
        keyRef.current = null;
        if ("success" in r) saved = r.data;
        return r;
      },
      () => {
        onOptimistic?.(null);
        onOpenChange(true);
      },
      {
        retry: false,
        onError: settle,
        onSuccess: () => {
          settle();
          form.reset(v);
          const held = saved?.status === "held";
          if (held && saved) {
            const id = saved.id;
            // Hiện ngay trong sheet với nhãn chờ duyệt; không bao giờ vào danh
            // sách công khai, không kèm lý do giữ.
            qc.setQueryData<MyVenueReview>(myVenueReviewKey(venueId), (prev) =>
              prev
                ? {
                    ...prev,
                    review: {
                      id,
                      scores: payload.scores,
                      comment: payload.comment,
                      status: "held",
                      holdReason: null,
                      month: existing?.month ?? month,
                      editedAt: existing?.editedAt ?? null,
                    },
                  }
                : prev,
            );
            onOptimistic?.(null);
            toast.info(t("heldToast"));
            onOpenChange(true);
          } else {
            toast.success(t("submitted"));
          }
          void Promise.allSettled([
            qc.invalidateQueries({ queryKey: ["venue-reviews", venueId] }),
            qc.invalidateQueries({ queryKey: myVenueReviewKey(venueId) }),
          ]).then(() => onOptimistic?.(null));
          router.refresh();
        },
      },
    );
  }

  const title = review ? t("editTitle") : t("writeTitle");

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        canWrite ? (
          <button
            type="button"
            onClick={() => void form.handleSubmit(send)()}
            disabled={sending || !token}
            className="bg-primary text-primary-foreground inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {sending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {review ? t("update") : t("submit")}
          </button>
        ) : undefined
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={
            mine.isPending
              ? "loading"
              : mine.isError
                ? "error"
                : canWrite
                  ? "form"
                  : "info"
          }
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="space-y-4"
        >
          {mine.isPending ? (
            <SheetSkeleton />
          ) : mine.isError ? (
            <div className="space-y-3">
              <Note icon={Info} tone="destructive">
                {mine.error.message || t("loadMineError")}
              </Note>
              <button
                type="button"
                onClick={() => void mine.refetch()}
                className="bg-card/80 hover:bg-accent min-h-11 w-full rounded-xl border text-base font-medium"
              >
                {t("retry")}
              </button>
            </div>
          ) : (
            <>
              {review?.status === "held" && (
                <div className="space-y-1">
                  <span className="bg-secondary text-secondary-foreground inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-sm font-semibold">
                    <Clock className="size-4 shrink-0" aria-hidden />
                    {t("heldBadge")}
                  </span>
                  <p className="text-muted-foreground text-sm">
                    {t("heldExplain")}
                  </p>
                </div>
              )}

              {review?.status === "hidden" ? (
                <Note icon={EyeOff}>{t("hiddenExplain")}</Note>
              ) : !data?.eligible ? (
                <>
                  <Note icon={Info}>{t("notEligible")}</Note>
                  {review && <OwnCard review={review} />}
                </>
              ) : nextEditAt ? (
                <>
                  {review && <OwnCard review={review} />}
                  <Note icon={Clock}>
                    {t("editLockedUntil", {
                      date: formatSessionDate(
                        ymdInVN(new Date(nextEditAt)),
                        "long",
                        locale,
                      ),
                    })}
                  </Note>
                </>
              ) : (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void form.handleSubmit(send)();
                  }}
                >
                  <p className="text-muted-foreground text-sm">
                    {t("formHint")}
                  </p>
                  <div className="space-y-2">
                    {VENUE_CRITERIA.map((c) => (
                      <div key={c}>
                        <Controller
                          control={form.control}
                          name={`scores.${c}`}
                          render={({ field }) => (
                            <StarInput
                              label={t(`criteria.${c}`)}
                              value={field.value}
                              onChange={field.onChange}
                              invalid={!!errors.scores?.[c]}
                            />
                          )}
                        />
                        {errors.scores?.[c] && (
                          <p role="alert" className="text-destructive text-sm">
                            {errors.scores[c]?.message}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  <label className="block space-y-2">
                    <span className="text-base font-medium">
                      {t("commentLabel")}
                    </span>
                    <textarea
                      {...form.register("comment")}
                      rows={4}
                      maxLength={REVIEW_COMMENT_MAX}
                      placeholder={t("commentPlaceholder")}
                      aria-invalid={!!errors.comment || undefined}
                      className="bg-background focus-visible:ring-ring/50 focus-visible:border-ring w-full rounded-xl border p-3 text-base break-words outline-none focus-visible:ring-3"
                    />
                    <span className="flex justify-between gap-2 text-sm">
                      <span className="text-destructive">
                        {errors.comment?.message}
                      </span>
                      <span
                        className={cn(
                          "text-muted-foreground tabular-nums",
                          comment.length > REVIEW_COMMENT_MAX &&
                            "text-destructive",
                        )}
                      >
                        {t("commentCount", {
                          count: comment.length,
                          max: REVIEW_COMMENT_MAX,
                        })}
                      </span>
                    </span>
                  </label>

                  {review && (
                    <p className="text-muted-foreground text-sm">
                      {t("editRule", { days: REVIEW_EDIT_COOLDOWN_DAYS })}
                    </p>
                  )}

                  <TurnstileWidget
                    action={TS_REVIEW}
                    onToken={setToken}
                    resetKey={resetKey}
                  />
                  {!token && (
                    <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                      <ShieldCheck className="size-4 shrink-0" aria-hidden />
                      {t("captchaWaiting")}
                    </p>
                  )}
                </form>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </ResponsiveSheet>
  );
}

function OwnCard({ review }: { review: OwnReview }) {
  return <VenueReviewItem review={asView(review)} signedIn={false} />;
}

function Note({
  icon: Icon,
  tone = "muted",
  children,
}: {
  icon: typeof Info;
  tone?: "muted" | "destructive";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-3 rounded-2xl border p-4 text-base",
        tone === "destructive"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "bg-muted/40 text-foreground",
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** Đúng cỡ phiếu: 6 hàng sao 44px, ô nhận xét, dòng đếm. */
function SheetSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-5 w-2/3" />
      <div className="space-y-2">
        {VENUE_CRITERIA.map((c) => (
          <div key={c} className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-11 w-[13.75rem] rounded-xl" />
          </div>
        ))}
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}
