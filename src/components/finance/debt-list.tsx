"use client";

import { DebtCard, type DebtCardData } from "./debt-card";
import { formatVND } from "@/lib/utils";

interface DebtListProps {
  debts: DebtCardData[];
  showMemberInfo?: boolean;
  onPayAction?: (debtId: number) => void;
  actionLabel?: string;
  actionLoadingId?: number | null;
}

export function DebtList({
  debts,
  showMemberInfo = false,
  onPayAction,
  actionLabel,
  actionLoadingId,
}: DebtListProps) {
  if (debts.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Không có công nợ nào.
      </div>
    );
  }

  const totalUnpaid = debts
    .filter((d) => !d.adminConfirmed)
    .reduce((sum, d) => sum + d.totalAmount, 0);

  const totalPaid = debts
    .filter((d) => d.adminConfirmed)
    .reduce((sum, d) => sum + d.totalAmount, 0);

  return (
    <div className="space-y-4">
      {/* Summary — only show unpaid */}
      {totalUnpaid > 0 && (
        <div className="rounded-lg bg-destructive/10 p-3 text-center">
          <div className="text-xs text-muted-foreground">Còn nợ</div>
          <div className="font-bold text-destructive">{formatVND(totalUnpaid)}</div>
        </div>
      )}

      {/* Debt cards */}
      <div className="space-y-3">
        {debts.map((debt) => (
          <DebtCard
            key={debt.id}
            debt={debt}
            showMemberInfo={showMemberInfo}
            onPayAction={onPayAction}
            actionLabel={actionLabel}
            actionLoading={actionLoadingId === debt.id}
          />
        ))}
      </div>
    </div>
  );
}
