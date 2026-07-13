import { cn } from "@/lib/utils";

/**
 * 7-day week strip — pill T2..CN (chuẩn VN), chỉ label thứ, không số ngày.
 * Ngày của buổi chơi highlight pill primary; còn lại mờ. Tránh lệch timezone
 * bằng cách parse YYYY-MM-DD ở local time (không UTC).
 */
export function WeekStrip({
  sessionDate,
  className,
}: {
  sessionDate: string;
  className?: string;
}) {
  const [y, m, d] = sessionDate.split("-").map(Number);
  const session = new Date(y, m - 1, d);
  const dayIdx = session.getDay() === 0 ? 6 : session.getDay() - 1;
  // Nhãn NGẮN (T2..CN) + chip flex-1 → 7 ngày vừa 1 HÀNG (thay vì w-14 cố định
  // wrap 3 dòng trên mobile).
  const labels = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {labels.map((label, i) => (
        <span
          key={i}
          className={cn(
            "inline-flex min-w-0 flex-1 items-center justify-center rounded-md border px-1 py-1 text-xs font-medium whitespace-nowrap transition-colors",
            i === dayIdx
              ? "border-primary bg-primary text-primary-foreground shadow-sm"
              : "border-border bg-muted/30 text-muted-foreground",
          )}
        >
          {label}
        </span>
      ))}
    </div>
  );
}
