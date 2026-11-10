"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Check, Flag } from "lucide-react";
import { toast } from "sonner";
import {
  getEventFeedbackForm,
  submitEventFeedback,
  type FeedbackForm,
} from "@/actions/reputation";
import { nameSeed } from "@/components/exchange/exchange-card";
import { ReportSheet } from "@/components/exchange/report-sheet";
import { ResponsiveSheet } from "@/components/exchange/responsive-sheet";
import { TurnstileWidget } from "@/components/security/turnstile-widget";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { Switch } from "@/components/ui/switch";
import { fireAction } from "@/lib/optimistic-action";
import {
  FEEDBACK_MAX_PEERS,
  MAX_PEER_TAGS,
  PEER_TAGS,
  TS_FEEDBACK,
  type PeerTag,
} from "@/lib/reputation/constants";
import { SKILL_LEVELS, type SkillLevel } from "@/lib/skill-level";
import { cn } from "@/lib/utils";

const answerSchema = z.object({
  registrationId: z.number().int().positive(),
  playAgain: z.boolean(),
  tags: z.array(z.enum(PEER_TAGS)).max(MAX_PEER_TAGS),
  skill: z.enum(SKILL_LEVELS).nullable(),
});
// Hai câu về host bắt buộc (quyết định 7): chưa chọn là null, không qua được pipe.
const formSchema = z.object({
  asDescribed: z.boolean().nullable().pipe(z.boolean()),
  feeAsPromised: z.boolean().nullable().pipe(z.boolean()),
  peers: z.array(answerSchema).max(FEEDBACK_MAX_PEERS),
});
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;
type Answer = z.output<typeof answerSchema>;

function newKey(): string {
  return crypto.randomUUID();
}

function sameAnswer(a: Answer, b: Answer): boolean {
  return (
    a.playAgain === b.playAgain &&
    a.skill === b.skill &&
    a.tags.length === b.tags.length &&
    a.tags.every((t) => b.tags.includes(t))
  );
}

/**
 * Phiếu chấm sau buổi. Phần riêng theo người chỉ tải khi mở sheet (react-query,
 * `staleTime` 60s, không tự làm mới). Chỉ hiện form khi cửa sổ chấm đang mở và
 * người xem được điểm danh; trường hợp còn lại là một câu giải thích, không tên ai.
 *
 * `idempotencyKey` sống ở đây (không ở form) để gửi lại sau lỗi vẫn cùng khoá
 * dù form có mount lại; thành công thì bỏ khoá để lần sửa sau có khoá mới.
 */
export function FeedbackSheet({
  open,
  onOpenChange,
  code,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
}) {
  const t = useTranslations("exchange.reputation");
  const queryClient = useQueryClient();
  const router = useRouter();
  const queryKey = ["exchange-feedback", code];
  const keyRef = useRef<string | null>(null);
  const [reportCode, setReportCode] = useState<string | null>(null);
  // Mỗi lần mở là một form mới (trạng thái "Đã gửi", token, câu trả lời chưa
  // gửi). Đổi state ngay trong render theo mẫu "điều chỉnh state khi prop đổi".
  const [prevOpen, setPrevOpen] = useState(open);
  const [session, setSession] = useState(0);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSession((s) => s + 1);
  }

  const q = useQuery({
    queryKey,
    queryFn: async (): Promise<FeedbackForm> => {
      const res = await getEventFeedbackForm(code);
      if ("error" in res) throw new Error(res.error);
      return res.data;
    },
    enabled: open,
    staleTime: 60_000,
  });

  function takeKey(): string {
    keyRef.current ??= newKey();
    return keyRef.current;
  }

  function onSaved() {
    keyRef.current = null;
    void queryClient.invalidateQueries({ queryKey });
    // Action không revalidate trang: làm mới để huy hiệu "Chưa đánh giá" ở
    // "Giao lưu của tôi" (và nút trên trang buổi) theo kịp. Chỉ khi đã lưu.
    router.refresh();
    toast.success(t("feedbackSaved"));
    onOpenChange(false);
  }

  const data = q.data;
  const note = "text-muted-foreground text-base";
  let body: React.ReactNode = null;
  if (q.isError) {
    body = (
      <p role="alert" className="text-destructive text-base">
        {q.error.message}
      </p>
    );
  } else if (!data) {
    body = <FeedbackSkeleton />;
  } else if (data.state === "notEligible") {
    body = <p className={note}>{t("feedbackNotEligible")}</p>;
  } else if (data.state === "notYet") {
    body = <p className={note}>{t("feedbackNotYet")}</p>;
  } else if (data.state === "closed") {
    body = <p className={note}>{t("feedbackClosed")}</p>;
  }

  return (
    <>
      {data?.state !== "open" || q.isError ? (
        <ResponsiveSheet
          open={open}
          onOpenChange={onOpenChange}
          title={t("feedbackRate")}
        >
          {body}
        </ResponsiveSheet>
      ) : (
        <FeedbackFormView
          // Mở lại, hoặc dữ liệu mới từ server, thì dựng lại form với giá trị mới.
          key={`${session}:${q.dataUpdatedAt}`}
          open={open}
          onOpenChange={onOpenChange}
          code={code}
          data={data}
          takeKey={takeKey}
          onSaved={onSaved}
          onReport={setReportCode}
        />
      )}
      {reportCode && (
        <ReportSheet
          open
          onOpenChange={(o) => !o && setReportCode(null)}
          target={{ type: "player", code: reportCode }}
        />
      )}
    </>
  );
}

function FeedbackSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="bg-muted h-28 animate-pulse rounded-2xl" />
      <div className="bg-muted h-44 animate-pulse rounded-2xl" />
      <div className="bg-muted h-44 animate-pulse rounded-2xl" />
    </div>
  );
}

function FeedbackFormView({
  open,
  onOpenChange,
  code,
  data,
  takeKey,
  onSaved,
  onReport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  data: FeedbackForm;
  takeKey: () => string;
  onSaved: () => void;
  onReport: (code: string) => void;
}) {
  const t = useTranslations("exchange.reputation");
  const tEvent = useTranslations("exchange.event");
  const [initial] = useState<Answer[]>(() =>
    data.peers.map((p) => ({
      registrationId: p.registrationId,
      playAgain: p.mine?.playAgain ?? false,
      tags: p.mine?.tags ?? [],
      skill: p.mine?.skill ?? null,
    })),
  );
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      asDescribed: data.hostAnswer?.asDescribed ?? null,
      feeAsPromised: data.hostAnswer?.feeAsPromised ?? null,
      peers: initial,
    },
  });
  const { control, setValue, handleSubmit } = form;
  const [asDescribed, feeAsPromised, peers] = useWatch({
    control,
    name: ["asDescribed", "feeAsPromised", "peers"],
  });
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sent, setSent] = useState(false);
  // `sent` trong closure chưa đổi khi chạm lần hai trước lúc React vẽ lại;
  // ref chặn ngay lập tức và chỉ mở lại khi action đã xong.
  const inFlight = useRef(false);

  const hostAnswered = asDescribed !== null && feeAsPromised !== null;

  function onValid(v: FormOutput) {
    if (inFlight.current || sent || !token) return;
    inFlight.current = true;
    const turnstileToken = token;
    // Token dùng một lần: lần gửi sau phải chờ Turnstile cấp token mới.
    setToken(null);
    setSent(true);
    const input = {
      code,
      host: { asDescribed: v.asDescribed, feeAsPromised: v.feeAsPromised },
      // Chỉ người đã đổi so với lúc mở; người không gửi thì server giữ nguyên,
      // còn người bị xoá hết câu trả lời thì gửi dòng rỗng để server xoá.
      peers: v.peers.filter((p, i) => !sameAnswer(p, initial[i])),
      idempotencyKey: takeKey(),
      turnstileToken,
    };
    const release = () => {
      inFlight.current = false;
      setResetKey((k) => k + 1);
    };
    fireAction(
      () => submitEventFeedback(input),
      () => setSent(false),
      {
        retry: false,
        onSuccess: () => {
          release();
          onSaved();
        },
        onError: release,
      },
    );
  }

  function setPeer(i: number, patch: Partial<Answer>) {
    const cur = peers[i];
    setValue(`peers.${i}`, { ...cur, ...patch }, { shouldDirty: true });
  }

  const submitLabel = sent
    ? t("feedbackSentState")
    : token
      ? t("feedbackSubmit")
      : tEvent("captchaWaiting");

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("feedbackRate")}
      footer={
        <div className="space-y-2">
          <TurnstileWidget
            action={TS_FEEDBACK}
            onToken={setToken}
            resetKey={resetKey}
          />
          {!hostAnswered && (
            <p className="text-muted-foreground text-sm">
              {t("feedbackNeedHost")}
            </p>
          )}
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => void handleSubmit(onValid)()}
            disabled={sent || !token || !hostAnswered}
            className="bg-primary text-primary-foreground flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold disabled:opacity-50"
          >
            {sent && <Check className="h-5 w-5" aria-hidden />}
            {submitLabel}
          </motion.button>
        </div>
      }
    >
      <section className="bg-card/80 space-y-3 rounded-2xl border p-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <MemberAvatar
            memberId={nameSeed(data.host.name)}
            avatarUrl={data.host.avatarUrl}
            avatarKey={data.host.avatarKey}
            size={36}
          />
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm">
              {t("feedbackHostTitle")}
            </p>
            <p className="text-base font-semibold break-words">
              {data.host.name}
            </p>
          </div>
        </div>
        <YesNo
          label={t("feedbackAsDescribed")}
          value={asDescribed}
          onChange={(v) => setValue("asDescribed", v, { shouldDirty: true })}
        />
        <YesNo
          label={t("feedbackFeeAsPromised")}
          value={feeAsPromised}
          onChange={(v) => setValue("feeAsPromised", v, { shouldDirty: true })}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold">{t("feedbackPeersTitle")}</h3>
          <p className="text-muted-foreground text-sm">
            {t("feedbackPeersHint")}
          </p>
        </div>
        {data.peers.length === 0 ? (
          <p className="text-muted-foreground text-base">
            {t("feedbackNoPeers")}
          </p>
        ) : (
          data.peers.map((p, i) => (
            <PeerCard
              key={p.registrationId}
              peer={p}
              answer={peers[i]}
              index={i}
              onChange={(patch) => setPeer(i, patch)}
              onReport={onReport}
            />
          ))
        )}
      </section>

      <p className="text-muted-foreground text-sm">{t("feedbackScoreNote")}</p>
    </ResponsiveSheet>
  );
}

