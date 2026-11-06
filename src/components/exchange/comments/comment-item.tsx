"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { MoreHorizontal, Pin, ThumbsUp } from "lucide-react";
import {
  approveHeldComment,
  deleteComment,
  editComment,
  pinComment,
  toggleCommentVote,
} from "@/actions/exchange-comments";
import { nameSeed } from "@/components/exchange/exchange-card";
import { ReportSheet } from "@/components/exchange/report-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MemberAvatar } from "@/components/shared/member-avatar";
import type { CommentView } from "@/lib/exchange/comment-tree";
import type { CommentChannel } from "@/lib/exchange/constants";
import { fireAction } from "@/lib/optimistic-action";
import { cn } from "@/lib/utils";
import { CommentComposer } from "./comment-composer";

/** Những thứ mọi bình luận trong khu cần chung, gom một chỗ để khỏi truyền từng prop. */
export type CommentCtx = {
  code: string;
  channel: CommentChannel;
  signedIn: boolean;
  canWrite: boolean;
  needsCaptcha: boolean;
  /** Ghi đè tạm lên một bình luận (optimistic); hoàn lại bằng giá trị cũ khi lỗi. */
  patch: (id: number, p: Partial<CommentView>) => void;
  /** Tải lại các trang đã mở sau khi server đã nhận thay đổi. */
  changed: () => void;
};

function agoLabel(iso: string, locale: string): string {
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diffMin);
  if (abs < 60) return rtf.format(Math.min(diffMin, 0), "minute");
  if (abs < 60 * 24) return rtf.format(Math.trunc(diffMin / 60), "hour");
  return rtf.format(Math.trunc(diffMin / 1440), "day");
}

const actionBtn =
  "text-muted-foreground hover:text-foreground inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-3 text-base font-medium";

