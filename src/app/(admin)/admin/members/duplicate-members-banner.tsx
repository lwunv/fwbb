"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { mergeMember } from "@/actions/members";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatK, cn } from "@/lib/utils";
import { getFundStatus } from "@/lib/fund-core";
import { toast } from "sonner";

interface DupMember {
  id: number;
  name: string;
  nickname: string | null;
  avatarKey: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  facebookId: string;
  balance: number;
  ledgerCount: number;
}

interface DupGroup {
  name: string;
  members: DupMember[];
}

export function DuplicateMembersBanner({ groups }: { groups: DupGroup[] }) {
  const [pending, startTransition] = useTransition();
  // selectedKeepId per group — id của member sẽ giữ lại; còn lại là source merge.
  const [keepIds, setKeepIds] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const g of groups) {
      // default: giữ member nhiều ledger nhất → ít rủi ro mất history
      const best = [...g.members].sort(
        (a, b) => b.ledgerCount - a.ledgerCount,
      )[0];
      init[g.name] = best.id;
    }
    return init;
  });
  const [confirmTarget, setConfirmTarget] = useState<{
    keep: DupMember;
    drop: DupMember[];
  } | null>(null);

  function openConfirm(group: DupGroup) {
    const keepId = keepIds[group.name];
    const keep = group.members.find((m) => m.id === keepId);
    if (!keep) return;
    const drop = group.members.filter((m) => m.id !== keepId);
    if (drop.length === 0) return;
    setConfirmTarget({ keep, drop });
  }

  async function handleMerge() {
    if (!confirmTarget) return;
    const { keep, drop } = confirmTarget;
    setConfirmTarget(null);
    startTransition(async () => {
      for (const src of drop) {
        const res = await mergeMember(src.id, keep.id);
        if (res && "error" in res && res.error) {
          toast.error(`Lỗi gộp ${src.name} (#${src.id}): ${res.error}`);
          return;
        }
      }
      toast.success(`Đã gộp ${drop.length} bản trùng vào ${keep.name}`);
    });
  }

  return (
    <>
      <Card className="border-amber-300/60 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-950/20">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <h3 className="text-base font-bold">
              Phát hiện thành viên trùng tên ({groups.length})
            </h3>
          </div>
          <p className="text-muted-foreground text-sm">
            Chọn ID giữ lại cho mỗi nhóm — các bản còn lại sẽ được gộp toàn bộ
            vote / nợ / quỹ / giao dịch vào bản giữ lại, rồi xóa.
          </p>

          {groups.map((group) => {
            const keepId = keepIds[group.name];
            return (
              <div
                key={group.name}
                className="bg-card space-y-2 rounded-xl border p-3"
              >
                <div className="text-sm font-semibold">
                  Tên: <span className="text-primary">{group.name}</span>
                </div>
                <ul className="space-y-1.5">
                  {group.members.map((m) => {
                    const isKeep = m.id === keepId;
                    return (
                      <li
                        key={m.id}
                        className={cn(
                          "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                          isKeep
                            ? "border-primary bg-primary/10"
                            : "border-border bg-muted/30",
                        )}
                      >
                        <input
                          type="radio"
                          name={`keep-${group.name}`}
                          checked={isKeep}
                          onChange={() =>
                            setKeepIds((s) => ({ ...s, [group.name]: m.id }))
                          }
                          className="accent-primary h-4 w-4 shrink-0"
                        />
                        <MemberAvatar
                          memberId={m.id}
                          avatarKey={m.avatarKey}
                          avatarUrl={m.avatarUrl}
                          size={32}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-semibold">
                              #{m.id} · {m.name}
                              {m.nickname ? ` (${m.nickname})` : ""}
                            </span>
                            {!m.isActive && (
                              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                                inactive
                              </span>
                            )}
                          </div>
                          <div className="text-muted-foreground text-xs">
                            {m.ledgerCount} giao dịch ·{" "}
                            <span
                              className={
                                getFundStatus(m.balance) === "owing"
                                  ? "text-red-600 dark:text-red-400"
                                  : getFundStatus(m.balance) === "depleted"
                                    ? ""
                                    : "text-green-600 dark:text-green-400"
                              }
                            >
                              balance {formatK(m.balance)}
                            </span>
                            {m.facebookId.startsWith("admin_") &&
                              " · admin tạo"}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex justify-end pt-1">
                  <Button
                    size="sm"
                    onClick={() => openConfirm(group)}
                    disabled={pending}
                  >
                    Gộp vào ID #{keepId}
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
        title={`Gộp vào ${confirmTarget?.keep.name ?? ""} (#${confirmTarget?.keep.id ?? ""})?`}
        description={
          confirmTarget
            ? `Sẽ chuyển toàn bộ vote / nợ / quỹ / giao dịch của ${confirmTarget.drop
                .map((m) => `#${m.id}`)
                .join(
                  ", ",
                )} sang #${confirmTarget.keep.id}, sau đó XÓA các bản trùng. Hành động không hoàn tác được.`
            : ""
        }
        onConfirm={handleMerge}
      />
    </>
  );
}
