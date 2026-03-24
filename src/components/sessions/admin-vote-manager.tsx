"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { adminSetVote, adminRemoveVote } from "@/actions/votes";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, X } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type { votes as votesTable, members as membersTable } from "@/db/schema";

type Vote = InferSelectModel<typeof votesTable> & {
  member: InferSelectModel<typeof membersTable>;
};
type Member = InferSelectModel<typeof membersTable>;

interface AdminVoteManagerProps {
  sessionId: number;
  votes: Vote[];
  members: Member[];
}

export function AdminVoteManager({ sessionId, votes, members }: AdminVoteManagerProps) {
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

  const notPlayingMembers = members.filter((m) => !voteMap.get(m.id)?.willPlay);
  const notDiningMembers = members.filter((m) => !voteMap.get(m.id)?.willDine);

  function handleAddToPlay(memberId: number) {
    startTransition(async () => {
      const existingVote = voteMap.get(memberId);
      await adminSetVote(sessionId, memberId, true, existingVote?.willDine ?? false);
      setShowAddPlay(false);
    });
  }

  function handleRemoveFromPlay(memberId: number) {
    startTransition(async () => {
      const existingVote = voteMap.get(memberId);
      if (existingVote?.willDine) {
        // Still dining, just remove play
        await adminSetVote(sessionId, memberId, false, true);
      } else {
        // Not dining either, remove vote entirely
        await adminRemoveVote(sessionId, memberId);
      }
    });
  }

  function handleAddToDine(memberId: number) {
    startTransition(async () => {
      const existingVote = voteMap.get(memberId);
      await adminSetVote(sessionId, memberId, existingVote?.willPlay ?? false, true);
      setShowAddDine(false);
    });
  }

  function handleRemoveFromDine(memberId: number) {
    startTransition(async () => {
      const existingVote = voteMap.get(memberId);
      if (existingVote?.willPlay) {
        // Still playing, just remove dine
        await adminSetVote(sessionId, memberId, true, false);
      } else {
        // Not playing either, remove vote entirely
        await adminRemoveVote(sessionId, memberId);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Tăng 1 - Cầu lông */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">🏸 {t("play")} ({playingMembers.length})</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowAddPlay(!showAddPlay); setShowAddDine(false); }}
              disabled={isPending}
            >
              <Plus className="h-3 w-3 mr-1" />
              {tCommon("add")}
            </Button>
          </div>

          {/* Current players */}
          <div className="space-y-1">
            {playingMembers.map((v) => (
              <div key={v.memberId} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-accent">
                <div className="flex items-center gap-2">
                  <MemberAvatar memberId={v.memberId} size={24} />
                  <span className="text-sm">{v.member.name}</span>
                </div>
                <button
                  onClick={() => handleRemoveFromPlay(v.memberId)}
                  disabled={isPending}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {playingMembers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">Chưa có ai</p>
            )}
          </div>

          {/* Add player dropdown */}
          {showAddPlay && notPlayingMembers.length > 0 && (
            <div className="border rounded-md overflow-hidden">
              <input
                type="text"
                placeholder="Tìm kiếm..."
                value={searchPlay}
                onChange={(e) => setSearchPlay(e.target.value)}
                className="w-full px-3 py-2 text-sm border-b bg-background outline-none"
              />
              <div className="max-h-40 overflow-auto">
              {notPlayingMembers.filter((m) =>
                m.name.toLowerCase().includes(searchPlay.toLowerCase()) ||
                m.phone.includes(searchPlay)
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleAddToPlay(m.id)}
                  disabled={isPending}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                >
                  <MemberAvatar memberId={m.id} size={20} />
                  <span>{m.name}</span>
                </button>
              ))}
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowAddDine(!showAddDine); setShowAddPlay(false); }}
              disabled={isPending}
            >
              <Plus className="h-3 w-3 mr-1" />
              {tCommon("add")}
            </Button>
          </div>

          {/* Current diners */}
          <div className="space-y-1">
            {diningMembers.map((v) => (
              <div key={v.memberId} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-accent">
                <div className="flex items-center gap-2">
                  <MemberAvatar memberId={v.memberId} size={24} />
                  <span className="text-sm">{v.member.name}</span>
                </div>
                <button
                  onClick={() => handleRemoveFromDine(v.memberId)}
                  disabled={isPending}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {diningMembers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">Chưa có ai</p>
            )}
          </div>

          {/* Add diner dropdown */}
          {showAddDine && notDiningMembers.length > 0 && (
            <div className="border rounded-md overflow-hidden">
              <input
                type="text"
                placeholder="Tìm kiếm..."
                value={searchDine}
                onChange={(e) => setSearchDine(e.target.value)}
                className="w-full px-3 py-2 text-sm border-b bg-background outline-none"
              />
              <div className="max-h-40 overflow-auto">
              {notDiningMembers.filter((m) =>
                m.name.toLowerCase().includes(searchDine.toLowerCase()) ||
                m.phone.includes(searchDine)
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleAddToDine(m.id)}
                  disabled={isPending}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                >
                  <MemberAvatar memberId={m.id} size={20} />
                  <span>{m.name}</span>
                </button>
              ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
