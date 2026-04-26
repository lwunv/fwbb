"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  createMember,
  updateMember,
  toggleMemberActive,
} from "@/actions/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
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
  Search,
} from "lucide-react";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { confirmPaymentByAdmin } from "@/actions/finance";
import { fireAction } from "@/lib/optimistic-action";
import { formatK } from "@/lib/utils";
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

type StatusFilter = "all" | "active" | "locked" | "hasDebt";

export function MemberList({
  members,
  debtsByMember = {},
}: {
  members: Member[];
  debtsByMember?: Record<number, MemberDebt[]>;
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
  const t = useTranslations("adminMembers");
  const tF = useTranslations("finance");
  const tCommon = useTranslations("common");
  usePolling();

  function handleToggle(memberId: number, currentActive: boolean) {
    setToggledMembers((prev) => ({ ...prev, [memberId]: !currentActive }));
    fireAction(
      () => toggleMemberActive(memberId),
      () =>
        setToggledMembers((prev) => ({ ...prev, [memberId]: currentActive })),
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
      // status filter
      if (statusFilter === "active" && !m.isActive) return false;
      if (statusFilter === "locked" && m.isActive) return false;
      if (statusFilter === "hasDebt" && !debtsByMember[m.id]?.length)
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
  }, [members, search, statusFilter, debtsByMember]);

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
      <div className="relative mb-3">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Status filter + count */}
      <div className="mb-4 flex items-center gap-2">
        {filterButtons.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => handleFilter(key)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              statusFilter === key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="text-muted-foreground ml-auto text-sm whitespace-nowrap">
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
                        <p className="text-base font-semibold">
                          {member.name}
                          {member.nickname && (
                            <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                              ({member.nickname})
                            </span>
                          )}
                        </p>
                      </div>
                      <Button
                        variant={memberIsActive ? "destructive" : "default"}
                        size="sm"
                        onClick={() => handleToggle(member.id, memberIsActive)}
                      >
                        {memberIsActive ? (
                          <>
                            <Lock className="mr-1.5 h-4 w-4" />
                            Khóa
                          </>
                        ) : (
                          <>
                            <LockOpen className="mr-1.5 h-4 w-4" />
                            Mở
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
                          Lưu
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
                            ? `Biệt danh: ${member.nickname}`
                            : "Thêm biệt danh..."}
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
    </div>
  );
}
