"use client";

import { DebtCard, type DebtCardData } from "./debt-card";
import { formatK } from "@/lib/utils";

interface DebtListProps {
  debts: DebtCardData[];
  /** Nếu có (vd. khi phân trang), dùng tổng còn nợ trên toàn bộ khoản nợ thay vì chỉ trang hiện tại */
  outstandingTotal?: number;
  showMemberInfo?: boolean;
  onPayAction?: (debtId: number) => void;
  actionLabel?: string;
  actionLoadingId?: number | null;
}

export function DebtList({
  debts,
  outstandingTotal: outstandingTotalOverride,
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

  const totalUnpaid =
    outstandingTotalOverride ??
    debts
      .filter((d) => !d.adminConfirmed && !d.memberConfirmed)
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
          <div className="font-bold text-destructive">{formatK(totalUnpaid)}</div>
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
