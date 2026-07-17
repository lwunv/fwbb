"use client";

import { Fragment, useMemo, useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  createMember,
  updateMember,
  toggleMemberActive,
  deleteMember,
  linkAdminToMember,
  resetMemberPassword,
} from "@/actions/members";
import { toast } from "sonner";
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
  Trash2,
  Crown,
  History,
  MoreVertical,
  KeyRound,
  Copy,
} from "lucide-react";
import { MemberPlayHistorySheet } from "@/components/members/member-play-history-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  FundAdjustDialog,
  type FundAdjustDialogTarget,
} from "@/components/fund/fund-adjust-dialog";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { useConfirm } from "@/components/shared/confirm-provider";
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
import { cn, formatK, normalizeVietnamese } from "@/lib/utils";
import { ymdInVN } from "@/lib/date-format";
import { usePolling } from "@/lib/use-polling";
import type { MemberPlayStat } from "@/actions/stats";
import type { InferSelectModel } from "drizzle-orm";
import type { members as membersTable } from "@/db/schema";

type Member = InferSelectModel<typeof membersTable>;

/**
 * Số ngày member đã "nghỉ" tính từ buổi chơi gần nhất đến hôm nay (giờ VN).
 * null = chưa từng chơi. Neo cả 2 mốc ở 12:00 +07:00 để không lệch nửa ngày
 * do DST/nửa đêm; server-render `today` và client dùng chung `ymdInVN`.
 */
function restDaysFrom(
  lastPlayedDate: string | null | undefined,
  todayYmd: string,
): number | null {
  if (!lastPlayedDate) return null;
  const last = new Date(`${lastPlayedDate}T12:00:00+07:00`).getTime();
  const now = new Date(`${todayYmd}T12:00:00+07:00`).getTime();
  return Math.max(0, Math.round((now - last) / 86_400_000));
}

interface MemberDebt {
  id: number;
  sessionId: number;
  sessionDate: string;
  totalAmount: number;
  memberConfirmed: boolean;
}

const PAGE_SIZE = 20;

type StatusFilter =
  | "all"
  | "active"
  | "locked"
  | "hasDebt"
  | "lowFund"
  | "lowInteraction";
type SortMode =
  | "smart"
  | "balanceDesc"
  | "balanceAsc"
  | "newest"
  | "oldest"
  | "nameAsc"
  | "missedSessionsDesc"
  | "yearPlayDesc";

/** Ngưỡng "ít tương tác": quá 60 ngày không đi chơi (hoặc chưa từng đi). */
const LOW_INTERACTION_DAYS = 60;

