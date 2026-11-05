"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  blockRegistrant,
  cancelExchangeEvent,
  decideRegistration,
  finishExchangeEvent,
  markNoShow,
  setCheckedIn,
  setDepositReceived,
  setRegistrationPaid,
  settleWaitlist,
  unblockMember,
  unlockExchangeFees,
} from "@/actions/exchange-host";
import type { ManageReg, ManageView } from "@/actions/exchange-host";
import { ReportSheet } from "@/components/exchange/report-sheet";
import { ResponsiveSheet } from "@/components/exchange/responsive-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { TabSegment } from "@/components/shared/tab-segment";
import {
  CHARGEABLE_STATUSES,
  CHECKIN_CLOSE_AFTER_DAYS,
  CHECKIN_OPEN_BEFORE_MIN,
  type ExchangeEventStatus,
} from "@/lib/exchange/constants";
import { registrationSettlement } from "@/lib/exchange-fee";
import { fireAction } from "@/lib/optimistic-action";
import { cn, formatVND } from "@/lib/utils";
import { EditEventSheet } from "./edit-event-sheet";
import { LockFeeSheet } from "./lock-fee-sheet";
import {
  RegistrationRow,
  type RowContext,
  type RowHandlers,
} from "./registration-row";

type Tab = "pending" | "joined" | "waitlist" | "cancelled";

const TAB_OF: Record<string, Tab> = {
  pending: "pending",
  approved: "joined",
  no_show: "joined",
  waitlist: "waitlist",
  rejected: "cancelled",
  cancelled: "cancelled",
  late_cancelled: "cancelled",
};

const STATUS_KEY: Record<ExchangeEventStatus, string> = {
  open: "statusOpen",
  full: "statusFull",
  locked: "statusLocked",
  done: "statusDone",
  cancelled: "statusCancelled",
};

const BTN =
  "inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-base font-medium disabled:opacity-50";

/**
 * Trang quản lý của host. Mọi nút là lạc quan qua `fireAction`: sửa state cục
 * bộ ngay, hoàn lại và `toast.error` khi server từ chối. Số tiền của từng
 * người (`remaining`, `refundDue`) luôn đi qua `registrationSettlement`, hàm
 * server cũng dùng; các tổng ở đầu trang cộng từ chính các dòng đó nên tự hoàn
 * lại theo. Không tự làm mới theo giờ: nút "Tải lại" và `router.refresh()` sau
 * mỗi thao tác thành công là chỗ duy nhất kéo số thật từ server.
 */
