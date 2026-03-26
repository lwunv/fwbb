"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { createMember, updateMember, toggleMemberActive } from "@/actions/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Search,
} from "lucide-react";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { confirmPaymentByAdmin } from "@/actions/finance";
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
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const t = useTranslations("adminMembers");
  const tF = useTranslations("finance");
  const tCommon = useTranslations("common");
  usePolling();

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = members.filter((m) => {
      // status filter
      if (statusFilter === "active" && !m.isActive) return false;
      if (statusFilter === "locked" && m.isActive) return false;
      if (statusFilter === "hasDebt" && !(debtsByMember[m.id]?.length)) return false;
      // search filter
      if (!q) return true;
      return m.name.toLowerCase().includes(q);
    });
    // Sort: members with debt first (by total debt desc), then alphabetical
    return list.sort((a, b) => {
      const debtA = (debtsByMember[a.id] ?? []).reduce((s, d) => s + d.totalAmount, 0);
      const debtB = (debtsByMember[b.id] ?? []).reduce((s, d) => s + d.totalAmount, 0);
      if (debtA > 0 && debtB === 0) return -1;
      if (debtA === 0 && debtB > 0) return 1;
      if (debtA > 0 && debtB > 0) return debtB - debtA;
      return a.name.localeCompare(b.name);
    });
  }, [members, search, statusFilter, debtsByMember]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset page when search/filter changes
  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
  };
  const handleFilter = (val: StatusFilter) => {
    setStatusFilter(val);
    setPage(1);
  };

  async function handleSubmit(formData: FormData) {
    if (editingMember) {
      await updateMember(editingMember.id, formData);
    } else {
      await createMember(formData);
    }
    setDialogOpen(false);
    setEditingMember(null);
  }

  const filterButtons: { key: StatusFilter; label: string }[] = [
    { key: "all", label: t("all") },
    { key: "active", label: t("filterActive") },
    { key: "locked", label: t("filterLocked") },
    { key: "hasDebt", label: t("filterHasDebt") },
  ];

  return (
    <div className="pb-20">
      {/* count moved to filter row */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingMember(null);
        }}
      >
        {/* Sticky bottom add button */}
        <div className="fixed bottom-0 left-0 right-0 lg:left-60 z-30 p-3 bg-background/95 backdrop-blur border-t">
          <DialogTrigger render={<Button className="w-full" size="lg" />}>
            <Plus className="h-4 w-4 mr-2" /> {t("addMember")}
          </DialogTrigger>
        </div>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingMember ? t("editMember") : t("addNewMember")}
            </DialogTitle>
          </DialogHeader>
          <form key={editingMember?.id ?? "new"} action={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("name")}</Label>
              <Input
                id="name"
                name="name"
                defaultValue={editingMember?.name ?? ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nickname">{t("nickname")}</Label>
              <Input
                id="nickname"
                name="nickname"
                defaultValue={editingMember?.nickname ?? ""}
              />
            </div>
            <Button type="submit" className="w-full">
              {editingMember ? t("update") : tCommon("add")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Search box */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Status filter + count */}
      <div className="flex items-center gap-1.5 mb-4">
        {filterButtons.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => handleFilter(key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              statusFilter === key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">{t("count", { count: filtered.length })}</span>
      </div>

      {/* Member cards */}
      <div className="grid gap-3">
        {paged.map((member) => {
          const debts = debtsByMember[member.id] ?? [];
          const totalDebt = debts.reduce((s, d) => s + d.totalAmount, 0);
          const unpaidAmount = debts.filter((d) => !d.memberConfirmed).reduce((s, d) => s + d.totalAmount, 0);
          const waitingAmount = debts.filter((d) => d.memberConfirmed).reduce((s, d) => s + d.totalAmount, 0);
          const isExpanded = expandedId === member.id;

          return (
            <Card key={member.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <MemberAvatar memberId={member.id} avatarKey={member.avatarKey} avatarUrl={member.avatarUrl} size={36} />
                    <div>
                      <p className="font-medium">
                        {member.name}
                        {member.nickname && (
                          <span className="ml-1.5 text-xs text-muted-foreground font-normal">({member.nickname})</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={member.isActive ? "default" : "secondary"}
                      className={member.isActive ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                    >
                      {member.isActive ? t("active") : t("inactive")}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditingMember(member);
                        setDialogOpen(true);
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <form action={async () => { await toggleMemberActive(member.id); }}>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="submit"
                        title={member.isActive ? t("lock") : t("unlock")}
                      >
                        {member.isActive ? (
                          <LockOpen className="h-4 w-4 text-green-600" />
                        ) : (
                          <Lock className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    </form>
                  </div>
                </div>

                {totalDebt > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpandedId(isExpanded ? null : member.id); }}
                      className="mt-2 ml-12 flex items-center gap-2 text-sm font-medium hover:underline py-1"
                    >
                      <span className="flex items-center gap-1">
                        {unpaidAmount > 0 && (
                          <span className="text-destructive">{tF("owed")}: {Math.round(unpaidAmount / 1000)}k</span>
                        )}
                        {unpaidAmount > 0 && waitingAmount > 0 && (
                          <span className="text-muted-foreground">·</span>
                        )}
                        {waitingAmount > 0 && (
                          <span className="text-amber-600 dark:text-amber-400">{tF("waitingAdmin")}: {Math.round(waitingAmount / 1000)}k</span>
                        )}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="mt-2 ml-12 space-y-1.5">
                        {debts
                          .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))
                          .map((debt) => {
                            const d = new Date(debt.sessionDate);
                            const dayNames = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
                            const dateStr = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} (${dayNames[d.getDay()]})`;

                            return (
                              <div
                                key={debt.id}
                                className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground">{dateStr}</span>
                                  <span className="font-medium">{Math.round(debt.totalAmount / 1000)}k</span>
                                  {debt.memberConfirmed && (
                                    <Badge variant="outline" className="text-xs px-1.5 py-0 border-amber-400 text-amber-600 dark:border-amber-600 dark:text-amber-400">
                                      {tF("waitingAdmin")}
                                    </Badge>
                                  )}
                                </div>
                                <form action={async () => { await confirmPaymentByAdmin(debt.id); }}>
                                  <Button type="submit" size="sm" className="h-7 text-xs gap-1">
                                    <Check className="h-3 w-3" />
                                    {tF("received")}
                                  </Button>
                                </form>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("pageOf", { current: safePage, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
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
