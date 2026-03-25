"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { DebtList } from "@/components/finance/debt-list";
import { confirmPaymentByMember } from "@/actions/finance";
import { MemberAvatar } from "@/components/shared/member-avatar";
import type { DebtCardData } from "@/components/finance/debt-card";
import { usePolling } from "@/lib/use-polling";

interface MyDebtsClientProps {
  debts: (DebtCardData & { memberName?: string })[];
  outstandingTotal: number;
  members: { id: number; name: string; avatarKey: string | null }[];
  currentUserId: number;
  selectedMemberId: number | "all";
}

export function MyDebtsClient({
  debts,
  outstandingTotal,
  members,
  currentUserId,
  selectedMemberId,
}: MyDebtsClientProps) {
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("finance");
  usePolling();

  async function handleMarkPaid(debtId: number) {
    setLoadingId(debtId);
    await confirmPaymentByMember(debtId);
    setLoadingId(null);
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
      : members.find((m) => m.id === selectedMemberId)?.name ?? t("mine");

  const selectedAvatarKey =
    selectedMemberId === "all"
      ? null
      : members.find((m) => m.id === selectedMemberId)?.avatarKey ?? null;
  const currentUserAvatarKey =
    members.find((m) => m.id === currentUserId)?.avatarKey ?? null;

  const isOwnView = selectedMemberId === currentUserId;

  return (
    <div className="space-y-4">
      {/* Member selector dropdown */}
      <div className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 border rounded-md bg-card hover:bg-accent transition-colors text-sm"
        >
          <div className="flex items-center gap-2">
            {selectedMemberId !== "all" && (
              <MemberAvatar
                memberId={selectedMemberId as number}
                avatarKey={selectedAvatarKey}
                size={24}
              />
            )}
            <span>{currentLabel}</span>
          </div>
          <svg
            className={`h-4 w-4 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {dropdownOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setDropdownOpen(false)}
            />
            <div className="absolute z-20 top-full mt-1 w-full bg-card border rounded-md shadow-lg max-h-64 overflow-auto">
              {/* Own debts */}
              <button
                onClick={() => handleMemberChange(String(currentUserId))}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors ${
                  isOwnView ? "bg-accent font-medium" : ""
                }`}
              >
                <MemberAvatar memberId={currentUserId} avatarKey={currentUserAvatarKey} size={24} />
                <span>{members.find((m) => m.id === currentUserId)?.name ?? t("mine")}</span>
              </button>

              {/* Separator */}
              <div className="border-t" />

              {/* All */}
              <button
                onClick={() => handleMemberChange("all")}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors ${
                  selectedMemberId === "all" ? "bg-accent font-medium" : ""
                }`}
              >
                <span className="w-6 h-6 flex items-center justify-center text-base">👥</span>
                <span>{t("allMembers")}</span>
              </button>

              {/* Separator */}
              <div className="border-t" />

              {/* Other members */}
              {members
                .filter((m) => m.id !== currentUserId)
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleMemberChange(String(m.id))}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors ${
                      selectedMemberId === m.id ? "bg-accent font-medium" : ""
                    }`}
                  >
                    <MemberAvatar memberId={m.id} avatarKey={m.avatarKey} size={24} />
                    <span>{m.name}</span>
                  </button>
                ))}
            </div>
          </>
        )}
      </div>

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