export function ManageClient({ view }: { view: ManageView }) {
  const t = useTranslations("exchange.manage");
  const tEvent = useTranslations("exchange.event");
  const router = useRouter();
  const { event, eventId } = view;

  const [seen, setSeen] = useState(view);
  const [regs, setRegs] = useState(view.regs);
  const [status, setStatus] = useState<ExchangeEventStatus>(event.status);
  const [slotsTotal, setSlotsTotal] = useState(event.slotsTotal);
  const [blocks, setBlocks] = useState(view.blocks);
  const [blockedIds, setBlockedIds] = useState<ReadonlySet<number>>(new Set());
  // Props mới (sau `router.refresh()`) thay hết state cục bộ, kể cả bản lạc quan.
  if (seen !== view) {
    setSeen(view);
    setRegs(view.regs);
    setStatus(view.event.status);
    setSlotsTotal(view.event.slotsTotal);
    setBlocks(view.blocks);
    setBlockedIds(new Set());
  }

  const [tab, setTab] = useState<Tab>(() =>
    view.regs.some((r) => r.status === "pending") ? "pending" : "joined",
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Chỉ để mở/đóng nút điểm danh theo giờ máy; không gọi server.
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [lockOpen, setLockOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [moreFor, setMoreFor] = useState<ManageReg | null>(null);
  const [blockFor, setBlockFor] = useState<ManageReg | null>(null);
  const [reportFor, setReportFor] = useState<ManageReg | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [settling, setSettling] = useState(false);

  const isOpen = status === "open" || status === "full";
  const startMs = new Date(event.startAt).getTime();
  const endMs = new Date(event.endAt).getTime();
  const checkInOpen =
    status !== "cancelled" &&
    now >= startMs - CHECKIN_OPEN_BEFORE_MIN * 60_000 &&
    now <= endMs + CHECKIN_CLOSE_AFTER_DAYS * 86_400_000;
  const ctx: RowContext = {
    depositAmount: event.depositAmount,
    canMarkPaid: status === "locked" || status === "done",
    open: isOpen,
    checkInOpen,
    started: now >= startMs,
  };

  const sync = () => router.refresh();

  /** Sửa một đăng ký ngay; trả hàm hoàn lại đúng dòng đó. */
  function patch(id: number, change: Partial<ManageReg>): () => void {
    const prev = regs.find((r) => r.id === id);
    if (!prev) return () => {};
    setRegs((cur) =>
      cur.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...change };
        return {
          ...next,
          ...registrationSettlement(next, event.depositAmount, status),
        };
      }),
    );
    return () => setRegs((cur) => cur.map((r) => (r.id === id ? prev : r)));
  }

  const handlers: RowHandlers = {
    onDecide: (r, decision) => {
      const undo = patch(r.id, {
        status: decision === "approve" ? "approved" : "rejected",
        waitlistPos: null,
      });
      fireAction(
        () => decideRegistration({ registrationId: r.id, decision }),
        undo,
        { onSuccess: sync },
      );
    },
    onDeposit: (r, received) => {
      const undo = patch(r.id, { depositPaid: received });
      fireAction(
        () => setDepositReceived({ registrationId: r.id, received }),
        undo,
        { onSuccess: sync },
      );
    },
    onCheckIn: (r, checkedIn) => {
      const undo = patch(r.id, {
        checkedIn,
        ...(checkedIn ? { status: "approved" } : {}),
      });
      fireAction(() => setCheckedIn({ registrationId: r.id, checkedIn }), undo);
    },
    onNoShow: (r) => {
      const undo = patch(r.id, { status: "no_show" });
      fireAction(() => markNoShow({ registrationId: r.id }), undo, {
        onSuccess: sync,
      });
    },
    onPaid: (r, paid) => {
      const undo = patch(r.id, {
        paid,
        paidAmount: paid ? r.feeAmount : null,
      });
      fireAction(
        () => setRegistrationPaid({ registrationId: r.id, paid }),
        undo,
        { onSuccess: sync },
      );
    },
    onMore: setMoreFor,
  };

  function settle() {
    if (settling) return;
    setSettling(true);
    let promoted = 0;
    fireAction(
      async () => {
        const r = await settleWaitlist({ eventId });
        if ("error" in r) return r;
        promoted = r.data.promoted;
        return r;
      },
      undefined,
      {
        retry: false,
        onSuccess: () => {
          setSettling(false);
          toast.success(t("settled", { count: promoted }));
          sync();
        },
        onError: () => setSettling(false),
      },
    );
  }

  function unlock() {
    const prev = status;
    setStatus("open");
    fireAction(
      () => unlockExchangeFees({ eventId }),
      () => setStatus(prev),
      {
        onSuccess: sync,
      },
    );
  }

  function finish() {
    const prev = status;
    setStatus("done");
    fireAction(
      () => finishExchangeEvent({ eventId }),
      () => setStatus(prev),
      { onSuccess: sync },
    );
  }

  function cancelEvent() {
    const prev = status;
    setStatus("cancelled");
    fireAction(
      () => cancelExchangeEvent({ eventId }),
      () => setStatus(prev),
      { onSuccess: sync },
    );
  }

  function block(r: ManageReg) {
    setBlockedIds((s) => new Set(s).add(r.id));
    fireAction(
      () => blockRegistrant({ registrationId: r.id }),
      () =>
        setBlockedIds((s) => {
          const next = new Set(s);
          next.delete(r.id);
          return next;
        }),
      { onSuccess: sync },
    );
  }

  function unblock(b: { id: number; name: string }) {
    const prev = blocks;
    setBlocks((cur) => cur.filter((x) => x.id !== b.id));
    fireAction(
      () => unblockMember({ blockId: b.id }),
      () => setBlocks(prev),
      {
        onSuccess: sync,
      },
    );
  }

  const counts = useMemo(() => {
    const c: Record<Tab, number> = {
      pending: 0,
      joined: 0,
      waitlist: 0,
      cancelled: 0,
    };
    for (const r of regs) c[TAB_OF[r.status] ?? "cancelled"] += 1;
    return c;
  }, [regs]);

  const totals = useMemo(() => {
    let collected = 0;
    let outstanding = 0;
    let refund = 0;
    for (const r of regs) {
      if (r.paid) collected += r.paidAmount ?? 0;
      else if (r.depositPaid) collected += event.depositAmount;
      outstanding += r.remaining;
      refund += r.refundDue;
    }
    return { collected, outstanding, refund };
  }, [regs, event.depositAmount]);

  const visible = regs.filter((r) => (TAB_OF[r.status] ?? "cancelled") === tab);
  const showReserve =
    view.reserveOpened && regs.some((r) => r.status === "waitlist");
  const needsRelock =
    status === "locked" &&
    regs.some(
      (r) =>
        r.feeAmount !== null &&
        !(CHARGEABLE_STATUSES as readonly string[]).includes(r.status),
    );
  const filled = regs
    .filter((r) => r.status === "pending" || r.status === "approved")
    .reduce((s, r) => s + r.maleCount + r.femaleCount, 0);

  const emptyKey = {
    pending: "emptyPending",
    joined: "emptyJoined",
    waitlist: "emptyWaitlist",
    cancelled: "emptyCancelled",
  }[tab];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-28 sm:pb-0">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/giao-luu/${event.code}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-base font-medium"
        >
          <ArrowLeft className="h-5 w-5" />
          {t("back")}
        </Link>
        <button type="button" onClick={sync} className={cn(BTN, "gap-1.5")}>
          <RefreshCw className="h-4 w-4" />
          {t("reload")}
        </button>
      </div>

      <header className="space-y-1">
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-xl font-bold break-words">
            {event.title}
          </h1>
          <span className="bg-muted shrink-0 rounded-full px-3 py-1 text-sm font-semibold">
            {tEvent(STATUS_KEY[status])}
          </span>
        </div>
        <p className="text-muted-foreground text-base">
          {t("slotsLine", { filled, total: slotsTotal })}
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["sumCollected", totals.collected],
            ["sumOutstanding", totals.outstanding],
            ["sumRefund", totals.refund],
          ] as const
        ).map(([key, value]) => (
          <div
            key={key}
            className="bg-card/80 rounded-2xl border p-3 backdrop-blur"
          >
            <p className="text-muted-foreground text-sm">{t(key)}</p>
            <p className="text-base font-semibold tabular-nums">
              {formatVND(value)}
            </p>
          </div>
        ))}
      </div>

      {showReserve && (
        <div className="bg-primary/10 flex flex-wrap items-center gap-3 rounded-2xl border p-3">
          <p className="min-w-0 flex-1 text-base font-semibold">
            {t("reserveBanner", { count: event.femaleReservedSlots })}
          </p>
          <button
            type="button"
            disabled={settling}
            onClick={settle}
            className={cn(
              BTN,
              "border-primary bg-primary text-primary-foreground",
            )}
          >
            {t("settle")}
          </button>
        </div>
      )}

      {needsRelock && (
        <div
          role="status"
          className="rounded-2xl border border-amber-500/60 bg-amber-500/10 p-3"
        >
          <p className="text-base font-semibold">{t("relockBanner")}</p>
          <p className="text-base">{t("relockHint")}</p>
        </div>
      )}

      <TabSegment<Tab>
        variant="rounded"
        ariaLabel={t("tabsLabel")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "pending", label: t("tabPending"), badge: counts.pending },
          { value: "joined", label: t("tabJoined"), badge: counts.joined },
          {
            value: "waitlist",
            label: t("tabWaitlist"),
            badge: counts.waitlist,
          },
          {
            value: "cancelled",
            label: t("tabCancelled"),
            badge: counts.cancelled,
          },
        ]}
      />

      {visible.length === 0 ? (
        <p className="text-muted-foreground rounded-2xl border border-dashed p-6 text-center text-base">
          {t(emptyKey)}
        </p>
      ) : (
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {visible.map((r) => (
              <RegistrationRow
                key={r.id}
                reg={r}
                ctx={ctx}
                blocked={blockedIds.has(r.id)}
                handlers={handlers}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      {blocks.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">{t("blocksTitle")}</h2>
          <ul className="space-y-2">
            {blocks.map((b) => (
              <li
                key={b.id}
                className="flex items-center gap-3 rounded-xl border p-2 pl-3"
              >
                <span className="min-w-0 flex-1 truncate text-base">
                  {b.name}
                </span>
                <button
                  type="button"
                  onClick={() => unblock(b)}
                  className={BTN}
                >
                  {t("unblock")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {isOpen && (
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className={BTN}
          >
            {t("editBtn")}
          </button>
        )}
        {status === "locked" && (
          <button
            type="button"
            disabled={now < startMs}
            onClick={() => setFinishOpen(true)}
            className={BTN}
          >
            {t("finishBtn")}
          </button>
        )}
        {(isOpen || status === "locked") && (
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className={cn(BTN, "text-destructive")}
          >
            {t("cancelBtn")}
          </button>
        )}
      </div>

      {(isOpen || status === "locked") && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0"
        >
          {isOpen ? (
            <button
              type="button"
              onClick={() => setLockOpen(true)}
              className="bg-primary text-primary-foreground min-h-12 w-full rounded-xl text-base font-semibold"
            >
              {t("lockBtn")}
            </button>
          ) : (
            <button
              type="button"
              onClick={unlock}
              className="bg-primary text-primary-foreground min-h-12 w-full rounded-xl text-base font-semibold"
            >
              {t("unlockBtn")}
            </button>
          )}
        </motion.div>
      )}

      {lockOpen && (
        <LockFeeSheet
          open
          onOpenChange={setLockOpen}
          eventId={eventId}
          feeConfig={view.feeConfig}
          regs={regs}
          onLocked={() => {
            setStatus("locked");
            sync();
          }}
        />
      )}

      {editOpen && (
        <EditEventSheet
          open
          onOpenChange={setEditOpen}
          eventId={eventId}
          slotsTotal={slotsTotal}
          description={event.description ?? ""}
          hostContact={view.hostContact}
          zaloGroupLink={view.zaloGroupLink}
          onSlots={setSlotsTotal}
          onSaved={sync}
        />
      )}

      <ResponsiveSheet
        open={moreFor !== null}
        onOpenChange={(o) => !o && setMoreFor(null)}
        title={t("moreTitle", { name: moreFor?.name ?? "" })}
      >
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className={BTN}
            onClick={() => {
              setReportFor(moreFor);
              setMoreFor(null);
            }}
          >
            {t("report")}
          </button>
          <button
            type="button"
            className={cn(BTN, "text-destructive")}
            onClick={() => {
              setBlockFor(moreFor);
              setMoreFor(null);
            }}
          >
            {t("block")}
          </button>
        </div>
      </ResponsiveSheet>

      <ConfirmDialog
        open={blockFor !== null}
        onOpenChange={(o) => !o && setBlockFor(null)}
        title={t("blockTitle", { name: blockFor?.name ?? "" })}
        description={t("blockBody")}
        confirmLabel={t("blockConfirm")}
        variant="destructive"
        onConfirm={() => {
          if (blockFor) block(blockFor);
        }}
      />
      <ConfirmDialog
        open={finishOpen}
        onOpenChange={setFinishOpen}
        title={t("finishTitle")}
        description={t("finishBody")}
        confirmLabel={t("finishConfirm")}
        onConfirm={finish}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t("cancelTitle")}
        description={t("cancelBody")}
        confirmLabel={t("cancelConfirm")}
        cancelLabel={t("cancelKeep")}
        variant="destructive"
        onConfirm={cancelEvent}
      />

      {reportFor && (
        <ReportSheet
          open
          onOpenChange={(o) => !o && setReportFor(null)}
          code={event.code}
          registrationId={reportFor.id}
        />
      )}
    </div>
  );
}