/** Một bình luận. Body luôn là text node (không HTML, không linkify). */
export function CommentItem({
  view,
  ctx,
}: {
  view: CommentView;
  ctx: CommentCtx;
}) {
  const t = useTranslations("exchange.comments");
  const locale = useLocale();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const v = view;

  if (v.state === "deleted" || v.state === "hidden" || !v.author) {
    const key =
      v.state === "deleted"
        ? "placeholderDeleted"
        : v.state === "hidden"
          ? "placeholderHidden"
          : "placeholderHeld";
    return (
      <article className="py-2">
        <p className="text-muted-foreground text-base italic">{t(key)}</p>
      </article>
    );
  }

  const live = v.state === "visible" || v.state === "held";
  const canReport = ctx.signedIn && !v.mine && v.state === "visible";

  function vote() {
    const next = !v.myVote;
    const prev = { myVote: v.myVote, upvotes: v.upvotes };
    ctx.patch(v.id, {
      myVote: next,
      upvotes: Math.max(0, v.upvotes + (next ? 1 : -1)),
    });
    fireAction(
      async () => {
        const r = await toggleCommentVote({ commentId: v.id, voted: next });
        // Số thật từ server thay số đoán.
        if ("success" in r)
          ctx.patch(v.id, { myVote: next, upvotes: r.data.upvotes });
        return r;
      },
      () => ctx.patch(v.id, prev),
      { retry: false },
    );
  }

  function edit(body: string) {
    const prev = { body: v.body, edited: v.edited };
    setEditing(false);
    ctx.patch(v.id, { body, edited: true });
    fireAction(
      () => editComment({ commentId: v.id, body }),
      () => ctx.patch(v.id, prev),
      { retry: false, onSuccess: ctx.changed },
    );
  }

  function togglePin() {
    const pinned = !v.pinned;
    ctx.patch(v.id, { pinned });
    fireAction(
      () => pinComment({ commentId: v.id, pinned }),
      () => ctx.patch(v.id, { pinned: !pinned }),
      { retry: false, onSuccess: ctx.changed },
    );
  }

  function approve() {
    ctx.patch(v.id, { state: "visible", canApprove: false });
    fireAction(
      () => approveHeldComment({ commentId: v.id }),
      () => ctx.patch(v.id, { state: "held", canApprove: true }),
      { retry: false, onSuccess: ctx.changed },
    );
  }

  function remove() {
    const prev = {
      state: v.state,
      body: v.body,
      author: v.author,
      canDelete: v.canDelete,
      canEdit: v.canEdit,
      canPin: v.canPin,
      canApprove: v.canApprove,
    };
    ctx.patch(v.id, {
      state: "deleted",
      body: null,
      author: null,
      canDelete: false,
      canEdit: false,
      canPin: false,
      canApprove: false,
    });
    fireAction(
      () => deleteComment({ commentId: v.id }),
      () => ctx.patch(v.id, prev),
      { retry: false, onSuccess: ctx.changed },
    );
  }

  const menu: { key: string; label: string; run: () => void }[] = [];
  if (v.canEdit)
    menu.push({ key: "edit", label: t("edit"), run: () => setEditing(true) });
  if (v.canPin)
    menu.push({
      key: "pin",
      label: v.pinned ? t("unpin") : t("pin"),
      run: togglePin,
    });
  if (v.canApprove)
    menu.push({ key: "approve", label: t("approve"), run: approve });
  if (v.canDelete)
    menu.push({
      key: "delete",
      label: t("delete"),
      run: () => setConfirmDelete(true),
    });
  if (canReport)
    menu.push({
      key: "report",
      label: t("report"),
      run: () => setReportOpen(true),
    });

  return (
    <motion.article layout="position" className="space-y-1.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <MemberAvatar
          memberId={nameSeed(v.author.name)}
          avatarUrl={v.author.avatarUrl}
          avatarKey={v.author.avatarKey}
          size={28}
        />
        <span className="text-base font-semibold break-words">
          {v.author.name}
        </span>
        {v.author.isHost && (
          <span className="bg-primary/15 text-primary rounded-full px-2 py-0.5 text-sm font-semibold">
            {t("host")}
          </span>
        )}
        <span
          className="text-muted-foreground text-sm"
          suppressHydrationWarning
        >{`· ${agoLabel(v.createdAt, locale)}`}</span>
        {v.edited && (
          <span className="text-muted-foreground text-sm">{t("edited")}</span>
        )}
        {v.pinned && (
          <span className="text-primary inline-flex items-center gap-1 text-sm">
            <Pin className="h-3.5 w-3.5" aria-hidden />
            {t("pinned")}
          </span>
        )}
      </div>

      {editing ? (
        <CommentComposer
          code={ctx.code}
          channel={ctx.channel}
          initialText={v.body ?? ""}
          needsCaptcha={false}
          autoFocus
          onCancel={() => setEditing(false)}
          onEditSubmit={edit}
          onSent={() => {}}
        />
      ) : (
        <p className="text-base break-words whitespace-pre-wrap">
          {v.replyToName && (
            <span className="bg-primary/10 text-primary mr-1.5 inline-block rounded-full px-2 text-sm font-medium">
              {`@${v.replyToName}`}
            </span>
          )}
          {v.body}
        </p>
      )}

      {v.state === "held" && (
        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
          {t("waitingApproval")}
        </p>
      )}

      <div className="relative -ml-3 flex flex-wrap items-center">
        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          onClick={vote}
          disabled={!ctx.signedIn || v.state !== "visible"}
          aria-pressed={v.myVote}
          className={cn(actionBtn, v.myVote && "text-primary")}
        >
          <ThumbsUp
            className={cn("h-4 w-4", v.myVote && "fill-current")}
            aria-hidden
          />
          {`${t("helpful")} ${v.upvotes}`}
        </motion.button>
        {ctx.canWrite && live && (
          <button
            type="button"
            onClick={() => setReplying((r) => !r)}
            className={actionBtn}
          >
            {t("reply")}
          </button>
        )}
        {menu.length > 0 && (
          <>
            <button
              type="button"
              aria-label={t("menu")}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className={actionBtn}
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden />
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  role="menu"
                  className="bg-popover absolute top-full right-0 z-20 min-w-40 rounded-xl border p-1 shadow-lg"
                >
                  {menu.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        m.run();
                      }}
                      className="hover:bg-accent flex min-h-11 w-full items-center rounded-lg px-3 text-left text-base"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {replying && (
        <CommentComposer
          code={ctx.code}
          channel={ctx.channel}
          parentId={v.id}
          needsCaptcha={ctx.needsCaptcha}
          placeholder={t("placeholderReply", { name: v.author.name })}
          autoFocus
          onCancel={() => setReplying(false)}
          onSent={() => {
            setReplying(false);
            ctx.changed();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("deleteTitle")}
        description={t("deleteBody")}
        confirmLabel={t("deleteConfirm")}
        cancelLabel={t("cancel")}
        onConfirm={remove}
      />
      {reportOpen && (
        <ReportSheet
          open
          onOpenChange={setReportOpen}
          code={ctx.code}
          commentId={v.id}
        />
      )}
    </motion.article>
  );
}
