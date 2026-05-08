"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Banknote,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomSelect } from "@/components/ui/custom-select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatTile } from "@/components/shared/stat-tile";
import { InlineNotice } from "@/components/shared/inline-notice";
import { formatVND, formatK, cn } from "@/lib/utils";
import { fireAction } from "@/lib/optimistic-action";
import {
  getCourtRentReport,
  getCourtRentPayments,
  recordCourtRentPayment,
  deleteCourtRentPayment,
  type CourtRentReport,
} from "@/actions/court-rent";

interface CourtOpt {
  id: number;
  name: string;
}

interface PaymentRow {
  id: number;
  amount: number;
  description: string | null;
  createdAt: string;
  targetMonth: string | null;
  courtId: number | null;
  courtName: string | null;
}

interface Props {
  initialYear: number;
  initialReport: CourtRentReport;
  availableYears: number[];
  courts: CourtOpt[];
}

const MONTH_LABELS = [
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "T7",
  "T8",
  "T9",
  "T10",
  "T11",
  "T12",
];

/** Cộng/trừ amount vào month + yearTotal khi optimistic add/remove payment.
 *  delta > 0 = ghi nhận thêm, < 0 = xóa. Pure → safe để dùng trong setState.
 *  Chỉ clamp `paidTotal` ≥ 0 (delete có thể âm tạm thời nếu state lệch);
 *  KHÔNG clamp `remaining` về 0 ở client-only patch — server vẫn clamp khi
 *  re-fetch, nhưng giữ remaining negative cho phép detect overpayment trong
 *  optimistic window (UI sẽ render badge "Trả thừa"). */
function patchReportTotal(
  prev: CourtRentReport,
  targetYear: number,
  targetMonth: number,
  delta: number,
): CourtRentReport {
  if (prev.year !== targetYear) return prev;
  return {
    ...prev,
    months: prev.months.map((m) =>
      m.month === targetMonth
        ? {
            ...m,
            paidTotal: Math.max(0, m.paidTotal + delta),
            remaining: m.expectedTotal - (m.paidTotal + delta),
          }
        : m,
    ),
    yearTotal: {
      ...prev.yearTotal,
      paid: Math.max(0, prev.yearTotal.paid + delta),
      remaining: prev.yearTotal.remaining - delta,
    },
  };
}

