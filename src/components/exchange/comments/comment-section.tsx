"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { toast } from "sonner";
import {
  listCommentReplies,
  listExchangeComments,
  markCommentsRead,
  setCommentsLocked,
} from "@/actions/exchange-comments";
import { TabSegment } from "@/components/shared/tab-segment";
import type { CommentView } from "@/lib/exchange/comment-tree";
import { fireAction } from "@/lib/optimistic-action";
import { cn } from "@/lib/utils";
import { CommentComposer } from "./comment-composer";
import { CommentItem, type CommentCtx } from "./comment-item";
import { CommentSkeleton } from "./comment-skeleton";
import { CommentThread } from "./comment-thread";

const KENH = ["qa", "nhom"] as const;
const SORTS = ["top", "new"] as const;

type Extra = { replies: CommentView[]; more: number; next: number | null };

/**
 * Khu bình luận kiểu Reddit của trang buổi. Quyền đọc/ghi lấy từ trang server
 * trả về (`signedIn` chỉ là gợi ý ban đầu). Không polling: react-query chỉ tải
 * lại khi cửa sổ được focus lại hoặc khi bấm "Tải bình luận mới" (quota Turso).
 */
export function CommentSection({
  code,
  signedIn,
  eventId = null,
}: {
  code: string;
  signedIn: boolean;
  /** Id buổi, chỉ host mới có (để khoá bình luận). */
  eventId?: number | null;
}) {
  const t = useTranslations("exchange.comments");
  const qc = useQueryClient();
  const [kenh, setKenh] = useQueryState(
    "kenh",
    parseAsStringLiteral(KENH).withDefault("qa"),
  );
  const [bl, setBl] = useQueryState("bl", parseAsStringLiteral(SORTS));
  // Khách không bao giờ có Nhóm buổi: về Hỏi đáp ngay, không gọi server.
  const channel = kenh === "nhom" && signedIn ? "group" : "qa";
  const sort = bl ?? (channel === "group" ? "new" : "top");

  const [patches, setPatches] = useState<Record<number, Partial<CommentView>>>(
    {},
  );
  const [extra, setExtra] = useState<Record<number, Extra>>({});
  const [lockOverride, setLockOverride] = useState<boolean | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const marked = useRef(new Set<string>());

  const key = ["exchange-comments", code, channel, sort] as const;
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: async ({ pageParam }) => {
      const r = await listExchangeComments({
        code,
        channel,
        sort,
        offset: pageParam,
      });
      if ("error" in r) throw new Error(r.error);
      return r.data;
    },
    initialPageParam: 0,
    getNextPageParam: (p) => p.nextOffset ?? undefined,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const first = q.data?.pages[0];

  // Vào ?kenh=nhom mà không đọc được: về Hỏi đáp, không báo lỗi.
  const groupDenied =
    channel === "group" && (q.isError || first?.canRead.group === false);
  useEffect(() => {
    if (groupDenied) void setKenh("qa");
  }, [groupDenied, setKenh]);

  // Đánh dấu đã đọc một lần cho mỗi khu; lỗi ở đây không đáng làm phiền người đọc.
  const newestAt = first?.newestAt ?? null;
  const unread = first?.unread ?? false;
  useEffect(() => {
    if (!signedIn || !unread || !newestAt || marked.current.has(channel))
      return;
    marked.current.add(channel);
    void markCommentsRead({ code, channel, upTo: newestAt }).catch(() => {});
  }, [signedIn, unread, newestAt, channel, code]);

  async function changed() {
    await qc.invalidateQueries({ queryKey: ["exchange-comments", code] });
    setPatches({});
    setLockOverride(null);
  }

  function apply(v: CommentView): CommentView {
    const e = extra[v.id];
    const merged: CommentView = { ...v, ...patches[v.id] };
    let replies = v.replies;
    if (e) {
      const seen = new Set(v.replies.map((r) => r.id));
      replies = [...v.replies, ...e.replies.filter((r) => !seen.has(r.id))];
      merged.moreReplies = e.more;
    }
    merged.replies = replies.map(apply);
    return merged;
  }

  const seen = new Set<number>();
  const roots: CommentView[] = [];
  for (const p of q.data?.pages ?? []) {
    for (const r of p.roots) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      roots.push(apply(r));
    }
  }
  const held = (first?.hostHeld ?? [])
    .map(apply)
    .filter((h) => h.state === "held");

  async function loadReplies(c: CommentView) {
    const offset =
      extra[c.id]?.next ??
      c.replies.filter((r) => r.state === "visible").length;
    const r = await listCommentReplies({ commentId: c.id, offset });
    if ("error" in r) {
      toast.error(r.error);
      return;
    }
    const { replies, hasMore, nextOffset } = r.data;
    setExtra((prev) => ({
      ...prev,
      [c.id]: {
        replies: [...(prev[c.id]?.replies ?? []), ...replies],
        more: hasMore ? Math.max(1, c.moreReplies - replies.length) : 0,
        next: nextOffset,
      },
    }));
  }

  const writeState = first
    ? lockOverride === null
      ? first.writeState
      : lockOverride
        ? "locked"
        : "open"
    : "open";
  const locked = writeState === "locked";

  function toggleLock() {
    if (eventId === null) return;
    setLockOverride(!locked);
    fireAction(
      () => setCommentsLocked({ eventId, locked: !locked }),
      () => setLockOverride(locked),
      { retry: false, onSuccess: () => void changed() },
    );
  }

  const ctx: CommentCtx = {
    code,
    channel,
    signedIn,
    canWrite: !!first?.canWrite && writeState === "open",
    needsCaptcha: first?.needsCaptcha ?? false,
    patch: (id, p) =>
      setPatches((prev) => ({ ...prev, [id]: { ...prev[id], ...p } })),
    changed: () => void changed(),
  };

  const showGroupTab = signedIn && !!first?.canRead.group;
  const loginHref = `/giao-luu/dang-nhap?next=${encodeURIComponent(`/giao-luu/${code}`)}`;
  const line = "text-muted-foreground text-base";

  function writeArea() {
    if (!first) return null;
    if (!signedIn)
      return (
        <Link
          href={loginHref}
          className="bg-primary text-primary-foreground flex min-h-12 items-center justify-center rounded-xl px-4 text-base font-semibold"
        >
          {t("loginToComment")}
        </Link>
      );
    if (writeState === "locked")
      return <p className={line}>{t("lockedLine")}</p>;
    if (writeState === "closed")
      return <p className={line}>{t("closedLine")}</p>;
    if (!first.canWrite) return <p className={line}>{t("cannotWrite")}</p>;
    return (
      <div ref={composerRef}>
        <CommentComposer
          code={code}
          channel={channel}
          needsCaptcha={first.needsCaptcha}
          sticky
          onSent={() => void changed()}
        />
      </div>
    );
  }

  const loading = q.isPending || groupDenied;

  return (
    <section className="space-y-3" aria-label={t("title")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        {first?.role === "host" &&
          eventId !== null &&
          writeState !== "closed" && (
            <button
              type="button"
              role="switch"
              aria-checked={locked}
              aria-label={t("lockToggle")}
              onClick={toggleLock}
              className="inline-flex min-h-11 items-center gap-2 text-base"
            >
              {t("lockToggle")}
              <span
                className={cn(
                  "inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors",
                  locked ? "bg-primary" : "bg-muted",
                )}
              >
                <span
                  className={cn(
                    "bg-background h-5 w-5 rounded-full transition-transform",
                    locked && "translate-x-5",
                  )}
                />
              </span>
            </button>
          )}
      </div>

      <TabSegment
        variant="rounded"
        ariaLabel={t("tabsLabel")}
        value={channel === "group" ? "nhom" : "qa"}
        onChange={(v) => void setKenh(v)}
        options={[
          { value: "qa", label: t("tabQa") },
          ...(showGroupTab
            ? [{ value: "nhom" as const, label: t("tabGroup") }]
            : []),
        ]}
      />

      <div className="flex items-center justify-between gap-2">
        <TabSegment
          ariaLabel={t("sortLabel")}
          value={sort}
          onChange={(v) => void setBl(v)}
          options={[
            { value: "top", label: t("sortTop") },
            { value: "new", label: t("sortNew") },
          ]}
        />
        <button
          type="button"
          onClick={() => void q.refetch()}
          disabled={q.isFetching}
          className="text-primary min-h-11 shrink-0 px-2 text-base font-medium disabled:opacity-50"
        >
          {t("loadNew")}
        </button>
      </div>

      {loading ? (
        <CommentSkeleton />
      ) : q.isError ? (
        <div className="space-y-2">
          <p className={line}>{t("loadError")}</p>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="bg-secondary text-secondary-foreground min-h-11 rounded-xl px-4 text-base font-medium"
          >
            {t("retry")}
          </button>
        </div>
      ) : (
        <>
          {held.length > 0 && (
            <div className="space-y-1 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2">
              <h3 className="text-base font-semibold">
                {t("heldQueue", { count: held.length })}
              </h3>
              {held.map((h) => (
                <CommentItem key={h.id} view={h} ctx={ctx} />
              ))}
            </div>
          )}
          {roots.length === 0 && held.length === 0 ? (
            <div className="space-y-3 py-6 text-center">
              <p className="text-base">
                {channel === "group" ? t("emptyGroup") : t("empty")}
              </p>
              {ctx.canWrite && (
                <button
                  type="button"
                  onClick={() =>
                    composerRef.current?.querySelector("textarea")?.focus()
                  }
                  className="bg-secondary text-secondary-foreground min-h-11 rounded-xl px-4 text-base font-medium"
                >
                  {t("writeCta")}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {roots.map((r) => (
                <CommentThread
                  key={r.id}
                  root={r}
                  ctx={ctx}
                  onLoadReplies={loadReplies}
                />
              ))}
            </div>
          )}
          {q.hasNextPage && (
            <button
              type="button"
              onClick={() => void q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
              className="bg-secondary text-secondary-foreground min-h-11 w-full rounded-xl text-base font-medium disabled:opacity-50"
            >
              {t("loadMore")}
            </button>
          )}
          {writeArea()}
        </>
      )}
    </section>
  );
}
