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
 *
 * `active=false` vẫn render ĐÚNG cái wrapper đó, chỉ thêm `led-off` để thôi
 * vẽ. Bản đầu trả thẳng `children` và bỏ wrapper, làm thẻ hụt phần padding
 * viền: hai thẻ cạnh nhau lệch kích thước, đổi qua lại thì giật.
 */
export function LedBorder({
  active = true,
  variant = "pink",
  size = "md",
  className,
  children,
}: LedBorderProps) {
  const baseClass = size === "sm" ? "led-border-sm" : "led-border";
  // pink = default → no extra class needed
  const variantClass = variant === "pink" ? "" : variant;
  return (
    <div
      className={cn(baseClass, active ? variantClass : "led-off", className)}
    >
      {children}
    </div>
  );
}
