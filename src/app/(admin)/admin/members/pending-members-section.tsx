"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { fireAction } from "@/lib/optimistic-action";
import { formatSessionDate } from "@/lib/date-format";
import {
  approveMember,
  rejectMember,
  approveAndMergeMember,
  type NameMatchSuggestion,
} from "@/actions/member-approval";
import {
  Loader2,
  Check,
  X,
  Link as LinkIcon,
  Mail,
  Phone,
  CreditCard,
  Sparkles,
} from "lucide-react";

export interface PendingMember {
  id: number;
  name: string;
  nickname: string | null;
  email: string | null;
  phoneNumber: string | null;
  bankAccountNo: string | null;
  avatarKey: string | null;
  avatarUrl: string | null;
  facebookId: string | null;
  googleId: string | null;
  createdAt: string | null;
  suggestions: NameMatchSuggestion[];
}

export function PendingMembersSection({
  pendingMembers,
}: {
  pendingMembers: PendingMember[];
}) {
  const t = useTranslations("adminMembers");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const [list, setList] = useState(pendingMembers);

  if (list.length === 0) return null;

  function handleApprove(memberId: number) {
    setBusyId(memberId);
    fireAction(
      () => approveMember(memberId),
      () => setBusyId(null),
      {
        successMsg: t("toastApproved"),
        onSuccess: () => {
          setBusyId(null);
          startTransition(() =>
            setList((cur) => cur.filter((m) => m.id !== memberId)),
          );
        },
      },
    );
  }

  function handleReject(memberId: number) {
    const ok = window.confirm(t("confirmReject"));
    if (!ok) return;
    setBusyId(memberId);
    fireAction(
      () => rejectMember(memberId),
      () => setBusyId(null),
      {
        successMsg: t("toastRejected"),
        onSuccess: () => {
          setBusyId(null);
          startTransition(() =>
            setList((cur) => cur.filter((m) => m.id !== memberId)),
          );
        },
      },
    );
  }

  function handleMerge(
    pendingId: number,
    targetId: number,
    targetName: string,
  ) {
    const ok = window.confirm(t("confirmMerge", { name: targetName }));
    if (!ok) return;
    setBusyId(pendingId);
    fireAction(
      () => approveAndMergeMember(pendingId, targetId),
      () => setBusyId(null),
      {
        successMsg: t("toastMerged", { name: targetName }),
        onSuccess: () => {
          setBusyId(null);
          startTransition(() =>
            setList((cur) => cur.filter((m) => m.id !== pendingId)),
          );
        },
      },
    );
  }

  return (
    <Card className="border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-600" />
          <h2 className="font-semibold">{t("pendingTitle")}</h2>
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
            {list.length}
          </span>
        </div>
        <p className="text-muted-foreground text-xs">{t("pendingHint")}</p>

        <AnimatePresence initial={false}>
          {list.map((m) => (
            <motion.div
              key={m.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-card rounded-xl border p-3"
            >
              <div className="flex items-start gap-3">
                <MemberAvatar
                  memberId={m.id}
                  avatarKey={m.avatarKey}
                  avatarUrl={m.avatarUrl}
                  size={40}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-base font-semibold">{m.name}</span>
                    {m.nickname && (
                      <span className="text-muted-foreground text-sm">
                        ({m.nickname})
                      </span>
                    )}
                    <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                      {m.createdAt
                        ? formatSessionDate(m.createdAt.slice(0, 10))
                        : ""}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {m.googleId && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        Google
                      </span>
                    )}
                    {m.facebookId && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-600 dark:text-blue-400">
                        Facebook
                      </span>
                    )}
                    {m.email && (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {m.email}
                      </span>
                    )}
                    {m.phoneNumber && (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {m.phoneNumber}
                      </span>
                    )}
                    {m.bankAccountNo && (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <CreditCard className="h-3 w-3" />
                        {m.bankAccountNo}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Name-matching suggestions — gợi ý merge với member admin tạo trước. */}
              {m.suggestions.length > 0 && (
                <div className="mt-3 space-y-1.5 rounded-lg border border-dashed border-amber-400/50 bg-amber-100/40 p-2 dark:bg-amber-900/20">
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                    {t("matchSuggestionsLabel")}
                  </p>
                  {m.suggestions.map((s) => (
                    <button
                      key={s.memberId}
                      type="button"
                      disabled={busyId === m.id}
                      onClick={() => handleMerge(m.id, s.memberId, s.name)}
                      className="bg-card hover:bg-accent flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <LinkIcon className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <span className="truncate">
                          <strong>{s.name}</strong>
                          {s.nickname && (
                            <span className="text-muted-foreground">
                              {" "}
                              ({s.nickname})
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {Math.round(s.score * 100)}%
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleApprove(m.id)}
                  disabled={busyId === m.id}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                >
                  {busyId === m.id ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-4 w-4" />
                  )}
                  {t("btnApprove")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReject(m.id)}
                  disabled={busyId === m.id}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 flex-1"
                >
                  <X className="mr-1 h-4 w-4" />
                  {t("btnReject")}
                </Button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

void toast;
