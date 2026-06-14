"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Trang trí site-wide: bông tuyết ❄ + trái tim 💗 nhỏ bay nhẹ với opacity
 * thấp, không cản tương tác (`pointer-events-none`). Tổng N item, vị trí
 * khởi tạo random + offset animation random để không trông như sync. Chỉ
 * mount client để tránh hydration mismatch (Math.random server vs client).
 *
 * Performance: dùng pure CSS animation `transform: translateY` (cheap;
 * GPU compositor), không re-render React mỗi frame.
 */

// Tất cả là text glyphs (không phải emoji với VS16) → nhận CSS `color` chuẩn:
//   ♥ tim (heart suit), ❅/❆ bông tuyết (snowflake variants),
//   ★ ngôi sao đặc, ✦ ngôi sao 4-pointed
// Tone hồng/trắng kiểm soát qua CSS color random ở từng item.
const SHAPES = ["♥", "❅", "❆", "★", "✦", "♥"] as const;
const COUNT = 6;

interface Item {
  id: number;
  shape: string;
  left: number; // %
  size: number; // px
  delay: number; // s
  duration: number; // s
  opacity: number;
  drift: number; // px horizontal sway amplitude
  color: string; // CSS color (chỉ áp dụng cho ♥ glyph, emoji 💗 ignore)
}

function randomItems(): Item[] {
  return Array.from({ length: COUNT }, (_, id) => ({
    id,
    shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
    left: Math.random() * 100,
    size: 16 + Math.random() * 22, // 16–38 px
    delay: -Math.random() * 20, // âm để bắt đầu rải rác
    duration: 14 + Math.random() * 12, // 14–26s
    opacity: 0.18 + Math.random() * 0.22, // 0.18–0.40
    drift: 30 + Math.random() * 60, // 30–90 px
    // Random pink hoặc white — match tone hồng theme + giữ neutral white
    // accent. ♥ glyph nhận màu này; emoji 💗 ignore (giữ pink native).
    color: Math.random() < 0.5 ? "#ec4899" : "#ffffff",
  }));
}

export function FloatingDecorations() {
  // Defer mount đến client để tránh hydration mismatch (Math.random server vs
  // client). Đây là pattern canonical cho client-only random content; lint
  // rule react-hooks/set-state-in-effect cảnh báo cascading render nói chung,
  // nhưng đây là one-shot mount flag, không phải sync state liên tục.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const items = useMemo(() => (mounted ? randomItems() : null), [mounted]);

  if (!items) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-10 overflow-hidden"
    >
      {items.map((it) => (
        <span
          key={it.id}
          className="absolute top-0 will-change-transform select-none"
          style={
            {
              left: `${it.left}%`,
              fontSize: `${it.size}px`,
              opacity: it.opacity,
              color: it.color,
              animation: `float-deco-rise ${it.duration}s linear ${it.delay}s infinite`,
              ["--drift" as string]: `${it.drift}px`,
            } as React.CSSProperties
          }
        >
          {it.shape}
        </span>
      ))}
    </div>
  );
}
