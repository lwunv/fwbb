import { cn } from "@/lib/utils";

interface LedBorderProps {
  /** Conditional render — chỉ wrap LED khi `active=true`. Mặc định `true`. */
  active?: boolean;
  /**
   * `pink` (default) — neon hồng, dùng cho buổi đang vote / sắp diễn ra.
   * `green` — neon xanh (legacy).
   * `primary` — auto theo `var(--primary)` của theme hiện hành.
   */
  variant?: "pink" | "green" | "primary";
  /** Kích thước padding LED. `md` (2px) cho card, `sm` (1.5px) cho icon-button. */
  size?: "md" | "sm";
  className?: string;
  children: React.ReactNode;
}

/**
 * Wrapper chạy LED border (rotating conic-gradient sweep + blurred glow).
 * Dùng cho card / button cần "live" highlight: buổi đang vote, giao dịch
 * đang chờ, vote tag đang active... Pink neon là default — match brand
 * color của FWBB và visible trên cả light + pink + dark theme.
 *
 * Pattern: bọc card-content vào `<LedBorder active={isVoting}>...</LedBorder>`.
 * Khi `active=false` chỉ render plain wrapper (không có animation).
 */
export function LedBorder({
  active = true,
  variant = "pink",
  size = "md",
  className,
  children,
}: LedBorderProps) {
  if (!active) return <>{children}</>;
  const baseClass = size === "sm" ? "led-border-sm" : "led-border";
  // pink = default → no extra class needed
  const variantClass = variant === "pink" ? "" : variant;
  return (
    <div className={cn(baseClass, variantClass, className)}>{children}</div>
  );
}
