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
  History,
  MoreVertical,
} from "lucide-react";
import { MemberPlayHistorySheet } from "@/components/members/member-play-history-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  FundAdjustDialog,
  type FundAdjustDialogTarget,
} from "@/components/fund/fund-adjust-dialog";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { CustomSelect } from "@/components/ui/custom-select";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
type SortMode =
  | "smart"
  | "balanceDesc"
  | "balanceAsc"
  | "newest"
  | "oldest"
  | "nameAsc";

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
  const [sortMode, setSortMode] = useState<SortMode>("smart");
  const [toggledMembers, setToggledMembers] = useState<Record<number, boolean>>(
    {},
  );
  const [confirmedDebts, setConfirmedDebts] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());
  const [fundAdjustTarget, setFundAdjustTarget] =
    useState<FundAdjustDialogTarget | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Member | null>(null);
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
  const tHistory = useTranslations("memberHistory");
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

  function balanceColorFor(balance: number): string {
    const status = getFundStatus(balance);
    return status === "owing"
      ? "text-rose-600 dark:text-rose-400"
      : status === "depleted"
        ? "text-yellow-600 dark:text-yellow-400"
        : status === "lowFund"
          ? "text-orange-600 dark:text-orange-400"
          : "text-blue-600 dark:text-blue-400";
  }

  // Viền trái card báo trạng thái ngay từ xa — khóa (isActive=false) ưu tiên
  // hiển thị màu xám trung tính bất kể quỹ, vì "tài khoản đang khóa" là tín
  // hiệu quan trọng hơn số dư của họ lúc đang khóa.
  function cardAccentClass(memberIsActive: boolean, balance: number): string {
    if (!memberIsActive) return "border-l-4 border-l-muted-foreground/40";
    const status = getFundStatus(balance);
    if (status === "owing")
      return "border-l-4 border-l-rose-500 dark:border-l-rose-400";
    if (status === "depleted")
      return "border-l-4 border-l-yellow-500 dark:border-l-yellow-400";
    if (status === "lowFund")
      return "border-l-4 border-l-orange-500 dark:border-l-orange-400";
    return "border-l-4 border-l-transparent";
  }

  function fundStatusInfoFor(balance: number) {
    const status = getFundStatus(balance);
    const balanceColor = balanceColorFor(balance);
    return (
      <div className="text-right">
        <p className={cn("text-base font-bold tabular-nums", balanceColor)}>
          {formatK(balance)}
        </p>
        <p className={cn("text-sm", balanceColor)}>{tFs(status)}</p>
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
    const idempotencyKey = crypto.randomUUID();
    fireAction(
      () => confirmPaymentByAdmin(debtId, idempotencyKey),
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
      // search filter — theo tên hoặc biệt danh (chưa có cột username riêng
      // trong schema; khi feature username được thêm thì search thêm ở đây).
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        (m.nickname ?? "").toLowerCase().includes(q)
      );
    });
    const bal = (id: number) => memberBalances[id] ?? 0;
    const created = (m: Member) => m.createdAt ?? "";
    return list.sort((a, b) => {
      switch (sortMode) {
        case "balanceDesc":
          return bal(b.id) - bal(a.id) || a.name.localeCompare(b.name);
        case "balanceAsc": // ít quỹ / nợ nhiều nhất trước
          return bal(a.id) - bal(b.id) || a.name.localeCompare(b.name);
        case "newest": // ngày đăng ký mới → cũ (createdAt ISO so lexicographic)
          return created(b).localeCompare(created(a));
        case "oldest":
          return created(a).localeCompare(created(b));
        case "nameAsc":
          return a.name.localeCompare(b.name);
        case "smart":
        default: {
          // Mặc định: ai đang nợ lên trước (nợ nhiều nhất), rồi A-Z.
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
        }
      }
    });
  }, [
    members,
    search,
    statusFilter,
    sortMode,
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

  const [partnerOverrides, setPartnerOverrides] = useState<
    Record<number, boolean>
  >({});

  // Optimistic toggle "đi 2 người" cho member. updateMember chỉ đổi
  // defaultWithPartner khi form CÓ field withPartner → an toàn với sửa nickname.
  function handleTogglePartner(m: Member) {
    const current = partnerOverrides[m.id] ?? m.defaultWithPartner;
    const next = !current;
    setPartnerOverrides((prev) => ({ ...prev, [m.id]: next }));
    const fd = new FormData();
    fd.set("name", m.name);
    fd.set("withPartner", next ? "1" : "0");
    fireAction(
      () => updateMember(m.id, fd),
      () => setPartnerOverrides((prev) => ({ ...prev, [m.id]: current })),
    );
  }

  function handleCreate(formData: FormData) {
    setDialogOpen(false);
    fireAction(
      () => createMember(formData),
      () => {
        setDialogOpen(true);
      },
      { successMsg: t("toastMemberAdded") },
    );
  }

  function handleSaveNickname(memberId: number, memberName: string) {
    const formData = new FormData();
    formData.set("name", memberName);
    formData.set("nickname", nicknameValue);
    setEditingNicknameId(null);
    fireAction(() => updateMember(memberId, formData), undefined, {
      successMsg: t("toastSaved"),
    });
  }

  // Bucket đếm sẵn cho mỗi chip filter — hiện luôn kể cả khi chip không active
  // (khớp mockup "Tất cả 12 / Hoạt động 10 / ..."). Đếm trên toàn bộ list
  // trước filter (chỉ trừ optimistic-deleted), không phải trên `filtered`.
  const liveMembers = useMemo(
    () => members.filter((m) => !deletedIds.has(m.id)),
    [members, deletedIds],
  );
  const statusCounts = useMemo(
    () => ({
      all: liveMembers.length,
      active: liveMembers.filter((m) => m.isActive).length,
      locked: liveMembers.filter((m) => !m.isActive).length,
      hasDebt: liveMembers.filter((m) => debtsByMember[m.id]?.length).length,
      lowFund: liveMembers.filter(
        (m) => getFundStatus(memberBalances[m.id] ?? 0) === "lowFund",
      ).length,
    }),
    [liveMembers, debtsByMember, memberBalances],
  );

  const filterButtons: { key: StatusFilter; label: string }[] = [
    { key: "all", label: t("all") },
    { key: "active", label: t("filterActive") },
    { key: "locked", label: t("filterLocked") },
    { key: "hasDebt", label: t("filterHasDebt") },
    { key: "lowFund", label: t("filterLowFund") },
  ];

  const SORT_OPTIONS: { value: SortMode; label: string }[] = [
    { value: "smart", label: t("sortSmart") },
    { value: "balanceDesc", label: t("sortBalanceDesc") },
    { value: "balanceAsc", label: t("sortBalanceAsc") },
    { value: "newest", label: t("sortNewest") },
    { value: "oldest", label: t("sortOldest") },
    { value: "nameAsc", label: t("sortNameAsc") },
  ];

  return (
    <div className="">
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        {/* Header: eyebrow + title lớn + "X / Y thành viên" + nút thêm (desktop) */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-primary text-xs font-semibold tracking-widest uppercase">
              {t("pageEyebrow")}
            </p>
            <h1 className="text-3xl font-bold sm:text-4xl">{t("pageTitle")}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("subtitleCount", {
                active: statusCounts.active,
                total: statusCounts.all,
              })}
            </p>
          </div>
          <DialogTrigger
            render={<Button size="lg" className="hidden md:inline-flex" />}
          >
            <Plus className="mr-2 h-4 w-4" /> {t("addMember")}
          </DialogTrigger>
        </div>

        {/* Sticky bottom add button — mobile only (desktop dùng nút ở header) */}
        <div className="bg-background/95 fixed right-0 bottom-0 left-0 z-30 border-t p-3 backdrop-blur md:hidden lg:left-60">
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
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="withPartner"
                value="1"
                className="accent-primary h-5 w-5 rounded"
              />
              👫 {t("memberWithPartner")}
            </label>
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

      {/* Status filter (kèm số lượng mỗi bucket) + sort — cùng 1 row từ sm: */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <TabSegment<StatusFilter>
            variant="pills"
            value={statusFilter}
            onChange={(v) => handleFilter(v)}
            options={filterButtons.map(({ key, label }) => ({
              value: key,
              label,
              badge: statusCounts[key],
            }))}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label
            htmlFor="member-sort"
            className="text-muted-foreground text-sm whitespace-nowrap"
          >
            {t("sortLabel")}
          </label>
          <CustomSelect
            name="member-sort"
            value={sortMode}
            onChange={(v) => {
              setSortMode(v as SortMode);
              setPage(1);
            }}
            options={SORT_OPTIONS}
            className="w-56"
          />
        </div>
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
                <Card
                  className={cardAccentClass(
                    memberIsActive,
                    memberBalances[member.id] ?? 0,
                  )}
                >
                  <CardContent className="space-y-3 p-4">
                    {/* Info row: avatar+tên+trạng thái bên trái, số dư+action bên
                        phải. flex-wrap để cụm bên phải rớt xuống dòng riêng khi
                        màn hẹp thay vì bị cắt (thay cho hàng dồn 9 phần tử cũ). */}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <MemberAvatar
                          memberId={member.id}
                          avatarKey={member.avatarKey}
                          avatarUrl={member.avatarUrl}
                          size={44}
                        />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="flex flex-wrap items-center gap-1.5 text-base font-semibold">
                            {member.name}
                            {member.nickname && (
                              <span className="text-muted-foreground text-sm font-normal">
                                ({member.nickname})
                              </span>
                            )}
                            {adminMemberId === member.id && (
                              <span
                                className="bg-primary/15 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                                title={t("thisIsAdminBadge")}
                              >
                                <Crown className="h-3 w-3" />
                                {t("adminBadge")}
                              </span>
                            )}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            <span className="text-muted-foreground inline-flex items-center gap-1.5">
                              <span
                                className={cn(
                                  "size-1.5 shrink-0 rounded-full",
                                  fundMemberSet.has(member.id)
                                    ? "bg-blue-500"
                                    : "bg-muted-foreground/50",
                                )}
                              />
                              {fundMemberSet.has(member.id)
                                ? t("inFund")
                                : t("notInFund")}
                            </span>
                            <label
                              className="text-muted-foreground inline-flex items-center gap-2"
                              title={t("memberWithPartner")}
                            >
                              {(partnerOverrides[member.id] ??
                              member.defaultWithPartner)
                                ? t("partnerOn")
                                : t("partnerOff")}
                              <Switch
                                checked={
                                  partnerOverrides[member.id] ??
                                  member.defaultWithPartner
                                }
                                onCheckedChange={() =>
                                  handleTogglePartner(member)
                                }
                              />
                            </label>
                          </div>
                        </div>
                      </div>

                      {/* flex-1/min-w-0 ở cụm avatar+tên có flex-basis 0 nên
                          KHÔNG tự tràn dòng theo flex-wrap của cha (spec
                          flexbox tính wrap theo hypothetical size, bằng 0 ở
                          đây) — ép cụm action xuống hàng riêng bằng basis-full
                          tường minh trên mobile, chỉ chung hàng từ sm: trở lên. */}
                      <div className="flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-normal">
                        <button
                          type="button"
                          onClick={() => {
                            const bal = memberBalances[member.id] ?? 0;
                            setFundAdjustTarget({
                              memberId: member.id,
                              memberName: member.name,
                              memberNickname: member.nickname,
                              memberAvatarKey: member.avatarKey ?? null,
                              memberAvatarUrl: member.avatarUrl ?? null,
                              currentBalance: bal,
                            });
                          }}
                          className="hover:bg-muted/50 -m-1 rounded-md p-1 transition-colors"
                          title="Click để cộng/trừ/sửa quỹ"
                        >
                          {fundStatusInfoFor(memberBalances[member.id] ?? 0)}
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-11 min-w-11"
                          onClick={() => setHistoryTarget(member)}
                          title={tHistory("openHistory")}
                          aria-label={tHistory("openHistory")}
                        >
                          <History className="h-4 w-4" />
                        </Button>
                        <Button
                          variant={memberIsActive ? "destructive" : "default"}
                          size="sm"
                          className="min-h-11"
                          onClick={() =>
                            handleToggle(member.id, memberIsActive)
                          }
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
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="min-h-11 min-w-11"
                                aria-label={tCommon("more")}
                              />
                            }
                          >
                            <MoreVertical className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingNicknameId(member.id);
                                setNicknameValue(member.nickname ?? "");
                              }}
                            >
                              <Edit className="h-4 w-4" />
                              {t("menuEditNickname")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleLinkAdmin(member.id)}
                              disabled={adminMemberId === member.id}
                            >
                              <Crown className="h-4 w-4" />
                              {t("menuSetAdmin")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleteTarget(member)}
                            >
                              <Trash2 className="h-4 w-4" />
                              {t("menuDelete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    {/* Nickname inline edit — mở từ menu "Sửa biệt danh" */}
                    {editingNicknameId === member.id && (
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
      <FundAdjustDialog
        target={fundAdjustTarget}
        open={fundAdjustTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFundAdjustTarget(null);
        }}
      />
      <MemberPlayHistorySheet
        memberId={historyTarget?.id ?? null}
        memberName={
          historyTarget ? historyTarget.nickname || historyTarget.name : ""
        }
        onClose={() => setHistoryTarget(null)}
      />
    </div>
  );
}
