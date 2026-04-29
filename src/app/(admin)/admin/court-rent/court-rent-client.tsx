"use client";

import { useEffect, useState, useTransition } from "react";
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
import { formatVND, formatK, cn } from "@/lib/utils";
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
  const [submitting, startSubmit] = useTransition();

  // Payments list for selected month
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [, startDelete] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

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
    startSubmit(async () => {
      const r = await recordCourtRentPayment({
        year: formYear,
        month: formMonth,
        amount,
        courtId: formCourtId ? parseInt(formCourtId, 10) : null,
        note: formNote.trim() || undefined,
      });
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      toast.success("Đã ghi nhận thanh toán tiền sân");
      setFormAmount("2400000");
      setFormNote("");
      await loadReport(year);
      if (formYear === year && formMonth === selectedMonth) {
        await loadPayments();
      }
    });
  }

  function handleDelete(paymentId: number) {
    startDelete(async () => {
      const r = await deleteCourtRentPayment(paymentId);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      toast.success("Đã xóa giao dịch");
      setDeleteTarget(null);
      await loadReport(year);
      await loadPayments();
    });
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

      {/* Year totals */}
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
        <StatTile
          icon={AlertTriangle}
          label="Còn lại"
          value={formatVND(report.yearTotal.remaining)}
          tone={report.yearTotal.remaining > 0 ? "red" : "neutral"}
        />
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
            </div>
            {monthData.passRevenue > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                ℹ️ Đã pass {formatK(monthData.passRevenue)} từ buổi hủy → đã vào
                quỹ admin
              </div>
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
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full"
          >
            {submitting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
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
                    className="bg-muted/30 flex items-center justify-between gap-2 rounded-lg border p-3"
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
                        {p.createdAt
                          ? new Date(p.createdAt).toLocaleString("vi-VN", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(p.id)}
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
