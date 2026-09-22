"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TabSegment } from "@/components/shared/tab-segment";
import { formatK } from "@/lib/utils";
import type { FundCashFlowMonth } from "@/actions/fund";

type Granularity = "month" | "year" | "all";

interface Row {
  key: string;
  label: string;
  thu: number;
  chi: number;
  courtRent: number;
  shuttlecock: number;
  net: number;
}

/**
 * Thu chi của QUỸ theo tháng / năm / tất cả, tách riêng tiền sân và tiền cầu.
 *
 * Khác `SessionFinanceReport` ngay cạnh: bài kia thống kê theo BUỔI CHƠI (mỗi
 * buổi thu được bao nhiêu, tốn bao nhiêu). Bài này thống kê DÒNG TIỀN THẬT của
 * quỹ: ai nộp vào, chi ra những gì. Hai câu hỏi khác nhau nên để hai khối
 * riêng, không gộp.
 *
 * KHÔNG tính phần chia cho member mỗi buổi (`fund_deduction`): đó là ghi sổ
 * phân bổ, tiền không rời két. Cùng lý do `cashOnHand` không trừ nó.
 *
 * Dữ liệu vào đã gom sẵn theo tháng ở server, nên đổi mốc xem là tính lại
 * ngay tại chỗ, không cần gọi lại server.
 */
export function FundCashflowReport({
  months,
}: {
  months: FundCashFlowMonth[];
}) {
  const [g, setG] = useState<Granularity>("month");

  const rows: Row[] = useMemo(() => {
    const acc = new Map<string, Row>();
    for (const m of months) {
      const key =
        g === "all" ? "all" : g === "year" ? m.key.slice(0, 4) : m.key;
      let r = acc.get(key);
      if (!r) {
        const [y, mm] = key.split("-");
        r = {
          key,
          label:
            g === "all"
              ? "Toàn thời gian"
              : g === "year"
                ? `Năm ${key}`
                : `Tháng ${parseInt(mm, 10)}/${y}`,
          thu: 0,
          chi: 0,
          courtRent: 0,
          shuttlecock: 0,
          net: 0,
        };
        acc.set(key, r);
      }
      r.thu += m.contributions + m.guestIncome;
      r.courtRent += m.courtRent;
      r.shuttlecock += m.shuttlecock;
      r.chi += m.refunds + m.courtRent + m.shuttlecock;
    }
    for (const r of acc.values()) r.net = r.thu - r.chi;
    return [...acc.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [months, g]);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Thu chi quỹ</h2>
          <TabSegment<Granularity>
            variant="pills"
            value={g}
            onChange={setG}
            options={[
              { value: "month", label: "Tháng" },
              { value: "year", label: "Năm" },
              { value: "all", label: "Tất cả" },
            ]}
          />
        </div>

        {rows.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Chưa có khoản thu chi nào.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.key} className="rounded-xl border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.label}</span>
                  <span
                    className={
                      r.net >= 0
                        ? "font-bold text-emerald-600 tabular-nums dark:text-emerald-400"
                        : "text-destructive font-bold tabular-nums"
                    }
                  >
                    {r.net >= 0 ? "+" : ""}
                    {formatK(r.net)} đ
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
                  <Cell label="Đã thu" value={r.thu} tone="blue" />
                  <Cell label="Đã chi" value={r.chi} tone="orange" />
                  <Cell label="Tiền sân" value={r.courtRent} />
                  <Cell label="Tiền cầu" value={r.shuttlecock} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "blue" | "orange";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:block">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span
        className={`block font-semibold tabular-nums ${
          tone === "blue"
            ? "text-blue-600 dark:text-blue-400"
            : tone === "orange"
              ? "text-orange-600 dark:text-orange-400"
              : ""
        }`}
      >
        {formatK(value)}
      </span>
    </div>
  );
}