export function CourtRentClient({
  initialYear,
  initialReport,
  availableYears,
  courts,
}: Props) {
  const [year, setYear] = useState(initialYear);
  const [report, setReport] = useState<CourtRentReport>(initialReport);
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<number>(
    new Date().getMonth() + 1,
  );

  // Payment form state
  const [formMonth, setFormMonth] = useState(new Date().getMonth() + 1);
  const [formYear, setFormYear] = useState(new Date().getFullYear());
  const [formAmount, setFormAmount] = useState("2400000");
  const [formCourtId, setFormCourtId] = useState<string>("");
  const [formNote, setFormNote] = useState("");

  // Payments list for selected month
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  // Optimistic ghost id counter (negative để không clash với DB id thật).
  const optimisticIdRef = useRef(-1);

  async function loadReport(y: number) {
    setLoading(true);
    try {
      const r = await getCourtRentReport(y);
      setReport(r);
    } finally {
      setLoading(false);
    }
  }

  async function loadPayments() {
    setPaymentsLoading(true);
    try {
      const list = await getCourtRentPayments(year, selectedMonth);
      setPayments(list);
    } finally {
      setPaymentsLoading(false);
    }
  }

  useEffect(() => {
    if (year !== initialYear) loadReport(year);
  }, [year, initialYear]);

  useEffect(() => {
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, selectedMonth]);

  const monthData = report.months.find((m) => m.month === selectedMonth);

  function handleSubmit() {
    const amount = parseInt(formAmount, 10) || 0;
    if (amount <= 0) {
      toast.error("Số tiền phải > 0");
      return;
    }

    const courtIdNum = formCourtId ? parseInt(formCourtId, 10) : null;
    const courtName = courtIdNum
      ? (courts.find((c) => c.id === courtIdNum)?.name ?? null)
      : null;
    const note = formNote.trim();
    const targetMonthKey = `${formYear}-${String(formMonth).padStart(2, "0")}`;
    const submittedYear = formYear;
    const submittedMonth = formMonth;

    // Optimistic: ghost row + bump report totals if same view
    const ghostId = optimisticIdRef.current;
    optimisticIdRef.current -= 1;
    const ghostRow: PaymentRow = {
      id: ghostId,
      amount,
      description:
        note ||
        `Trả tiền sân tháng ${String(formMonth).padStart(2, "0")}/${formYear}`,
      createdAt: new Date().toISOString(),
      targetMonth: targetMonthKey,
      courtId: courtIdNum,
      courtName,
    };

    if (submittedYear === year && submittedMonth === selectedMonth) {
      setPayments((prev) => [ghostRow, ...prev]);
    }
    setReport((prev) =>
      patchReportTotal(prev, submittedYear, submittedMonth, amount),
    );
    // Reset form ngay (UX: input clear instantly). Không rollback form trên
    // failure — user có thể đã type giá trị mới; ghi đè sẽ mất input của họ.
    setFormAmount("2400000");
    setFormNote("");

    // Stable idempotencyKey per submit — DB UNIQUE chặn double-write nếu
    // admin click 2 lần liên tiếp (form đã reset → trông như có thể submit lại)
    // hoặc fireAction retry trên transient error.
    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `rent-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    fireAction(
      () =>
        recordCourtRentPayment({
          year: submittedYear,
          month: submittedMonth,
          amount,
          courtId: courtIdNum,
          note: note || undefined,
          idempotencyKey,
        }),
      () => {
        // Inverse-op rollback: chỉ undo những gì optimistic vừa làm. An toàn
        // khi user đã navigate (đổi year / month) mid-flight: filter no-op
        // nếu ghost không còn trong list, patchReportTotal no-op nếu year
        // không khớp.
        setPayments((prev) => prev.filter((p) => p.id !== ghostId));
        setReport((prev) =>
          patchReportTotal(prev, submittedYear, submittedMonth, -amount),
        );
      },
      {
        successMsg: "Đã ghi nhận thanh toán tiền sân",
        onSuccess: () => {
          // Refresh từ server để swap ghost row → row thật + đồng bộ totals
          if (submittedYear === year) loadReport(year);
          if (submittedYear === year && submittedMonth === selectedMonth)
            loadPayments();
        },
      },
    );
  }

  function handleDelete(paymentId: number) {
    const target = payments.find((p) => p.id === paymentId);
    if (!target) return;

    const tm = target.targetMonth;
    const [tyStr, tmStr] = (tm ?? "").split("-");
    const ty = parseInt(tyStr ?? "", 10);
    const tmNum = parseInt(tmStr ?? "", 10);
    const removedAmount = target.amount;
    const removedRow = target;

    // Optimistic remove + bump totals down
    setPayments((prev) => prev.filter((p) => p.id !== paymentId));
    if (Number.isFinite(ty) && Number.isFinite(tmNum)) {
      setReport((prev) => patchReportTotal(prev, ty, tmNum, -removedAmount));
    }
    setDeleteTarget(null);

    fireAction(
      () => deleteCourtRentPayment(paymentId),
      () => {
        // Inverse-op rollback: re-insert row chỉ nếu list đang hiển thị
        // tháng cũ (user chưa navigate); patchReportTotal no-op nếu year
        // không khớp. Tránh ghi đè state hiện tại của user.
        setPayments((prev) =>
          prev.some((p) => p.id === paymentId) ? prev : [removedRow, ...prev],
        );
        if (Number.isFinite(ty) && Number.isFinite(tmNum)) {
          setReport((prev) => patchReportTotal(prev, ty, tmNum, removedAmount));
        }
      },
      {
        successMsg: "Đã xóa giao dịch",
        onSuccess: () => {
          if (Number.isFinite(ty) && ty === year) loadReport(year);
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 rounded-xl p-2">
            <Banknote className="text-primary h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Tiền sân</h1>
            <p className="text-muted-foreground text-sm">
              Quản lý thanh toán tiền thuê sân theo tháng
            </p>
          </div>
        </div>
        <CustomSelect
          value={String(year)}
          onChange={(v) => setYear(parseInt(v, 10))}
          options={availableYears.map((y) => ({
            value: String(y),
            label: `Năm ${y}`,
          }))}
          className="w-32"
        />
      </div>

      {/* Year totals — `remaining` có thể âm khi overpayment (admin trả vượt
          expectedTotal). Khi âm: hiện "Trả thừa" tone amber thay vì "Còn lại"
          red, để admin biết và cân nhắc rút bớt thay vì lặng lẽ clamp về 0. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          icon={TrendingUp}
          label="Cần trả (cả năm)"
          value={formatVND(report.yearTotal.expected)}
          tone="primary"
        />
        <StatTile
          icon={CheckCircle2}
          label="Đã trả"
          value={formatVND(report.yearTotal.paid)}
          tone="green"
        />
        {report.yearTotal.remaining < 0 ? (
          <StatTile
            icon={AlertTriangle}
            label="Trả thừa"
            value={`+${formatVND(-report.yearTotal.remaining)}`}
            tone="amber"
          />
        ) : (
          <StatTile
            icon={AlertTriangle}
            label="Còn lại"
            value={formatVND(report.yearTotal.remaining)}
            tone={report.yearTotal.remaining > 0 ? "red" : "neutral"}
          />
        )}
        <StatTile
          icon={TrendingDown}
          label="Pass sân thu được"
          value={formatVND(report.yearTotal.passRevenue)}
          tone="amber"
        />
      </div>

      {/* Month tabs */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="bg-muted inline-flex min-w-full gap-1 rounded-lg p-1">
          {MONTH_LABELS.map((label, i) => {
            const m = i + 1;
            const monthInfo = report.months[i];
            const hasActivity =
              !!monthInfo &&
              (monthInfo.sessionCount > 0 || monthInfo.paidTotal > 0);
            const remaining = monthInfo?.remaining ?? 0;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setSelectedMonth(m)}
                className={cn(
                  "min-w-12 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                  selectedMonth === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                  hasActivity && "font-bold",
                  remaining > 0 && selectedMonth !== m && "text-destructive",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected month summary */}
      {monthData && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-base font-semibold">
              Tháng {monthData.month}/{report.year}
            </h2>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground text-xs">Số buổi</p>
                <p className="text-base font-bold tabular-nums">
                  {monthData.sessionCount}
                  {monthData.extraCourtSessions > 0 && (
                    <span className="text-muted-foreground ml-1 text-xs font-normal">
                      ({monthData.extraCourtSessions} có 2+ sân)
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Cần trả</p>
                <p className="text-primary text-base font-bold tabular-nums">
                  {formatK(monthData.expectedTotal)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Đã trả</p>
                <p className="text-base font-bold text-green-600 tabular-nums dark:text-green-400">
                  {formatK(monthData.paidTotal)}
                </p>
              </div>
              {monthData.remaining < 0 ? (
                <div>
                  <p className="text-muted-foreground text-xs">Trả thừa</p>
                  <p className="text-base font-bold text-amber-600 tabular-nums dark:text-amber-400">
                    +{formatK(-monthData.remaining)}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-muted-foreground text-xs">Còn lại</p>
                  <p
                    className={cn(
                      "text-base font-bold tabular-nums",
                      monthData.remaining > 0
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatK(monthData.remaining)}
                  </p>
                </div>
              )}
            </div>
            {monthData.remaining < 0 && (
              <InlineNotice tone="warning" icon={AlertTriangle} size="sm">
                Đã trả vượt {formatK(-monthData.remaining)} so với cần trả —
                kiểm tra lại hoặc rút bớt nếu nhầm
              </InlineNotice>
            )}
            {monthData.passRevenue > 0 && (
              <InlineNotice tone="info" size="sm">
                Đã pass {formatK(monthData.passRevenue)} từ buổi hủy → đã vào
                quỹ admin
              </InlineNotice>
            )}
          </CardContent>
        </Card>
      )}

      {/* Payment form */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Plus className="text-primary h-5 w-5" />
            <h3 className="text-base font-semibold">Ghi nhận thanh toán mới</h3>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <Label className="text-xs">Năm</Label>
              <CustomSelect
                value={String(formYear)}
                onChange={(v) => setFormYear(parseInt(v, 10))}
                options={availableYears.map((y) => ({
                  value: String(y),
                  label: String(y),
                }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Tháng</Label>
              <CustomSelect
                value={String(formMonth)}
                onChange={(v) => setFormMonth(parseInt(v, 10))}
                options={MONTH_LABELS.map((label, i) => ({
                  value: String(i + 1),
                  label,
                }))}
                className="mt-1"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label className="text-xs">Sân (optional)</Label>
              <CustomSelect
                value={formCourtId}
                onChange={(v) => setFormCourtId(v)}
                placeholder="— Chung —"
                options={[
                  { value: "", label: "— Chung —" },
                  ...courts.map((c) => ({
                    value: String(c.id),
                    label: c.name,
                  })),
                ]}
                className="mt-1"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label className="text-xs">Số tiền (VND)</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                min={0}
                step={10000}
                className="bg-background dark:bg-background mt-1"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Ghi chú (optional)</Label>
            <Input
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder="VD: Trả tháng 4 cho sân Atus"
              className="bg-background dark:bg-background mt-1"
            />
          </div>
          <Button type="button" onClick={handleSubmit} className="w-full">
            <Plus className="mr-1 h-4 w-4" />
            Ghi nhận thanh toán
          </Button>
        </CardContent>
      </Card>

      {/* Payments list (selected month) */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="text-base font-semibold">
            Danh sách giao dịch — Tháng {selectedMonth}/{year}
          </h3>
          {paymentsLoading || loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : payments.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Tháng này chưa có giao dịch trả tiền sân
            </p>
          ) : (
            <ul className="space-y-2">
              <AnimatePresence mode="popLayout">
                {payments.map((p) => (
                  <motion.li
                    key={p.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className={cn(
                      "bg-muted/30 flex items-center justify-between gap-2 rounded-lg border p-3",
                      // Ghost row (chưa server-confirmed) — mờ đi 1 chút.
                      p.id < 0 && "opacity-70",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {formatVND(p.amount)}
                        {p.courtName && (
                          <span className="text-muted-foreground ml-2 text-xs font-normal">
                            ({p.courtName})
                          </span>
                        )}
                      </p>
                      {p.description && (
                        <p className="text-muted-foreground truncate text-xs">
                          {p.description}
                        </p>
                      )}
                      <p className="text-muted-foreground/70 text-xs">
                        {p.id < 0 ? (
                          // Ghost row: client clock có thể lệch với server →
                          // hiện "Đang lưu..." thay vì timestamp dễ gây nhầm
                          // ordering. Sau revalidate sẽ thay bằng real
                          // createdAt từ server.
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-amber-500/40 border-t-amber-500" />
                            Đang lưu...
                          </span>
                        ) : p.createdAt ? (
                          new Date(p.createdAt).toLocaleString("vi-VN", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        ) : (
                          ""
                        )}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(p.id)}
                      // Ghost (chưa lưu DB) → không cho xóa, sẽ tự reconcile
                      // sau khi server response.
                      disabled={p.id < 0}
                      className="text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Xóa giao dịch"
        description="Bạn có chắc muốn xóa giao dịch trả tiền sân này?"
        onConfirm={() => {
          if (deleteTarget !== null) handleDelete(deleteTarget);
        }}
      />
    </div>
  );
}