function YesNo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  const t = useTranslations("exchange.reputation");
  const id = useId();
  return (
    <div className="space-y-2">
      <p id={id} className="text-base font-medium">
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={id} className="flex gap-2">
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center rounded-xl border px-3 text-base font-medium transition-colors",
              value === v
                ? "border-primary bg-primary/10 text-primary"
                : "bg-background",
            )}
          >
            {t(v ? "feedbackYes" : "feedbackNo")}
          </button>
        ))}
      </div>
    </div>
  );
}

function PeerCard({
  peer,
  answer,
  index,
  onChange,
  onReport,
}: {
  peer: FeedbackForm["peers"][number];
  answer: Answer;
  index: number;
  onChange: (patch: Partial<Answer>) => void;
  onReport: (code: string) => void;
}) {
  const t = useTranslations("exchange.reputation");
  const tSkill = useTranslations("me.skillShort");
  const tEvent = useTranslations("exchange.event");
  const nameId = useId();
  const playId = useId();

  const chip = (on: boolean) =>
    cn(
      "inline-flex min-h-11 items-center rounded-full border px-4 text-base font-medium transition-colors",
      on ? "border-primary bg-primary/10 text-primary" : "bg-background",
    );

  function toggleTag(tag: PeerTag) {
    const tags = answer.tags.includes(tag)
      ? answer.tags.filter((x) => x !== tag)
      : PEER_TAGS.filter((x) => x === tag || answer.tags.includes(x));
    onChange({ tags });
  }
  function toggleSkill(level: SkillLevel) {
    onChange({ skill: answer.skill === level ? null : level });
  }

  return (
    <motion.div
      role="group"
      aria-labelledby={nameId}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: Math.min(index, 8) * 0.03 }}
      className="bg-card/80 space-y-3 rounded-2xl border p-4 backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <MemberAvatar
          memberId={nameSeed(peer.name)}
          avatarUrl={peer.avatarUrl}
          avatarKey={peer.avatarKey}
          size={36}
        />
        <p
          id={nameId}
          className="min-w-0 flex-1 pt-1.5 text-base font-semibold break-words"
        >
          {peer.name}
        </p>
        {peer.code && (
          <button
            type="button"
            onClick={() => onReport(peer.code!)}
            className="text-muted-foreground -mr-2 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium"
          >
            <Flag className="h-4 w-4" aria-hidden />
            {tEvent("report")}
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span id={playId} className="text-base">
          {t("kudosPlayAgain")}
        </span>
        <Switch
          aria-labelledby={playId}
          checked={answer.playAgain}
          onCheckedChange={(v) => onChange({ playAgain: v })}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {PEER_TAGS.map((tag) => {
          const on = answer.tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => toggleTag(tag)}
              className={chip(on)}
            >
              {t(`tags.${tag}`)}
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">{t("feedbackSkill")}</p>
        <div className="flex flex-wrap gap-2">
          {SKILL_LEVELS.map((level) => {
            const on = answer.skill === level;
            return (
              <button
                key={level}
                type="button"
                aria-pressed={on}
                onClick={() => toggleSkill(level)}
                className={chip(on)}
              >
                {tSkill(level)}
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
