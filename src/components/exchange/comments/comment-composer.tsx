"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { addComment } from "@/actions/exchange-comments";
import { TurnstileWidget } from "@/components/security/turnstile-widget";
import {
  COMMENT_MAX_LEN,
  TS_COMMENT,
  type CommentChannel,
} from "@/lib/exchange/constants";
import { fireAction } from "@/lib/optimistic-action";
import { cn } from "@/lib/utils";

export type CommentComposerProps = {
  code: string;
  channel: CommentChannel;
  /** Bình luận được bấm "Trả lời"; server tự quy về tầng đúng. */
  parentId?: number;
  /** Có thì đây là ô sửa: bấm Lưu chỉ trao nội dung cho cha (cha lo optimistic). */
  onEditSubmit?: (body: string) => void;
  initialText?: string;
  needsCaptcha: boolean;
  /**
   * Gọi khi server đã nhận. Trả Promise (tải lại danh sách) thì dòng tạm chỉ gỡ
   * sau khi dữ liệu thật về, để bình luận không chớp tắt.
   */
  onSent: (status: "visible" | "held") => void | Promise<unknown>;
  /** Chèn dòng "Đang gửi…" vào danh sách; trả về hàm gỡ dòng đó. */
  onPending?: (body: string) => () => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
};

/**
 * Ô viết bình luận. Gửi không tự thử lại (token Turnstile dùng một lần), nên
 * `fireAction` chạy với `retry: false` và `resetKey` tăng sau MỌI lần gửi.
 * `idempotencyKey` sinh một lần cho mỗi nội dung: gửi lại sau khi có token
 * dùng đúng key đó nên server không tạo bản trùng.
 */
export function CommentComposer({
  code,
  channel,
  parentId,
  onEditSubmit,
  initialText = "",
  needsCaptcha,
  onSent,
  onPending,
  onCancel,
  placeholder,
  autoFocus,
}: CommentComposerProps) {
  const t = useTranslations("exchange.comments");
  const [text, setText] = useState(initialText);
  const [sending, setSending] = useState(false);
  const [held, setHeld] = useState(false);
  const [captcha, setCaptcha] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const keyRef = useRef<{ body: string; key: string } | null>(null);
  const awaitingToken = useRef(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<(tk: string | null) => void>(() => {});

  // Ô tự giãn theo nội dung, tối đa vừa một màn hình nhỏ.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const body = text.trim();
  const tooLong = text.length > COMMENT_MAX_LEN;
  const showCaptcha = !onEditSubmit && (needsCaptcha || captcha);

  function send(tk: string | null) {
    if (sending || !body || tooLong) return;
    if (onEditSubmit) {
      onEditSubmit(body);
      return;
    }
    if (showCaptcha && !tk) {
      // Chưa có token: hiện widget rồi tự gửi khi token về.
      awaitingToken.current = true;
      setCaptcha(true);
      return;
    }
    if (keyRef.current?.body !== body) {
      keyRef.current = { body, key: crypto.randomUUID() };
    }
    const idempotencyKey = keyRef.current.key;
    let outcome: "ok" | "captcha" = "ok";
    let status: "visible" | "held" = "visible";
    setSending(true);
    setHeld(false);
    const dropTemp = onPending?.(body);

    const settle = () => {
      setSending(false);
      setToken(null);
      setResetKey((k) => k + 1);
    };
    fireAction(
      async () => {
        const r = await addComment({
          code,
          channel,
          parentId,
          body,
          idempotencyKey,
          turnstileToken: tk ?? undefined,
        });
        if ("needsCaptcha" in r) {
          outcome = "captcha";
          return { success: true };
        }
        if ("error" in r) return r;
        status = r.data.status;
        return { success: true };
      },
      undefined,
      {
        retry: false,
        onSuccess: () => {
          settle();
          if (outcome === "captcha") {
            dropTemp?.();
            awaitingToken.current = true;
            setCaptcha(true);
            return;
          }
          keyRef.current = null;
          setText("");
          if (status === "held") {
            setHeld(true);
            toast.info(t("heldToast"));
          }
          // Dòng tạm ở lại tới khi danh sách tải lại xong (nếu cha trả Promise).
          void Promise.resolve(onSent(status)).finally(() => dropTemp?.());
        },
        // Lỗi: giữ nguyên chữ, gỡ dòng tạm; toast đã do fireAction hiện.
        onError: () => {
          dropTemp?.();
          settle();
        },
      },
    );
  }
  // Token về sau lúc widget giải xong: gọi bản `send` mới nhất, không phải closure cũ.
  useEffect(() => {
    sendRef.current = send;
  });

  function onToken(tk: string | null) {
    setToken(tk);
    if (tk && awaitingToken.current) {
      awaitingToken.current = false;
      sendRef.current(tk);
    }
  }

  return (
    <div className="space-y-2">
      {held && (
        <p className="text-warning-foreground text-sm font-medium">
          {t("waitingApproval")}
        </p>
      )}
      <textarea
        ref={areaRef}
        value={text}
        rows={onEditSubmit || parentId ? 3 : 2}
        autoFocus={autoFocus}
        placeholder={placeholder ?? t("placeholder")}
        aria-label={placeholder ?? t("placeholder")}
        onChange={(e) => {
          setText(e.target.value);
          setHeld(false);
        }}
        className="bg-background focus-visible:ring-ring/50 focus-visible:border-ring w-full resize-none rounded-xl border p-3 text-base outline-none focus-visible:ring-3"
      />
      {showCaptcha && (
        <TurnstileWidget
          action={TS_COMMENT}
          onToken={onToken}
          resetKey={resetKey}
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-sm tabular-nums",
            tooLong ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {t("counter", { count: text.length, max: COMMENT_MAX_LEN })}
        </span>
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-muted-foreground min-h-11 rounded-xl px-4 text-base font-medium"
            >
              {t("cancel")}
            </button>
          )}
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => send(token)}
            disabled={sending || !body || tooLong}
            className="bg-primary text-primary-foreground inline-flex min-h-11 min-w-11 items-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
            {onEditSubmit ? t("save") : t("send")}
          </motion.button>
        </div>
      </div>
    </div>
  );
}
