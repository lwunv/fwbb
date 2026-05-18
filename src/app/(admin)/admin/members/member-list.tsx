"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  createMember,
  updateMember,
  toggleMemberActive,
  deleteMember,
  linkAdminToMember,
} from "@/actions/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { TabSegment } from "@/components/shared/tab-segment";
import { SearchInput } from "@/components/shared/search-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Edit,
  Lock,
  LockOpen,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Trash2,
  Crown,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { confirmPaymentByAdmin } from "@/actions/finance";
import { fireAction } from "@/lib/optimistic-action";
import { getFundStatus } from "@/lib/fund-core";
import { cn, formatK } from "@/lib/utils";
import { usePolling } from "@/lib/use-polling";
import type { InferSelectModel } from "drizzle-orm";
import type { members as membersTable } from "@/db/schema";

type Member = InferSelectModel<typeof membersTable>;

interface MemberDebt {
  id: number;
  sessionId: number;
  sessionDate: string;
  totalAmount: number;
  memberConfirmed: boolean;
}

const PAGE_SIZE = 20;

type StatusFilter = "all" | "active" | "locked" | "hasDebt" | "lowFund";

export function MemberList({
  members,
  debtsByMember = {},
  currentAdminMemberId = null,
  memberBalances = {},
  fundMemberIds = [],
}: {
  members: Member[];
  debtsByMember?: Record<number, MemberDebt[]>;
  /** memberId của admin hiện tại — render 👑 + nút "Đặt làm admin". */
  currentAdminMemberId?: number | null;
  memberBalances?: Record<number, number>;
  /** Danh sách memberId đang active trong quỹ — dùng để render chip "Đã vào quỹ". */
  fundMemberIds?: number[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingNicknameId, setEditingNicknameId] = useState<number | null>(
    null,
  );
  const [nicknameValue, setNicknameValue] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [toggledMembers, setToggledMembers] = useState<Record<number, boolean>>(
    {},
  );
  const [confirmedDebts, setConfirmedDebts] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());
  const [adminMemberId, setAdminMemberId] = useState<number | null>(
    currentAdminMemberId,
  );
  // Sync khi prop đổi (sau revalidatePath)
  const [prevAdminMemberId, setPrevAdminMemberId] = useState<number | null>(
    currentAdminMemberId,
  );
  if (currentAdminMemberId !== prevAdminMemberId) {
    setPrevAdminMemberId(currentAdminMemberId);
    setAdminMemberId(currentAdminMemberId);
  }

  const fundMemberSet = useMemo(() => new Set(fundMemberIds), [fundMemberIds]);

  const t = useTranslations("adminMembers");
  function handleLinkAdmin(memberId: number) {
    const prev = adminMemberId;
    setAdminMemberId(memberId);
    fireAction(
      () => linkAdminToMember(memberId),
      () => setAdminMemberId(prev),
      { successMsg: t("toastLinkedAdmin") },
    );
  }
  const tF = useTranslations("finance");
  const tCommon = useTranslations("common");
  const tFs = useTranslations("fundStatus");
  usePolling();

  function fundStatusInfoFor(balance: number) {
    const status = getFundStatus(balance);
    const balanceColor =
      status === "owing"
        ? "text-rose-600 dark:text-rose-400"
        : status === "depleted"
          ? "text-yellow-600 dark:text-yellow-400"
          : status === "lowFund"
            ? "text-orange-600 dark:text-orange-400"
            : "text-blue-600 dark:text-blue-400";

    return (
      <div className="flex shrink-0 items-center gap-1.5">
        <span className={`text-sm font-semibold tabular-nums ${balanceColor}`}>
          {formatK(balance)}
        </span>
        {status !== "hasFund" && (
          <StatusBadge
            variant={
              status === "owing"
                ? "unpaid"
                : status === "depleted"
                  ? "depleted"
                  : "lowFund"
            }
            className="shrink-0"
          >
            {tFs(status)}
          </StatusBadge>
        )}
      </div>
    );
  }

  function handleToggle(memberId: number, currentActive: boolean) {
    setToggledMembers((prev) => ({ ...prev, [memberId]: !currentActive }));
    fireAction(
      () => toggleMemberActive(memberId),
      () =>
        setToggledMembers((prev) => ({ ...prev, [memberId]: currentActive })),
    );
  }

  function handleHardDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    setDeletedIds((prev) => new Set(prev).add(id));
    fireAction(
      () => deleteMember(id),
      () =>
        setDeletedIds((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        }),
    );
  }

  function handleConfirmPayment(debtId: number) {
    setConfirmedDebts((prev) => new Set(prev).add(debtId));
    fireAction(
      () => confirmPaymentByAdmin(debtId),
      () =>
        setConfirmedDebts((prev) => {
          const next = new Set(prev);
          next.delete(debtId);
          return next;
        }),
    );
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = members.filter((m) => {
      // ẩn member đã optimistic-delete; nếu server reject (vd còn nợ),
      // fireAction rollback set → member xuất hiện lại.
      if (deletedIds.has(m.id)) return false;
      // status filter
      if (statusFilter === "active" && !m.isActive) return false;
      if (statusFilter === "locked" && m.isActive) return false;
      if (statusFilter === "hasDebt" && !debtsByMember[m.id]?.length)
        return false;
      if (
        statusFilter === "lowFund" &&
        getFundStatus(memberBalances[m.id] ?? 0) !== "lowFund"
      )
        return false;
      // search filter
      if (!q) return true;
      return m.name.toLowerCase().includes(q);
    });
    // Sort: members with debt first (by total debt desc), then alphabetical
    return list.sort((a, b) => {
      const debtA = (debtsByMember[a.id] ?? []).reduce(
        (s, d) => s + d.totalAmount,
        0,
      );
      const debtB = (debtsByMember[b.id] ?? []).reduce(
        (s, d) => s + d.totalAmount,
        0,
      );
      if (debtA > 0 && debtB === 0) return -1;
      if (debtA === 0 && debtB > 0) return 1;
      if (debtA > 0 && debtB > 0) return debtB - debtA;
      return a.name.localeCompare(b.name);
    });
  }, [
    members,
    search,
    statusFilter,
    debtsByMember,
    deletedIds,
    memberBalances,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  // Reset page when search/filter changes
  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
  };
  const handleFilter = (val: StatusFilter) => {
    setStatusFilter(val);
    setPage(1);
  };

  function handleCreate(formData: FormData) {
    setDialogOpen(false);
    fireAction(
      () => createMember(formData),
      () => {
        setDialogOpen(true);
      },
    );
  }

  function handleSaveNickname(memberId: number, memberName: string) {
    const formData = new FormData();
    formData.set("name", memberName);
    formData.set("nickname", nicknameValue);
    setEditingNicknameId(null);
    fireAction(() => updateMember(memberId, formData));
  }

  const filterButtons: { key: StatusFilter; label: string }[] = [
    { key: "all", label: t("all") },
    { key: "active", label: t("filterActive") },
    { key: "locked", label: t("filterLocked") },
    { key: "hasDebt", label: t("filterHasDebt") },
    { key: "lowFund", label: t("filterLowFund") },
  ];

  return (
    <div className="">
      {/* count moved to filter row */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        {/* Sticky bottom add button */}
        <div className="bg-background/95 fixed right-0 bottom-0 left-0 z-30 border-t p-3 backdrop-blur lg:left-60">
          <DialogTrigger render={<Button className="w-full" size="lg" />}>
            <Plus className="mr-2 h-4 w-4" /> {t("addMember")}
          </DialogTrigger>
        </div>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addNewMember")}</DialogTitle>
          </DialogHeader>
          <form action={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("name")}</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nickname">{t("nickname")}</Label>
              <Input id="nickname" name="nickname" />
            </div>
            <Button type="submit" className="w-full">
              {tCommon("add")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Search box */}
      <SearchInput
        value={search}
        onChange={handleSearch}
        placeholder={t("searchPlaceholder")}
        containerClassName="mb-3"
      />

      {/* Status filter + count */}
      <div className="mb-4 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <TabSegment<StatusFilter>
            variant="pills"
            value={statusFilter}
            onChange={(v) => handleFilter(v)}
            options={filterButtons.map(({ key, label }) => ({
              value: key,
              label,
            }))}
          />
        </div>
        <span className="text-muted-foreground shrink-0 text-sm whitespace-nowrap">
          {t("count", { count: filtered.length })}
        </span>
      </div>

      {/* Member cards */}
      <div className="grid gap-3">
        <AnimatePresence initial={false}>
          {paged.map((member) => {
            const debts = debtsByMember[member.id] ?? [];
            const totalDebt = debts.reduce((s, d) => s + d.totalAmount, 0);
            const unpaidAmount = debts
              .filter((d) => !d.memberConfirmed)
              .reduce((s, d) => s + d.totalAmount, 0);
            const waitingAmount = debts
              .filter((d) => d.memberConfirmed)
              .reduce((s, d) => s + d.totalAmount, 0);
            const isExpanded = expandedId === member.id;

            const memberIsActive = toggledMembers[member.id] ?? member.isActive;
            return (
              <motion.div
                key={member.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ type: "spring", stiffness: 320, damping: 28 }}
              >
                <Card>
                  <CardContent className="space-y-3 p-4">
                    {/* Info row */}
                    <div className="flex items-center gap-3">
                      <MemberAvatar
                        memberId={member.id}
                        avatarKey={member.avatarKey}
                        avatarUrl={member.avatarUrl}
                        size={40}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-base font-semibold">
                          {member.name}
                          {member.nickname && (
                            <span className="text-muted-foreground text-sm font-normal">
                              ({member.nickname})
                            </span>
                          )}
                          {adminMemberId === member.id && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400"
                              title={t("thisIsAdminBadge")}
                            >
                              <Crown className="h-3 w-3" />
                              {t("adminBadge")}
                            </span>
                          )}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                          fundMemberSet.has(member.id)
                            ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {fundMemberSet.has(member.id)
                          ? t("inFund")
                          : t("notInFund")}
                      </span>
                      {fundStatusInfoFor(memberBalances[member.id] ?? 0)}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleLinkAdmin(member.id)}
                        disabled={adminMemberId === member.id}
                        className={
                          adminMemberId === member.id
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground hover:text-amber-600"
                        }
                        title={
                          adminMemberId === member.id
                            ? t("linkAdminTooltipLinked")
                            : t("linkAdminTooltipSet")
                        }
                        aria-label={t("linkAdminAria")}
                      >
                        <Crown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(member)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        title={tCommon("delete")}
                        aria-label={tCommon("delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={memberIsActive ? "destructive" : "default"}
                        size="sm"
                        onClick={() => handleToggle(member.id, memberIsActive)}
                      >
                        {memberIsActive ? (
                          <>
                            <Lock className="mr-1.5 h-4 w-4" />
                            {t("lock")}
                          </>
                        ) : (
                          <>
                            <LockOpen className="mr-1.5 h-4 w-4" />
                            {t("unlock")}
                          </>
                        )}
                      </Button>
                    </div>
                    {/* Nickname edit row */}
                    {editingNicknameId === member.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={nicknameValue}
                          onChange={(e) => setNicknameValue(e.target.value)}
                          placeholder={t("nickname")}
                          className="flex-1"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleSaveNickname(member.id, member.name);
                            }
                            if (e.key === "Escape") setEditingNicknameId(null);
                          }}
                        />
                        <Button
                          size="sm"
                          onClick={() =>
                            handleSaveNickname(member.id, member.name)
                          }
                        >
                          <Check className="mr-1.5 h-4 w-4" />
                          {tCommon("save")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingNicknameId(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNicknameId(member.id);
                          setNicknameValue(member.nickname ?? "");
                        }}
                        className="border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-primary/50 flex w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm transition-colors"
                      >
                        <Edit className="h-5 w-5 shrink-0" />
                        <span>
                          {member.nickname
                            ? t("nicknameDisplay", {
                                nickname: member.nickname,
                              })
                            : t("addNickname")}
                        </span>
                      </button>
                    )}

                    {totalDebt > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setExpandedId(isExpanded ? null : member.id);
                          }}
                          className="mt-2 ml-12 flex items-center gap-2 py-1 text-sm font-medium hover:underline"
                        >
                          <span className="flex items-center gap-1">
                            {unpaidAmount > 0 && (
                              <span className="text-destructive">
                                {tF("owed")}: {formatK(unpaidAmount)}
                              </span>
                            )}
                            {unpaidAmount > 0 && waitingAmount > 0 && (
                              <span className="text-muted-foreground">·</span>
                            )}
                            {waitingAmount > 0 && (
                              <span className="text-amber-600 dark:text-amber-400">
                                {tF("waitingAdmin")}: {formatK(waitingAmount)}
                              </span>
                            )}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="text-muted-foreground h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="text-muted-foreground h-3.5 w-3.5" />
                          )}
                        </button>

                        {isExpanded && (
                          <div className="mt-2 ml-12 space-y-1.5">
                            {debts
                              .sort((a, b) =>
                                a.sessionDate.localeCompare(b.sessionDate),
                              )
                              .map((debt) => {
                                const d = new Date(debt.sessionDate);
                                const dayNames = [
                                  "CN",
                                  "T2",
                                  "T3",
                                  "T4",
                                  "T5",
                                  "T6",
                                  "T7",
                                ];
                                const dateStr = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} (${dayNames[d.getDay()]})`;

                                return (
                                  <div
                                    key={debt.id}
                                    className="bg-muted/50 flex items-center justify-between rounded-md px-3 py-1.5 text-sm"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-muted-foreground">
                                        {dateStr}
                                      </span>
                                      <span className="font-medium">
                                        {formatK(debt.totalAmount)}
                                      </span>
                                      {debt.memberConfirmed && (
                                        <StatusBadge variant="waiting">
                                          {tF("waitingAdmin")}
                                        </StatusBadge>
                                      )}
                                    </div>
                                    <Button
                                      size="sm"
                                      className="h-7 gap-1 text-xs"
                                      disabled={confirmedDebts.has(debt.id)}
                                      onClick={() =>
                                        handleConfirmPayment(debt.id)
                                      }
                                    >
                                      <Check className="h-3 w-3" />
                                      {tF("received")}
                                    </Button>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="icon"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-muted-foreground text-sm">
            {t("pageOf", { current: safePage, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="icon"
            disabled={safePage >= totalPages}
            onClick={() => setPage(safePage + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`${tCommon("delete")} ${deleteTarget?.name ?? ""}?`}
        description={tCommon("confirmHardDelete")}
        confirmLabel={tCommon("delete")}
        onConfirm={handleHardDelete}
      />
    </div>
  );
}
