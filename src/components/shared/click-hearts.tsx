"use client";

import { useEffect, useState } from "react";

/**
 * Click effect site-wide: mỗi lần user click chuột (bất cứ đâu, bất cứ
 * element gì), spawn 5–7 trái tim 💗 nhỏ bay tỏa ra rồi mờ dần. Không cản
 * tương tác (`pointer-events-none`), tự cleanup sau animation.
 *
 * Performance:
 *  - Hearts là DOM thuần (`position: fixed`), animation pure CSS
 *    (`transform + opacity`), GPU compositor xử lý → cheap.
 *  - State chứa max ~30 hearts cùng lúc (5–7 mỗi click × ~5 click recent).
 *    Auto evict sau 1s.
 *  - Bỏ qua double-click + scrollbar click (event.target check).
 */

interface Heart {
  id: number;
  x: number;
  y: number;
  dx: number; // px direction x
  dy: number; // px direction y (negative = up)
  rotation: number; // deg
  size: number; // px
  shape: string;
  color: string; // CSS color cho ♥ glyph; emoji 💗 ignore
}

// Tất cả là text glyphs (không phải emoji với VS16) → nhận CSS `color` chuẩn,
// không bị màu cố định của emoji. Mix tim + bông tuyết + sao cho đa dạng.
//   ♥ U+2665 — heart suit (text)
//   ❅ U+2745 — tight trifoliate snowflake (text)
//   ❆ U+2746 — heavy chevron snowflake (text)
//   ★ U+2605 — black star (text)
//   ✦ U+2726 — black four pointed star (text)
const SHAPES = ["♥", "❅", "❆", "★", "✦", "♥"];
const ANIMATION_MS = 900;
// Random 2–5 mỗi click — tránh quá tải khi user click liên tục.
function randomCount() {
  return 2 + Math.floor(Math.random() * 4);
}

export function ClickHearts() {
  const [hearts, setHearts] = useState<Heart[]>([]);

  useEffect(() => {
    let nextId = 0;

    function onClick(e: MouseEvent) {
      // Ignore non-trusted (programmatic dispatch) để tránh loop từ
      // a11y tools / e2e tests vô tình spawn hàng loạt.
      if (!e.isTrusted) return;
      const x = e.clientX;
      const y = e.clientY;
      // Tỏa hearts theo cung 270°–360° (chủ yếu lên trên + 2 bên)
      const count = randomCount();
      const newHearts: Heart[] = Array.from({ length: count }, () => {
        // Random angle: -150° → -30° (lên trên, ±60° lệch)
        const angleDeg = -150 + Math.random() * 120;
        const angleRad = (angleDeg * Math.PI) / 180;
        const distance = 50 + Math.random() * 60; // 50–110 px
        return {
          id: nextId++,
          x,
          y,
          dx: Math.cos(angleRad) * distance,
          dy: Math.sin(angleRad) * distance,
          rotation: -30 + Math.random() * 60, // -30°..+30°
          size: 14 + Math.random() * 14, // 14–28 px
          shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
          // Random pink (#ec4899) hoặc white — ♥ glyph nhận, emoji 💗 ignore.
          color: Math.random() < 0.5 ? "#ec4899" : "#ffffff",
        };
      });
      setHearts((prev) => [...prev, ...newHearts]);

      // Cleanup hearts spawn từ click này sau animation kết thúc
      const ids = new Set(newHearts.map((h) => h.id));
      window.setTimeout(() => {
        setHearts((prev) => prev.filter((h) => !ids.has(h.id)));
      }, ANIMATION_MS + 50);
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden"
    >
      {hearts.map((h) => (
        <span
          key={h.id}
          className="absolute select-none"
          style={
            {
              left: h.x,
              top: h.y,
              fontSize: `${h.size}px`,
              color: h.color,
              animation: `click-heart-burst ${ANIMATION_MS}ms ease-out forwards`,
              ["--burst-dx" as string]: `${h.dx}px`,
              ["--burst-dy" as string]: `${h.dy}px`,
              ["--burst-rot" as string]: `${h.rotation}deg`,
            } as React.CSSProperties
          }
        >
          {h.shape}
        </span>
      ))}
    </div>
  );
}
