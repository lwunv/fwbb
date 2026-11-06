"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import {
  listExchangeComments,
  markCommentsRead,
  setCommentsLocked,
} from "@/actions/exchange-comments";
import { EmptyState } from "@/components/shared/empty-state";
import { TabSegment } from "@/components/shared/tab-segment";
import type { CommentView } from "@/lib/exchange/comment-tree";
import { Switch } from "@/components/ui/switch";
import { fireAction } from "@/lib/optimistic-action";
import { CommentComposer } from "./comment-composer";
import { CommentItem, type CommentCtx } from "./comment-item";
import { CommentSkeleton } from "./comment-skeleton";
import { CommentThread } from "./comment-thread";
import { useOpenThreads } from "./use-open-threads";

const KENH = ["qa", "nhom"] as const;
const SORTS = ["top", "new"] as const;

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
  // `signedIn` chỉ là gợi ý ban đầu; khi trang đầu về thì vai trò thật của server thắng.
  // Khách không bao giờ có Nhóm buổi: về Hỏi đáp ngay, không gọi server.
  const channel = kenh === "nhom" && signedIn ? "group" : "qa";
  const sort = bl ?? (channel === "group" ? "new" : "top");

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
    // Khu Nhóm buổi không đọc được trả lỗi ngay: thử lại chỉ làm màn chờ lâu thêm.
    retry: (count) => channel !== "group" && count < 3,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const first = q.data?.pages[0];
  const viewerIn = first ? first.role !== "guest" : signedIn;

  // Vào ?kenh=nhom mà không đọc được: về Hỏi đáp, không báo lỗi.
  const groupDenied =
    channel === "group" && (q.isError || first?.canRead.group === false);
  useEffect(() => {
    if (groupDenied || (kenh === "nhom" && !signedIn)) void setKenh("qa");
  }, [groupDenied, kenh, signedIn, setKenh]);

  // Đánh dấu đã đọc một lần cho mỗi khu; lỗi ở đây không đáng làm phiền người đọc.
  const newestAt = first?.newestAt ?? null;
  const unread = first?.unread ?? false;
  useEffect(() => {
    if (!viewerIn || !unread || !newestAt || marked.current.has(channel))
      return;
    marked.current.add(channel);
    void markCommentsRead({ code, channel, upTo: newestAt }).catch(() => {});
  }, [viewerIn, unread, newestAt, channel, code]);

  async function changed(): Promise<void> {
    await qc.invalidateQueries({ queryKey: ["exchange-comments", code] });
    setLockOverride(null);
  }

  const { apply, patch, begin, end, loadReplies, addTemp, rootTemps } =
    useOpenThreads(q.data?.pages, q.dataUpdatedAt, channel);

  const seen = new Set<number>();
  const roots: CommentView[] = [];
  for (const p of q.data?.pages ?? []) {
    for (const r of p.roots) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      roots.push(apply(r));
    }
  }
  // Gốc vừa gửi: mới nhất ở đầu khi sắp "Mới nhất", cuối danh sách khi "Hữu ích".
  // Nằm ngoài AnimatePresence: dòng tạm không có exit animation, nếu không nó còn
  // lại một nhịp cạnh bình luận thật vừa về (thấy hai bản).
  const temps = rootTemps();
  if (sort === "new") temps.reverse();
  const held = (first?.hostHeld ?? [])
    .map(apply)
    .filter((h) => h.state === "held");

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
    signedIn: viewerIn,
    canWrite: !!first?.canWrite && writeState === "open",
    needsCaptcha: first?.needsCaptcha ?? false,
    patch,
    begin,
    end,
    changed,
    addTemp,
  };

  const showGroupTab = viewerIn && !!first?.canRead.group;
  const loginHref = `/giao-luu/dang-nhap?next=${encodeURIComponent(`/giao-luu/${code}`)}`;
  const line = "text-muted-foreground text-base";

  function writeArea() {
    if (!first) return null;
    if (writeState === "closed")
      return <p className={line}>{t("closedLine")}</p>;
    if (!viewerIn)
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
    if (!first.canWrite) return <p className={line}>{t("cannotWrite")}</p>;
    return (
      <div ref={composerRef}>
        <CommentComposer
          code={code}
          channel={channel}
          needsCaptcha={first.needsCaptcha}
          onPending={(body) => addTemp(null, body)}
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
            <div className="flex items-center gap-1 text-base">
              <span>{t("lockToggle")}</span>
              <Switch
                checked={locked}
                onCheckedChange={() => toggleLock()}
                aria-label={t("lockToggle")}
              />
            </div>
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
          className="text-primary min-h-11 min-w-11 shrink-0 px-2 text-base font-medium disabled:opacity-50"
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
          {writeArea()}
          {held.length > 0 && (
            <div className="border-warning/40 bg-warning/10 space-y-1 rounded-2xl border px-4 py-2">
              <h3 className="text-base font-semibold">
                {t("heldQueue", { count: held.length })}
              </h3>
              {held.map((h) => (
                <CommentItem key={h.id} view={h} ctx={ctx} />
              ))}
            </div>
          )}
          {roots.length === 0 && temps.length === 0 && held.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title={channel === "group" ? t("emptyGroup") : t("empty")}
              action={
                ctx.canWrite ? (
                  <button
                    type="button"
                    onClick={() =>
                      composerRef.current?.querySelector("textarea")?.focus()
                    }
                    className="bg-secondary text-secondary-foreground min-h-11 min-w-11 rounded-xl px-4 text-base font-medium"
                  >
                    {t("writeCta")}
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-3">
              {sort === "new" &&
                temps.map((r) => (
                  <CommentThread
                    key={r.id}
                    root={r}
                    ctx={ctx}
                    onLoadReplies={loadReplies}
                  />
                ))}
              <AnimatePresence initial={false}>
                {roots.map((r) => (
                  <motion.div
                    key={r.id}
                    layout
                    initial={{ y: 8 }}
                    animate={{ y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                  >
                    <CommentThread
                      root={r}
                      ctx={ctx}
                      onLoadReplies={loadReplies}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              {sort !== "new" &&
                temps.map((r) => (
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
        </>
      )}
    </section>
  );
}
