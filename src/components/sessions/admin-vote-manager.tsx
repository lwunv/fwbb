"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { adminSetVote, adminRemoveVote } from "@/actions/votes";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { PaymentActions } from "@/components/finance/payment-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatVND } from "@/lib/utils";
import { Plus, X, Check, ChevronUp } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type { votes as votesTable, members as membersTable } from "@/db/schema";

type Vote = InferSelectModel<typeof votesTable> & {
  member: InferSelectModel<typeof membersTable>;
};
type Member = InferSelectModel<typeof membersTable>;

interface DebtInfo {
  amount: number;
  adminConfirmed: boolean;
  debtId: number;
}

interface AdminVoteManagerProps {
  sessionId: number;
  votes: Vote[];
  members: Member[];
  debtMap?: Record<number, DebtInfo>;
  readOnly?: boolean;
}

export function AdminVoteManager({ sessionId, votes, members, debtMap = {}, readOnly = false }: AdminVoteManagerProps) {
  const t = useTranslations("voting");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = useTransition();
  const [showAddPlay, setShowAddPlay] = useState(false);
  const [showAddDine, setShowAddDine] = useState(false);
  const [searchPlay, setSearchPlay] = useState("");
  const [searchDine, setSearchDine] = useState("");

  const voteMap = new Map(votes.map((v) => [v.memberId, v]));
  const playingMembers = votes.filter((v) => v.willPlay);
  const diningMembers = votes.filter((v) => v.willDine);

  function togglePlay(memberId: number) {
    if (readOnly) return;
    startTransition(async () => {
      const existingVote = voteMap.get(memberId);
      const isPlaying = existingVote?.willPlay ?? false;
      if (isPlaying) {
        if (existingVote?.willDine) {
          await adminSetVote(sessionId, memberId, false, true);
        } else {
          await adminRemoveVote(sessionId, memberId);
        }
      } else {
        await adminSetVote(sessionId, memberId, true, existingVote?.willDine ?? false);
      }
    });
  }

  function toggleDine(memberId: number) {
    if (readOnly) return;
    startTransition(async () => {
      const existingVote = voteMap.get(memberId);
      const isDining = existingVote?.willDine ?? false;
      if (isDining) {
        if (existingVote?.willPlay) {
          await adminSetVote(sessionId, memberId, true, false);
        } else {
          await adminRemoveVote(sessionId, memberId);
        }
      } else {
        await adminSetVote(sessionId, memberId, existingVote?.willPlay ?? false, true);
      }
    });
  }

  function filterMembers(list: Member[], search: string) {
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter((m) => m.name.toLowerCase().includes(q) || m.phone.includes(search));
  }

  function renderMemberRow(memberId: number, memberName: string, canRemove: boolean, onRemove: () => void) {
    const debt = debtMap[memberId];
    return (
      <div key={memberId} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-accent">
        <div className="flex items-center gap-2 min-w-0">
          <MemberAvatar memberId={memberId} size={24} />
          <span className="text-sm truncate">{memberName}</span>
          {debt && (
            <span className="text-xs font-medium text-muted-foreground ml-1">
              {formatVND(debt.amount)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {debt && (
            <PaymentActions
              debtId={debt.debtId}
              memberConfirmed={false}
              adminConfirmed={debt.adminConfirmed}
            />
          )}
          {canRemove && !readOnly && (
            <button
              onClick={onRemove}
              disabled={isPending}
              className="text-muted-foreground hover:text-destructive transition-colors p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tăng 1 - Cầu lông */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">🏸 {t("play")} ({playingMembers.length})</h3>
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowAddPlay(!showAddPlay); setShowAddDine(false); setSearchPlay(""); }}
                disabled={isPending}
              >
                {showAddPlay ? <ChevronUp className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                {showAddPlay ? tCommon("close") : tCommon("add")}
              </Button>
            )}
          </div>

          <div className="space-y-0.5">
            {playingMembers.map((v) =>
              renderMemberRow(v.memberId, v.member.name, true, () => togglePlay(v.memberId))
            )}
            {playingMembers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">{tCommon("noOne")}</p>
            )}
          </div>

          {showAddPlay && !readOnly && (
            <div className="border rounded-md overflow-hidden">
              <input
                type="text"
                placeholder={`${tCommon("search")}...`}
                value={searchPlay}
                onChange={(e) => setSearchPlay(e.target.value)}
                className="w-full px-3 py-2 text-sm border-b bg-background outline-none"
                autoFocus
              />
              <div className="max-h-48 overflow-auto">
                {filterMembers(members, searchPlay).map((m) => {
                  const isSelected = voteMap.get(m.id)?.willPlay ?? false;
                  return (
                    <button
                      key={m.id}
                      onClick={() => togglePlay(m.id)}
                      disabled={isPending}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left ${isSelected ? "bg-primary/10" : "hover:bg-accent"}`}
                    >
                      <div className={`h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 ${isSelected ? "bg-primary border-primary" : "border-border"}`}>
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <MemberAvatar memberId={m.id} size={20} />
                      <span>{m.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tăng 2 - Nhậu */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">🍻 {t("dine")} ({diningMembers.length})</h3>
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowAddDine(!showAddDine); setShowAddPlay(false); setSearchDine(""); }}
                disabled={isPending}
              >
                {showAddDine ? <ChevronUp className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                {showAddDine ? tCommon("close") : tCommon("add")}
              </Button>
            )}
          </div>

          <div className="space-y-0.5">
            {diningMembers.map((v) =>
              renderMemberRow(v.memberId, v.member.name, true, () => toggleDine(v.memberId))
            )}
            {diningMembers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">{tCommon("noOne")}</p>
            )}
          </div>

          {showAddDine && !readOnly && (
            <div className="border rounded-md overflow-hidden">
              <input
                type="text"
                placeholder={`${tCommon("search")}...`}
                value={searchDine}
                onChange={(e) => setSearchDine(e.target.value)}
                className="w-full px-3 py-2 text-sm border-b bg-background outline-none"
                autoFocus
              />
              <div className="max-h-48 overflow-auto">
                {filterMembers(members, searchDine).map((m) => {
                  const isSelected = voteMap.get(m.id)?.willDine ?? false;
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleDine(m.id)}
                      disabled={isPending}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left ${isSelected ? "bg-primary/10" : "hover:bg-accent"}`}
                    >
                      <div className={`h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 ${isSelected ? "bg-primary border-primary" : "border-border"}`}>
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <MemberAvatar memberId={m.id} size={20} />
                      <span>{m.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
