"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  listCommentReplies,
  type CommentPage,
} from "@/actions/exchange-comments";
import type { CommentView } from "@/lib/exchange/comment-tree";

/** Trả lời đã tải thêm của một bình luận; `next` = offset kế tiếp, null khi đã hết. */
type Extra = { replies: CommentView[]; next: number | null };

const MAX_RELOAD_PAGES = 5;

const visibleCount = (list: CommentView[]) =>
  list.filter((r) => r.state === "visible").length;

/**
 * Trạng thái phủ lên cây bình luận của server: các chủ đề đã mở "Xem N trả lời"
 * (`extra`) và các sửa tạm optimistic (`patches`). Khi có dữ liệu mới (ghi xong,
 * "Tải bình luận mới", focus lại): số server thắng bản đoán, trừ bình luận còn
 * thao tác đang bay; chủ đề đã mở được tải lại để khỏi giữ bản cũ.
 */
export function useOpenThreads(
  pages: CommentPage[] | undefined,
  dataUpdatedAt: number,
) {
  const t = useTranslations("exchange.comments");
  const [patches, setPatches] = useState<Record<number, Partial<CommentView>>>(
    {},
  );
  const [extra, setExtra] = useState<Record<number, Extra>>({});
  const extraRef = useRef(extra);
  const pagesRef = useRef(pages);
  const pending = useRef(new Map<number, number>());
  useEffect(() => {
    extraRef.current = extra;
    pagesRef.current = pages;
  });

  const patch = useCallback((id: number, p: Partial<CommentView>) => {
    setPatches((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
  }, []);
  const begin = useCallback((id: number) => {
    pending.current.set(id, (pending.current.get(id) ?? 0) + 1);
  }, []);
  const end = useCallback((id: number) => {
    const n = (pending.current.get(id) ?? 1) - 1;
    if (n <= 0) pending.current.delete(id);
    else pending.current.set(id, n);
  }, []);

  useEffect(() => {
    if (!dataUpdatedAt) return;
    // Giữ patch của bình luận còn thao tác đang bay; bỏ phần đã xong.
    const clearSettled = () =>
      setPatches((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(([id]) =>
            pending.current.has(Number(id)),
          ),
        ),
      );
    const snapshot = extraRef.current;
    const ids = Object.keys(snapshot).map(Number);
    if (ids.length === 0) {
      clearSettled();
      return;
    }
    let cancelled = false;
    const fresh = new Map<number, CommentView>();
    const walk = (v: CommentView) => {
      fresh.set(v.id, v);
      v.replies.forEach(walk);
    };
    pagesRef.current?.forEach((p) => p.roots.forEach(walk));

    // Một chủ đề tầng 2 có neo là trả lời vừa tải thêm: xử lý cha trước, rồi
    // thêm trả lời đã tải vào `fresh` để con tìm được neo.
    async function reload(id: number): Promise<Extra | null | "keep"> {
      const f = fresh.get(id);
      if (!f) return null;
      let offset = visibleCount(f.replies);
      let more = f.moreReplies;
      let hasMore = more > 0;
      const acc: CommentView[] = [];
      for (let i = 0; i < MAX_RELOAD_PAGES && hasMore; i++) {
        const r = await listCommentReplies({ commentId: id, offset }).catch(
          () => null,
        );
        if (!r || "error" in r) {
          if (r) toast.error(r.error);
          // Không tải lại được gì thì giữ bản đang hiện hơn là làm chủ đề sụp.
          return acc.length === 0 ? "keep" : { replies: acc, next: offset };
        }
        acc.push(...r.data.replies);
        hasMore = r.data.hasMore;
        offset = r.data.nextOffset ?? offset + r.data.replies.length;
        more -= r.data.replies.length;
      }
      acc.forEach(walk);
      return acc.length === 0
        ? null
        : { replies: acc, next: hasMore ? offset : null };
    }

    void (async () => {
      const result: Record<number, Extra | null | "keep"> = {};
      let todo = ids;
      while (todo.length > 0) {
        const ready = todo.filter((id) => fresh.has(id));
        if (ready.length === 0) break;
        for (const id of ready) result[id] = await reload(id);
        todo = todo.filter((id) => !(id in result));
      }
      if (cancelled) return;
      // Gộp, không thay hẳn: chủ đề người dùng vừa mở lúc đang tải lại phải còn.
      setExtra((prev) => {
        const out = { ...prev };
        for (const id of ids) {
          const r = result[id];
          if (r === "keep") continue;
          if (r) out[id] = r;
          else delete out[id];
        }
        return out;
      });
      clearSettled();
    })();
    return () => {
      cancelled = true;
    };
    // Chỉ chạy khi có dữ liệu mới; `pages` đọc qua ref đúng bản vừa về.
  }, [dataUpdatedAt]);

  /** `c` là bản đã gộp (có cả trả lời tải thêm) nên đếm offset từ chính nó. */
  async function loadReplies(c: CommentView) {
    const offset = extra[c.id]?.next ?? visibleCount(c.replies);
    const r = await listCommentReplies({ commentId: c.id, offset }).catch(
      (e: unknown) => ({
        error: e instanceof Error ? e.message : t("loadError"),
      }),
    );
    if ("error" in r) {
      toast.error(r.error);
      return;
    }
    const { replies, nextOffset } = r.data;
    setExtra((prev) => {
      const old = prev[c.id]?.replies ?? [];
      const seen = new Set(old.map((x) => x.id));
      return {
        ...prev,
        [c.id]: {
          replies: [...old, ...replies.filter((x) => !seen.has(x.id))],
          next: nextOffset,
        },
      };
    });
  }

  function apply(v: CommentView): CommentView {
    const e = extra[v.id];
    const merged: CommentView = { ...v, ...patches[v.id] };
    let replies = v.replies;
    if (e) {
      const seen = new Set(v.replies.map((r) => r.id));
      const added = e.replies.filter((r) => !seen.has(r.id));
      replies = [...v.replies, ...added];
      // `moreReplies` của server là gốc; chỉ trừ số trả lời đã tải thêm.
      merged.moreReplies = Math.max(0, v.moreReplies - visibleCount(added));
    }
    merged.replies = replies.map(apply);
    return merged;
  }

  return { apply, patch, begin, end, loadReplies };
}
