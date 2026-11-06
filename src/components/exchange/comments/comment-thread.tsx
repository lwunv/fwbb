"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { CommentView } from "@/lib/exchange/comment-tree";
import { CommentItem, type CommentCtx } from "./comment-item";

/**
 * Một chủ đề: bình luận gốc, các trả lời tầng 1 (thụt lề, đường kẻ trái) và
 * tầng 2 (trên mobile không thụt thêm để chữ không bị bóp hẹp).
 */
export function CommentThread({
  root,
  ctx,
  onLoadReplies,
}: {
  root: CommentView;
  ctx: CommentCtx;
  /** Tải thêm trả lời của một gốc hoặc tầng 1; thành công thì chèn vào cây. */
  onLoadReplies: (comment: CommentView) => Promise<void>;
}) {
  const t = useTranslations("exchange.comments");
  const [loading, setLoading] = useState<number | null>(null);

  async function more(c: CommentView) {
    setLoading(c.id);
    try {
      await onLoadReplies(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("loadError"));
    } finally {
      setLoading(null);
    }
  }

  function moreButton(c: CommentView) {
    if (c.moreReplies <= 0) return null;
    return (
      <button
        type="button"
        onClick={() => more(c)}
        disabled={loading === c.id}
        className="text-primary inline-flex min-h-11 items-center text-base font-medium disabled:opacity-50"
      >
        {t("viewReplies", { count: c.moreReplies })}
      </button>
    );
  }

  return (
    <div className="bg-card/80 rounded-2xl border px-4 py-2 backdrop-blur">
      <CommentItem view={root} ctx={ctx} />
      {(root.replies.length > 0 || root.moreReplies > 0) && (
        <div className="ml-2 border-l pl-3">
          {root.replies.map((r) => (
            <div key={r.id}>
              <CommentItem view={r} ctx={ctx} />
              {(r.replies.length > 0 || r.moreReplies > 0) && (
                <div className="border-l pl-2 sm:ml-3 sm:pl-3">
                  {r.replies.map((r2) => (
                    <CommentItem key={r2.id} view={r2} ctx={ctx} />
                  ))}
                  {moreButton(r)}
                </div>
              )}
            </div>
          ))}
          {moreButton(root)}
        </div>
      )}
    </div>
  );
}
