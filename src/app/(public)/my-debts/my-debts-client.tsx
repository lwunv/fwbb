"use client";

import { useState } from "react";
import { TimeFilter } from "@/components/shared/time-filter";
import { DebtList } from "@/components/finance/debt-list";
import { confirmPaymentByMember } from "@/actions/finance";
import type { DebtCardData } from "@/components/finance/debt-card";

interface MyDebtsClientProps {
  debts: DebtCardData[];
}

export function MyDebtsClient({ debts }: MyDebtsClientProps) {
  const [loadingId, setLoadingId] = useState<number | null>(null);

  async function handleMarkPaid(debtId: number) {
    setLoadingId(debtId);
    await confirmPaymentByMember(debtId);
    setLoadingId(null);
  }

  return (
    <div className="space-y-4">
      <TimeFilter />
      <DebtList
        debts={debts}
        onPayAction={handleMarkPaid}
        actionLabel="Da thanh toan"
        actionLoadingId={loadingId}
      />
    </div>
  );
}
