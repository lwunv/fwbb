"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { DebtList } from "@/components/finance/debt-list";
import { confirmPaymentByMember } from "@/actions/finance";
import { fireAction } from "@/lib/optimistic-action";
import { MemberAvatar } from "@/components/shared/member-avatar";
import type { DebtCardData } from "@/components/finance/debt-card";
import { usePolling } from "@/lib/use-polling";
import { formatK } from "@/lib/utils";
import { PiggyBank, ChevronDown } from "lucide-react";

interface MyDebtsClientProps {
  debts: (DebtCardData & { memberName?: string })[];
  outstandingTotal: number;
  members: {
    id: number;
    name: string;
    avatarKey: string | null;
    avatarUrl: string | null;
  }[];
  currentUserId: number;
  selectedMemberId: number | "all";
  fundBalance: number | null;
}

export function MyDebtsClient({
  debts,
  outstandingTotal,
  members,
  currentUserId,
  selectedMemberId,
  fundBalance,
}: MyDebtsClientProps) {
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("finance");
  usePolling();

  function handleMarkPaid(debtId: number) {
    setLoadingId(debtId);
    fireAction(
      () => confirmPaymentByMember(debtId),
      () => {
        setLoadingId(null);
      },
    );
  }

  function handleMemberChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === String(currentUserId)) {
      params.delete("member");
    } else {
      params.set("member", value);
    }
    params.delete("page");
    router.push(`/my-debts?${params.toString()}`, { scroll: false });
    setDropdownOpen(false);
  }

  const currentLabel =
    selectedMemberId === "all"
      ? t("allMembers")
      : (members.find((m) => m.id === selectedMemberId)?.name ?? t("mine"));

  const selectedAvatarKey =
    selectedMemberId === "all"
      ? null
      : (members.find((m) => m.id === selectedMemberId)?.avatarKey ?? null);
  const selectedAvatarUrl =
    selectedMemberId === "all"
      ? null
      : (members.find((m) => m.id === selectedMemberId)?.avatarUrl ?? null);
  const currentUserAvatarKey =
    members.find((m) => m.id === currentUserId)?.avatarKey ?? null;
  const currentUserAvatarUrl =
    members.find((m) => m.id === currentUserId)?.avatarUrl ?? null;

  const isOwnView = selectedMemberId === currentUserId;
  const canSwitchMembers = members.length > 1;

  return (
    <div className="space-y-4">
      {/* Member selector — 44px tap target, native-feeling dropdown */}
      {canSwitchMembers && (
        <div className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
            aria-label={t("changeMember") || "Đổi người xem"}
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="bg-card hover:bg-accent flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-base transition-colors active:scale-[0.99]"
          >
            <div className="flex items-center gap-2">
              {selectedMemberId !== "all" && (
                <MemberAvatar
                  memberId={selectedMemberId as number}
                  avatarKey={selectedAvatarKey}
                  avatarUrl={selectedAvatarUrl}
                  size={28}
                />
              )}
              <span>{currentLabel}</span>
            </div>
            <ChevronDown
              className={`h-5 w-5 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>

          {dropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setDropdownOpen(false)}
              />
              <div
                role="listbox"
                className="bg-card absolute top-full z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border shadow-lg"
              >
                <button
                  role="option"
                  aria-selected={isOwnView}
                  onClick={() => handleMemberChange(String(currentUserId))}
                  className={`hover:bg-accent flex min-h-11 w-full items-center gap-2 px-3 py-2 text-base transition-colors ${
                    isOwnView ? "bg-accent font-medium" : ""
                  }`}
                >
                  <MemberAvatar
                    memberId={currentUserId}
                    avatarKey={currentUserAvatarKey}
                    avatarUrl={currentUserAvatarUrl}
                    size={28}
                  />
                  <span>
                    {members.find((m) => m.id === currentUserId)?.name ??
                      t("mine")}
                  </span>
                </button>

                <div className="border-t" />

                <button
                  role="option"
                  aria-selected={selectedMemberId === "all"}
                  onClick={() => handleMemberChange("all")}
                  className={`hover:bg-accent flex min-h-11 w-full items-center gap-2 px-3 py-2 text-base transition-colors ${
                    selectedMemberId === "all" ? "bg-accent font-medium" : ""
                  }`}
                >
                  <span className="flex h-7 w-7 items-center justify-center text-base">
                    👥
                  </span>
                  <span>{t("allMembers")}</span>
                </button>

                <div className="border-t" />

                {members
                  .filter((m) => m.id !== currentUserId)
                  .map((m) => (
                    <button
                      key={m.id}
                      role="option"
                      aria-selected={selectedMemberId === m.id}
                      onClick={() => handleMemberChange(String(m.id))}
                      className={`hover:bg-accent flex min-h-11 w-full items-center gap-2 px-3 py-2 text-base transition-colors ${
                        selectedMemberId === m.id ? "bg-accent font-medium" : ""
                      }`}
                    >
                      <MemberAvatar
                        memberId={m.id}
                        avatarKey={m.avatarKey}
                        avatarUrl={m.avatarUrl}
                        size={28}
                      />
                      <span>{m.name}</span>
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      )}

      {fundBalance !== null && selectedMemberId !== "all" && (
        <div className="bg-card flex items-center justify-between rounded-xl border p-3">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 text-primary rounded-lg p-1.5">
              <PiggyBank className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium">{t("fundBalance")}</span>
          </div>
          <span className="text-primary font-bold">{formatK(fundBalance)}</span>
        </div>
      )}

      <DebtList
        debts={debts}
        outstandingTotal={outstandingTotal}
        onPayAction={isOwnView ? handleMarkPaid : undefined}
        actionLabel={isOwnView ? t("paid") : undefined}
        actionLoadingId={loadingId}
        showMemberInfo={selectedMemberId === "all"}
      />
    </div>
  );
}
