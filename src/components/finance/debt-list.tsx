"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { Receipt } from "lucide-react";
import { DebtCard, type DebtCardData } from "./debt-card";
import { formatK } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";

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
  const t = useTranslations("finance");
  if (debts.length === 0) {
    return <EmptyState icon={Receipt} title={t("noDebts")} />;
  }

  const totalUnpaid =
    outstandingTotalOverride ??
    debts
      .filter((d) => !d.adminConfirmed && !d.memberConfirmed)
      .reduce((sum, d) => sum + d.totalAmount, 0);

  return (
    <div className="space-y-4">
      {/* Summary — only show unpaid */}
      {totalUnpaid > 0 && (
        <div className="bg-destructive/10 rounded-lg p-3 text-center">
          <div className="text-muted-foreground text-sm">
            {t("colStillOwed")}
          </div>
          <div className="text-destructive text-base font-bold">
            {formatK(totalUnpaid)}
          </div>
        </div>
      )}

      {/* Debt cards with smooth reorder/exit animation */}
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {debts.map((debt) => (
            <motion.div
              key={debt.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
            >
              <DebtCard
                debt={debt}
                showMemberInfo={showMemberInfo}
                onPayAction={onPayAction}
                actionLabel={actionLabel}
                actionLoading={actionLoadingId === debt.id}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