export function MemberList({
  members,
  debtsByMember = {},
  currentAdminMemberId = null,
  memberBalances = {},
  fundMemberIds = [],
  playStats = {},
}: {
  members: Member[];
  debtsByMember?: Record<number, MemberDebt[]>;
  /** memberId của admin hiện tại — render 👑 + nút "Đặt làm admin". */
  currentAdminMemberId?: number | null;
  memberBalances?: Record<number, number>;
  /** Danh sách memberId đang active trong quỹ — dùng để render chip "Đã vào quỹ". */
  fundMemberIds?: number[];
  /** Thống kê buổi chơi/member: buổi tháng, buổi năm, ngày chơi gần nhất. */
  playStats?: Record<number, MemberPlayStat>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [infoEditTarget, setInfoEditTarget] = useState<Member | null>(null);
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
  // Kết quả reset password để hiện dialog mật khẩu tạm (1 lần).
  const [resetResult, setResetResult] = useState<{
    memberName: string;
    tempPassword: string;
  } | null>(null);
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
  // Hôm nay theo giờ VN — mốc chung để tính "nghỉ bao lâu" (khớp server render).
  const today = useMemo(() => ymdInVN(), []);
  // "Ít tương tác": nghỉ quá LOW_INTERACTION_DAYS ngày, hoặc chưa từng đi chơi.
  const isLowInteraction = (memberId: number) => {
    const r = restDaysFrom(playStats[memberId]?.lastPlayedDate, today);
    return r === null || r > LOW_INTERACTION_DAYS;
  };

  const t = useTranslations("adminMembers");
  const tHistory = useTranslations("memberHistory");
  const confirm = useConfirm();
  async function handleLinkAdmin(member: Member) {
    const ok = await confirm({
      title: t("setAdminConfirmTitle"),
      description: t("setAdminConfirm", { name: member.name }),
      confirmLabel: t("menuSetAdmin"),
      variant: "default",
    });
    if (!ok) return;
    const prev = adminMemberId;
    setAdminMemberId(member.id);
    fireAction(
      () => linkAdminToMember(member.id),
      () => setAdminMemberId(prev),
      { successMsg: t("toastLinkedAdmin") },
    );
  }
  async function handleUnlinkAdmin() {
    const ok = await confirm({
      title: t("unlinkAdminConfirmTitle"),
      description: t("unlinkAdminConfirm"),
      confirmLabel: t("menuUnlinkAdmin"),
    });
    if (!ok) return;
    const prev = adminMemberId;
    setAdminMemberId(null);
    fireAction(
      () => linkAdminToMember(null),
      () => setAdminMemberId(prev),
      { successMsg: t("toastUnlinkedAdmin") },
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

  // Khối số dư: số tiền (đậm, có màu theo trạng thái) trên, nhãn trạng thái
  // dưới. Căn trái để lắp vào bên trái tầng hành động của card (tap → sửa quỹ).
  function fundStatusInfoFor(balance: number) {
    const status = getFundStatus(balance);
    const balanceColor = balanceColorFor(balance);
    return (
      <div>
        <p className={cn("text-lg font-bold tabular-nums", balanceColor)}>
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

  async function handleResetPassword(member: Member) {
    const ok = await confirm({
      title: t("menuResetPassword"),
      description: t("resetPwConfirm", { name: member.name }),
      confirmLabel: t("menuResetPassword"),
    });
    if (!ok) return;
    const r = await resetMemberPassword(member.id);
    if (r && "error" in r && r.error) {
      toast.error(r.error);
      return;
    }
    if (r && "tempPassword" in r) {
      setResetResult({ memberName: member.name, tempPassword: r.tempPassword });
      toast.success(t("toastResetPw", { name: member.name }));
    }
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

  // Optimistic insert cho "Thêm thành viên": ghost row (id âm) hiện NGAY khi
  // submit, được thay bằng row thật sau revalidate. Ghost đúng ngữ nghĩa
  // (member mới thực sự balance 0, chưa nợ) nên card hiển thị chuẩn. Dọn ghost
  // theo pattern "adjust state on prop change" (không useEffect, tránh cascading
  // render) — khớp style file; chỉ bỏ ghost khi prop `members` đã có row thật
  // trùng tên, nên poll 5s không xoá overlay sớm.
  const [addedMembers, setAddedMembers] = useState<Member[]>([]);
  const [prevMembersProp, setPrevMembersProp] = useState(members);
  if (members !== prevMembersProp) {
    setPrevMembersProp(members);
    if (addedMembers.length > 0) {
      setAddedMembers((prev) =>
        prev.filter((g) => !members.some((m) => m.name === g.name)),
      );
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim();
    // Query chuẩn hoá bỏ dấu để khớp tên/biệt danh (gõ "phieu" ra "Phiêu").
    const qNorm = normalizeVietnamese(q);
    // Chỉ-số cho khớp SĐT: bỏ hết ký tự không phải số ở query.
    const qDigits = q.replace(/\D/g, "");
    const list = [...addedMembers, ...members].filter((m) => {
      // ẩn member đã optimistic-delete; nếu server reject (vd còn nợ),
      // fireAction rollback set → member xuất hiện lại.
      if (deletedIds.has(m.id)) return false;
      // status filter
      if (statusFilter === "active" && !m.isActive) return false;
      if (statusFilter === "locked" && m.isActive) return false;
      // "Còn nợ" = balance ÂM (mô hình Quỹ+Nợ gộp). KHÔNG dùng debtsByMember
      // (các session_debts chưa được admin xác nhận) vì finalizeSession đánh
      // dấu chúng đã-ghi-sổ ngay → bucket đó gần như luôn rỗng dù member đang nợ.
      if (
        statusFilter === "hasDebt" &&
        getFundStatus(memberBalances[m.id] ?? 0) !== "owing"
      )
        return false;
      if (
        statusFilter === "lowFund" &&
        getFundStatus(memberBalances[m.id] ?? 0) !== "lowFund"
      )
        return false;
      if (statusFilter === "lowInteraction" && !isLowInteraction(m.id))
        return false;
      // Search: tên/biệt danh khớp không phân biệt hoa thường + có/không dấu
      // (normalizeVietnamese); SĐT khớp theo chuỗi số (bỏ khoảng trắng/dấu).
      if (!q) return true;
      const nameHit =
        !!qNorm &&
        (normalizeVietnamese(m.name).includes(qNorm) ||
          normalizeVietnamese(m.nickname ?? "").includes(qNorm));
      const phoneHit =
        qDigits.length > 0 &&
        (m.phoneNumber ?? "").replace(/\D/g, "").includes(qDigits);
      return nameHit || phoneHit;
    });
    const bal = (id: number) => memberBalances[id] ?? 0;
    const created = (m: Member) => m.createdAt ?? "";
    const yearPlay = (id: number) => playStats[id]?.yearPlay ?? 0;
    // Số buổi đã nghỉ để sort: chưa từng chơi → vô hạn (lên đầu).
    const missed = (id: number) =>
      playStats[id]?.lastPlayedDate == null
        ? Number.POSITIVE_INFINITY
        : (playStats[id]?.missedSessions ?? 0);
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
        case "missedSessionsDesc": // nghỉ nhiều buổi nhất trước (chưa từng chơi lên đầu)
          return missed(b.id) - missed(a.id) || a.name.localeCompare(b.name);
        case "yearPlayDesc": // chơi nhiều nhất năm nay trước
          return (
            yearPlay(b.id) - yearPlay(a.id) || a.name.localeCompare(b.name)
          );
        case "smart":
        default: {
          // Mặc định: ai đang NỢ (balance âm) lên trước, nợ nhiều nhất trên
          // cùng, rồi A-Z. Dùng balance (mô hình Quỹ+Nợ gộp) thay cho
          // debtsByMember legacy (gần như luôn rỗng sau finalize).
          const owingA = bal(a.id) < 0;
          const owingB = bal(b.id) < 0;
          if (owingA && !owingB) return -1;
          if (!owingA && owingB) return 1;
          if (owingA && owingB) return bal(a.id) - bal(b.id); // âm nhất trước
          return a.name.localeCompare(b.name);
        }
      }
    });
    // isLowInteraction là closure của playStats+today (đã có trong deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    members,
    addedMembers,
    search,
    statusFilter,
    sortMode,
    deletedIds,
    memberBalances,
    playStats,
    today,
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
    // Toggle: bấm lại chip đang chọn → bỏ chọn, về "Tất cả". "all" thì luôn
    // giữ "all" (không tự toggle chính nó thành trạng thái rỗng vô nghĩa).
    setStatusFilter((prev) => (prev === val && val !== "all" ? "all" : val));
    setPage(1);
  };

  const [partnerOverrides, setPartnerOverrides] = useState<
    Record<number, boolean>
  >({});

  // Optimistic override cho name/nickname hiển thị trên card (email/phone không
  // render trên card nên không cần). Cùng pattern partnerOverrides: set trước
  // khi fireAction, revert trong rollback; prop mới sau revalidate vẫn hiển thị
  // đúng vì override chỉ đè khi có entry.
  const [infoOverrides, setInfoOverrides] = useState<
    Record<number, { name: string; nickname: string }>
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
    // Optimistic: chèn ghost card ngay. Member mới balance 0, chưa nợ, active +
    // approved (admin tạo trực tiếp). createdAt = now để sort "mới nhất" đúng.
    const name = String(formData.get("name") ?? "").trim();
    const nickname = (formData.get("nickname") as string)?.trim() || null;
    const withPartner = formData.get("withPartner") === "1";
    const tempId = -Date.now();
    // Ghost đầy đủ field (annotation Member → TS bắt thiếu field). Member admin
    // tạo trực tiếp mặc định approvalStatus "approved" + active; các field OAuth/
    // liên hệ để null. balance/nợ derive từ props khác (memberBalances) → 0.
    const ghost: Member = {
      id: tempId,
      name,
      nickname,
      avatarKey: null,
      facebookId: null,
      googleId: null,
      avatarUrl: null,
      email: null,
      passwordHash: null,
      phoneNumber: null,
      username: null,
      passwordResetExpiresAt: null,
      mustChangePassword: false,
      bankAccountNo: null,
      approvalStatus: "approved",
      approvedAt: null,
      approvedBy: null,
      isActive: true,
      defaultWithPartner: withPartner,
      createdAt: new Date().toISOString(),
    };
    setAddedMembers((prev) => [ghost, ...prev]);
    fireAction(
      () => createMember(formData),
      () => {
        setAddedMembers((prev) => prev.filter((m) => m.id !== tempId));
        setDialogOpen(true);
      },
      { successMsg: t("toastMemberAdded") },
    );
  }

  function handleSaveInfo(
    memberId: number,
    values: {
      name: string;
      nickname: string;
      email: string;
      phoneNumber: string;
      username: string;
    },
  ) {
    const formData = new FormData();
    formData.set("name", values.name);
    formData.set("nickname", values.nickname);
    formData.set("email", values.email);
    formData.set("phoneNumber", values.phoneNumber);
    formData.set("username", values.username);
    const prev = infoOverrides[memberId];
    setInfoOverrides((o) => ({
      ...o,
      [memberId]: { name: values.name, nickname: values.nickname },
    }));
    setInfoEditTarget(null);
    fireAction(
      () => updateMember(memberId, formData),
      () =>
        setInfoOverrides((o) => {
          const n = { ...o };
          if (prev) n[memberId] = prev;
          else delete n[memberId];
          return n;
        }),
      { successMsg: t("toastInfoSaved") },
    );
  }

  // Bucket đếm sẵn cho mỗi chip filter — hiện luôn kể cả khi chip không active
  // (khớp mockup "Tất cả 12 / Hoạt động 10 / ..."). Đếm trên toàn bộ list
  // trước filter (chỉ trừ optimistic-deleted), không phải trên `filtered`.
  const liveMembers = useMemo(
    () => [...addedMembers, ...members].filter((m) => !deletedIds.has(m.id)),
    [addedMembers, members, deletedIds],
  );
  const statusCounts = useMemo(
    () => ({
      all: liveMembers.length,
      active: liveMembers.filter((m) => m.isActive).length,
      locked: liveMembers.filter((m) => !m.isActive).length,
      hasDebt: liveMembers.filter(
        (m) => getFundStatus(memberBalances[m.id] ?? 0) === "owing",
      ).length,
      lowFund: liveMembers.filter(
        (m) => getFundStatus(memberBalances[m.id] ?? 0) === "lowFund",
      ).length,
      lowInteraction: liveMembers.filter((m) => isLowInteraction(m.id)).length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveMembers, memberBalances, playStats, today],
  );

  const filterButtons: { key: StatusFilter; label: string }[] = [
    { key: "all", label: t("all") },
    { key: "active", label: t("filterActive") },
    { key: "locked", label: t("filterLocked") },
    { key: "hasDebt", label: t("filterHasDebt") },
    { key: "lowFund", label: t("filterLowFund") },
    { key: "lowInteraction", label: t("filterLowInteraction") },
  ];

  const SORT_OPTIONS: { value: SortMode; label: string }[] = [
    { value: "smart", label: t("sortSmart") },
    { value: "balanceDesc", label: t("sortBalanceDesc") },
    { value: "balanceAsc", label: t("sortBalanceAsc") },
    { value: "newest", label: t("sortNewest") },
    { value: "oldest", label: t("sortOldest") },
    { value: "nameAsc", label: t("sortNameAsc") },
    { value: "missedSessionsDesc", label: t("sortMissedSessions") },
    { value: "yearPlayDesc", label: t("sortYearPlayDesc") },
  ];

  // Nhãn "nghỉ bao lâu": null = chưa từng chơi, 0 = đi hôm nay, n = nghỉ n ngày.
  const restLabel = (restDays: number | null) =>
    restDays === null
      ? t("restNever")
      : restDays === 0
        ? t("restToday")
        : t("restDays", { days: restDays });
  // Tô amber khi nghỉ lâu (≥30 ngày) hoặc chưa từng đi — kéo mắt admin.
  const restClass = (restDays: number | null) =>
    restDays === null || restDays >= 30
      ? "text-amber-600 dark:text-amber-400"
      : "text-muted-foreground";

  // Gom các giá trị suy ra theo member — dùng chung card mobile lẫn hàng bảng
  // desktop để 2 layout không lệch logic (nợ, optimistic active/tên, thống kê).
  const derive = (member: Member) => {
    const debts = debtsByMember[member.id] ?? [];
    // Ẩn ngay khoản vừa xác nhận (optimistic); rollback sẽ đưa lại vào list.
    const visibleDebts = debts.filter((d) => !confirmedDebts.has(d.id));
    const totalDebt = visibleDebts.reduce((s, d) => s + d.totalAmount, 0);
    const unpaidAmount = visibleDebts
      .filter((d) => !d.memberConfirmed)
      .reduce((s, d) => s + d.totalAmount, 0);
    const waitingAmount = visibleDebts
      .filter((d) => d.memberConfirmed)
      .reduce((s, d) => s + d.totalAmount, 0);
    const isExpanded = expandedId === member.id;
    const memberIsActive = toggledMembers[member.id] ?? member.isActive;
    const displayName = infoOverrides[member.id]?.name ?? member.name;
    const displayNickname =
      infoOverrides[member.id]?.nickname ?? member.nickname;
    const balance = memberBalances[member.id] ?? 0;
    const stat = playStats[member.id];
    const rest = restDaysFrom(stat?.lastPlayedDate, today);
    return {
      visibleDebts,
      totalDebt,
      unpaidAmount,
      waitingAmount,
      isExpanded,
      memberIsActive,
      displayName,
      displayNickname,
      balance,
      stat,
      rest,
    };
  };

  // Danh sách khoản nợ chi tiết (ngày · số tiền · nút "Đã nhận") — dùng chung
  // cho card mobile (mở rộng) lẫn hàng bảng desktop (dòng colspan).
  const renderDebtDetail = (debts: MemberDebt[]) =>
    debts
      .slice()
      .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))
      .map((debt) => {
        const d = new Date(debt.sessionDate);
        const dayNames = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
        const dateStr = `${String(d.getDate()).padStart(2, "0")}/${String(
          d.getMonth() + 1,
        ).padStart(2, "0")} (${dayNames[d.getDay()]})`;
        return (
          <div
            key={debt.id}
            className="bg-muted/50 flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-muted-foreground">{dateStr}</span>
              <span className="font-medium">{formatK(debt.totalAmount)}</span>
              {debt.memberConfirmed && (
                <StatusBadge variant="waiting">
                  {tF("waitingAdmin")}
                </StatusBadge>
              )}
            </div>
            <Button
              size="sm"
              className="min-h-11 gap-1 text-xs"
              disabled={confirmedDebts.has(debt.id)}
              onClick={() => handleConfirmPayment(debt.id)}
            >
              <Check className="h-3 w-3" />
              {tF("received")}
            </Button>
          </div>
        );
      });

  // Cụm hành động (Lịch sử · Khóa/Mở · menu ⋮) — dùng chung card lẫn hàng bảng.
  const renderActions = (member: Member, memberIsActive: boolean) => (
    <div className="flex shrink-0 items-center gap-1">
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
          <DropdownMenuItem onClick={() => setInfoEditTarget(member)}>
            <Edit className="h-4 w-4" />
            {t("menuEditInfo")}
          </DropdownMenuItem>
          {adminMemberId === member.id ? (
            <DropdownMenuItem onClick={handleUnlinkAdmin}>
              <Crown className="h-4 w-4" />
              {t("menuUnlinkAdmin")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => handleLinkAdmin(member)}>
              <Crown className="h-4 w-4" />
              {t("menuSetAdmin")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => handleResetPassword(member)}>
            <KeyRound className="h-4 w-4" />
            {t("menuResetPassword")}
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
  );

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
            <div className="space-y-2">
              <Label htmlFor="username">{t("username")}</Label>
              <Input
                id="username"
                name="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t("usernamePlaceholder")}
              />
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

      {/* Status filter (kèm số lượng mỗi bucket) + sort. Mobile: xếp DỌC 2 hàng
          — pills full-width (cuộn ngang thoải mái, không bị dropdown bóp), sort
          full-width dễ bấm. Từ sm: mới chung 1 hàng. */}
      <div className="mb-4 space-y-3 sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:space-y-0">
        <div className="min-w-0 sm:flex-1">
          <TabSegment<StatusFilter>
            variant="pills"
            scrollable={false}
            className="flex-wrap"
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
            className="min-w-0 flex-1 sm:w-56 sm:flex-none"
          />
        </div>
      </div>

      {/* Desktop: bảng thead/tbody (md+). Cuộn ngang trong container riêng khi
          hẹp — không để body trang cuộn ngang. Mobile dùng card bên dưới. */}
      <div className="border-border/60 hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-border/60 text-muted-foreground border-b text-left text-xs font-medium tracking-wide uppercase">
              <th className="px-3 py-2.5 font-medium">{t("colMember")}</th>
              <th className="px-3 py-2.5 font-medium">{t("colFund")}</th>
              <th className="px-3 py-2.5 text-center font-medium">
                {t("colMonth")}
              </th>
              <th className="px-3 py-2.5 text-center font-medium">
                {t("colYear")}
              </th>
              <th className="px-3 py-2.5 font-medium">{t("colLastPlayed")}</th>
              <th className="px-3 py-2.5 text-center font-medium">
                {t("colPartner")}
              </th>
              <th className="px-3 py-2.5">
                <span className="sr-only">{tCommon("more")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.map((member) => {
              const {
                visibleDebts,
                totalDebt,
                unpaidAmount,
                waitingAmount,
                isExpanded,
                memberIsActive,
                displayName,
                displayNickname,
                balance,
                stat,
                rest,
              } = derive(member);
              return (
                <Fragment key={member.id}>
                  <tr className="border-border/40 hover:bg-muted/30 border-b last:border-0">
                    {/* Thành viên */}
                    <td
                      className={cn(
                        "px-3 py-2.5 align-middle",
                        cardAccentClass(memberIsActive, balance),
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setInfoEditTarget(member)}
                          className="shrink-0 rounded-full"
                          title={t("menuEditInfo")}
                        >
                          <MemberAvatar
                            memberId={member.id}
                            avatarKey={member.avatarKey}
                            avatarUrl={member.avatarUrl}
                            size={36}
                          />
                        </button>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setInfoEditTarget(member)}
                            title={t("menuEditInfo")}
                            className="flex min-w-0 items-center gap-1.5 text-left hover:underline"
                          >
                            <span className="truncate font-semibold">
                              {displayName}
                            </span>
                            {displayNickname && (
                              <span className="text-muted-foreground shrink-0 text-xs font-normal">
                                ({displayNickname})
                              </span>
                            )}
                            {adminMemberId === member.id && (
                              <span
                                className="bg-primary/15 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                                title={t("thisIsAdminBadge")}
                              >
                                <Crown className="h-3 w-3" />
                                {t("adminBadge")}
                              </span>
                            )}
                          </button>
                          <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-sm">
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
                          </div>
                        </div>
                      </div>
                    </td>
                    {/* Quỹ / Nợ */}
                    <td className="px-3 py-2.5 align-middle">
                      <button
                        type="button"
                        onClick={() =>
                          setFundAdjustTarget({
                            memberId: member.id,
                            memberName: member.name,
                            memberNickname: member.nickname,
                            memberAvatarKey: member.avatarKey ?? null,
                            memberAvatarUrl: member.avatarUrl ?? null,
                            currentBalance: balance,
                          })
                        }
                        className="hover:bg-muted/50 -m-1 rounded-md p-1 text-left transition-colors"
                        title="Click để cộng/trừ/sửa quỹ"
                      >
                        {fundStatusInfoFor(balance)}
                      </button>
                      {totalDebt > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId(isExpanded ? null : member.id)
                          }
                          className="mt-1 flex items-center gap-1 text-sm font-medium hover:underline"
                        >
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
                          {isExpanded ? (
                            <ChevronUp className="text-muted-foreground h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="text-muted-foreground h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </td>
                    {/* Tháng này */}
                    <td className="px-3 py-2.5 text-center align-middle tabular-nums">
                      <span
                        className={cn(
                          "font-semibold",
                          (stat?.monthPlay ?? 0) === 0 &&
                            "text-muted-foreground font-normal",
                        )}
                      >
                        {stat?.monthPlay ?? 0}
                      </span>
                    </td>
                    {/* Năm nay */}
                    <td className="px-3 py-2.5 text-center align-middle tabular-nums">
                      <span
                        className={cn(
                          "font-semibold",
                          (stat?.yearPlay ?? 0) === 0 &&
                            "text-muted-foreground font-normal",
                        )}
                      >
                        {stat?.yearPlay ?? 0}
                      </span>
                    </td>
                    {/* Nghỉ bao lâu */}
                    <td
                      className={cn(
                        "px-3 py-2.5 align-middle whitespace-nowrap",
                        restClass(rest),
                      )}
                    >
                      {restLabel(rest)}
                    </td>
                    {/* Đi 2 mình */}
                    <td className="px-3 py-2.5 align-middle">
                      <div className="flex justify-center">
                        <Switch
                          aria-label={t("memberWithPartner")}
                          title={t("memberWithPartner")}
                          checked={
                            partnerOverrides[member.id] ??
                            member.defaultWithPartner
                          }
                          onCheckedChange={() => handleTogglePartner(member)}
                        />
                      </div>
                    </td>
                    {/* Hành động */}
                    <td className="px-3 py-2.5 align-middle">
                      <div className="flex justify-end">
                        {renderActions(member, memberIsActive)}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && totalDebt > 0 && (
                    <tr className="border-border/40 border-b last:border-0">
                      <td colSpan={7} className="bg-muted/20 px-3 py-2.5">
                        <div className="ml-12 space-y-1.5">
                          {renderDebtDetail(visibleDebts)}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: card (dưới md). Rule mobile-first: né table + né cuộn ngang. */}
      <div className="grid gap-3 md:hidden">
        <AnimatePresence initial={false}>
          {paged.map((member) => {
            const {
              visibleDebts,
              totalDebt,
              unpaidAmount,
              waitingAmount,
              isExpanded,
              memberIsActive,
              displayName,
              displayNickname,
              stat,
              rest,
            } = derive(member);
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
                    {/* Card 2 tầng: (1) avatar + tên + switch "đi 2 người" pin
                        góc phải; (2) khối số dư (trái) + nút hành động (phải),
                        ngăn bởi 1 đường kẻ. Row 1 KHÔNG wrap — min-w-0/truncate/
                        shrink-0 giữ khỏi tràn ngang ở 320-390px. */}
                    <div>
                      {/* ROW 1: avatar + tên/biệt danh/badge + switch đi-2-người */}
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setInfoEditTarget(member)}
                          className="shrink-0 rounded-full"
                          title={t("menuEditInfo")}
                        >
                          <MemberAvatar
                            memberId={member.id}
                            avatarKey={member.avatarKey}
                            avatarUrl={member.avatarUrl}
                            size={44}
                          />
                        </button>
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => setInfoEditTarget(member)}
                            title={t("menuEditInfo")}
                            className="flex w-full min-w-0 items-center gap-1.5 text-left hover:underline"
                          >
                            <span className="truncate text-base font-semibold">
                              {displayName}
                            </span>
                            {displayNickname && (
                              <span className="text-muted-foreground shrink-0 text-sm font-normal">
                                ({displayNickname})
                              </span>
                            )}
                            {adminMemberId === member.id && (
                              <span
                                className="bg-primary/15 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                                title={t("thisIsAdminBadge")}
                              >
                                <Crown className="h-3 w-3" />
                                {t("adminBadge")}
                              </span>
                            )}
                          </button>
                          {/* SUBROW: chấm + trạng thái quỹ · số người. Switch đã
                              lên góc phải row 1 — ở đây chỉ HIỂN THỊ số người. */}
                          <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-sm">
                            <span className="inline-flex items-center gap-1.5">
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
                            <span aria-hidden>·</span>
                            <span>
                              {(partnerOverrides[member.id] ??
                              member.defaultWithPartner)
                                ? t("partnerOn")
                                : t("partnerOff")}
                            </span>
                          </div>
                        </div>
                        {/* Switch "đi 2 người" pin góc trên bên phải */}
                        <Switch
                          className="shrink-0"
                          aria-label={t("memberWithPartner")}
                          title={t("memberWithPartner")}
                          checked={
                            partnerOverrides[member.id] ??
                            member.defaultWithPartner
                          }
                          onCheckedChange={() => handleTogglePartner(member)}
                        />
                      </div>

                      {/* Đường kẻ ngăn 2 tầng */}
                      <div className="border-border my-3 border-t" />

                      {/* ROW 2: khối số dư (trái, tap → sửa quỹ) + hành động (phải) */}
                      <div className="flex items-center justify-between gap-2">
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
                          className="hover:bg-muted/50 -m-1 min-w-0 rounded-md p-1 text-left transition-colors"
                          title="Click để cộng/trừ/sửa quỹ"
                        >
                          {fundStatusInfoFor(memberBalances[member.id] ?? 0)}
                        </button>
                        {renderActions(member, memberIsActive)}
                      </div>

                      {/* Thống kê buổi chơi: tháng · năm · nghỉ bao lâu */}
                      <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t pt-3 text-sm">
                        <span>
                          {t("colMonth")}:{" "}
                          <span className="text-foreground font-medium tabular-nums">
                            {stat?.monthPlay ?? 0}
                          </span>
                        </span>
                        <span aria-hidden>·</span>
                        <span>
                          {t("colYear")}:{" "}
                          <span className="text-foreground font-medium tabular-nums">
                            {stat?.yearPlay ?? 0}
                          </span>
                        </span>
                        <span aria-hidden>·</span>
                        <span className={restClass(rest)}>
                          {restLabel(rest)}
                        </span>
                      </div>
                    </div>

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
                            {renderDebtDetail(visibleDebts)}
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
      <MemberInfoDialog
        member={infoEditTarget}
        onClose={() => setInfoEditTarget(null)}
        onSave={handleSaveInfo}
      />

      {/* Dialog hiện mật khẩu tạm sau reset — plaintext chỉ hiện 1 lần ở đây. */}
      <TempPasswordDialog
        result={resetResult}
        onClose={() => setResetResult(null)}
      />
    </div>
  );
}

/** Dialog mật khẩu tạm: nút Copy có phản hồi "Đã copy ✓" (bấm xong đổi trạng thái). */
function TempPasswordDialog({
  result,
  onClose,
}: {
  result: { memberName: string; tempPassword: string } | null;
  onClose: () => void;
}) {
  const t = useTranslations("adminMembers");
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard?.writeText(result.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard bị chặn (http/không có quyền) — im lặng, user copy tay được.
    }
  }

  return (
    <Dialog
      open={result !== null}
      onOpenChange={(o) => {
        if (!o) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("resetPwDialogTitle", { name: result?.memberName ?? "" })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="bg-muted flex items-center justify-between gap-2 rounded-lg p-3">
            <code className="text-lg font-bold tracking-wider break-all">
              {result?.tempPassword}
            </code>
            <Button
              type="button"
              variant={copied ? "success" : "outline"}
              size="sm"
              className="min-h-11 shrink-0"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="mr-1.5 h-4 w-4" />
              ) : (
                <Copy className="mr-1.5 h-4 w-4" />
              )}
              {copied ? t("resetPwCopied") : t("resetPwCopy")}
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            {t("resetPwDialogHint")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Popup sửa thông tin cơ bản của member (tên/biệt danh/email/sđt) — mở từ
 * menu "⋮", hoặc bấm avatar/tên trên hàng member. Dùng chung 1 dialog cho cả
 * 3 điểm vào (spec 2026-07-06).
 */
function MemberInfoDialog({
  member,
  onClose,
  onSave,
}: {
  member: Member | null;
  onClose: () => void;
  onSave: (
    memberId: number,
    values: {
      name: string;
      nickname: string;
      email: string;
      phoneNumber: string;
      username: string;
    },
  ) => void;
}) {
  const t = useTranslations("adminMembers");
  return (
    <Dialog open={member !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editInfoTitle")}</DialogTitle>
        </DialogHeader>
        {/* key=member.id → remount form với state khởi tạo đúng mỗi khi đổi
            target, thay cho useEffect đồng bộ state (tránh cascading render). */}
        {member && (
          <MemberInfoForm key={member.id} member={member} onSave={onSave} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MemberInfoForm({
  member,
  onSave,
}: {
  member: Member;
  onSave: (
    memberId: number,
    values: {
      name: string;
      nickname: string;
      email: string;
      phoneNumber: string;
      username: string;
    },
  ) => void;
}) {
  const t = useTranslations("adminMembers");
  const tCommon = useTranslations("common");
  const [name, setName] = useState(member.name);
  const [nickname, setNickname] = useState(member.nickname ?? "");
  const [email, setEmail] = useState(member.email ?? "");
  const [phoneNumber, setPhoneNumber] = useState(member.phoneNumber ?? "");
  const [username, setUsername] = useState(member.username ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(member.id, {
      name: name.trim(),
      nickname,
      email,
      phoneNumber,
      username,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="info-name">{t("name")}</Label>
        <Input
          id="info-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="info-nickname">{t("nickname")}</Label>
        <Input
          id="info-nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="info-email">{t("email")}</Label>
        <Input
          id="info-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("emailPlaceholder")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="info-phone">{t("phoneNumber")}</Label>
        <Input
          id="info-phone"
          type="tel"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder={t("phonePlaceholder")}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="info-username">{t("username")}</Label>
        <Input
          id="info-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("usernamePlaceholder")}
        />
      </div>
      <Button type="submit" className="w-full">
        <Check className="mr-1.5 h-4 w-4" />
        {tCommon("save")}
      </Button>
    </form>
  );
}
