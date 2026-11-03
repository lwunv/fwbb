"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { buildTourSteps, type TourStep } from "./tour-steps";
import { setTourDrawer } from "./tour-drawer";
import { hasSeenTour, markTourSeen } from "./tour-seen";

// Sheet trượt vào/ra mất 200ms (duration-200) — chờ dư 1 nhịp rồi mới neo,
// nếu không driver đo vị trí lúc mục menu còn đang trượt → khung lệch.
const DRAWER_ANIM_MS = 350;
// Gắn lên <body> trong lúc chờ ngăn kéo trượt vào: ẩn popover để khung neo
// không lơ lửng ở vị trí cũ (globals.css).
const MOVING_CLASS = "fwbb-tour-moving";

interface ResolvedStep {
  step: DriveStep;
  inDrawer: boolean;
}

/** Chọn chỗ neo cho từng step theo DOM hiện tại (xem TourStep). */
function resolveSteps(all: TourStep[]): ResolvedStep[] {
  const out: ResolvedStep[] = [];
  for (const s of all) {
    if (!s.element) {
      out.push({ step: { popover: s.popover }, inDrawer: false });
    } else if (s.inDrawer) {
      // Ngăn kéo đang đóng nên chưa query được — driver tự query selector lúc
      // tới step. Chặn bấm mục menu giữa tour (bấm là chuyển trang, tour lạc).
      out.push({
        step: {
          element: s.element,
          popover: s.popover,
          disableActiveInteraction: true,
        },
        inDrawer: true,
      });
    } else {
      const found = [s.element, ...(s.fallback ?? [])].find(
        (q) => document.querySelector(q) !== null,
      );
      if (found) {
        out.push({
          step: { element: found, popover: s.popover },
          inDrawer: false,
        });
      } else if (s.centerIfMissing) {
        out.push({ step: { popover: s.popover }, inDrawer: false });
      }
    }
  }
  return out;
}

export function useProductTour() {
  const t = useTranslations("tour");

  const run = useCallback(() => {
    const resolved = resolveSteps(buildTourSteps((k) => t(k)));
    if (resolved.length === 0) return;
    const inDrawer = (i: number) => resolved[i]?.inDrawer ?? false;

    // Step chào: nút chính là "Bắt đầu", không có "Trước". Bỏ qua nằm ở footer.
    const first = resolved[0].step;
    if (!first.element) {
      first.popover = {
        ...first.popover,
        nextBtnText: t("start"),
        showButtons: ["next", "close"],
      };
    }

    // Bước qua ranh giới trong/ngoài ngăn kéo → mở/đóng ngăn kéo. Chỉ phải
    // CHỜ khi mở (mục menu còn đang trượt vào thì driver đo sai vị trí); khi
    // đóng, step đích nằm ở header cố định hoặc canh giữa nên chuyển ngay.
    let waiting = false;
    const go = (d: Driver, dir: 1 | -1) => {
      if (waiting) return; // bấm Tiếp liên tục lúc đang chờ → không nhảy 2 step
      const i = d.getActiveIndex() ?? 0;
      const move = () => (dir === 1 ? d.moveNext() : d.movePrevious());
      const to = inDrawer(i + dir);
      if (to === inDrawer(i)) return move();
      setTourDrawer(to);
      if (!to) return move();
      waiting = true;
      document.body.classList.add(MOVING_CLASS);
      setTimeout(() => {
        waiting = false;
        document.body.classList.remove(MOVING_CLASS);
        // Người dùng có thể đã thoát tour trong lúc chờ.
        if (d.isActive()) move();
      }, DRAWER_ANIM_MS);
    };

    const d = driver({
      showProgress: true,
      // Dạng số, dùng chung mọi ngôn ngữ (mặc định "x of y" là tiếng Anh).
      progressText: "{{current}}/{{total}}",
      smoothScroll: true,
      // Thoát tour bất cứ lúc nào: nút X, nút "Bỏ qua", phím Esc, hoặc chạm
      // ra ngoài khung (vùng tối).
      allowClose: true,
      overlayClickBehavior: "close",
      showButtons: ["next", "previous", "close"],
      stagePadding: 6,
      stageRadius: 10,
      overlayOpacity: 0.6,
      popoverClass: "fwbb-tour",
      nextBtnText: t("next"),
      prevBtnText: t("prev"),
      doneBtnText: t("done"),
      steps: resolved.map((r) => r.step),
      onPopoverRender: (pop, { driver: dr }) => {
        // Tiến độ lên đầu khung, chừa footer cho Bỏ qua / Trước / Tiếp (màn
        // 375px không đủ chỗ cho cả 4 trên 1 hàng).
        pop.wrapper.insertBefore(pop.progress, pop.title);
        if (dr.isLastStep()) return;
        const skip = document.createElement("button");
        skip.type = "button";
        skip.className = "fwbb-tour-skip";
        skip.textContent = t("skip");
        skip.addEventListener("click", () => dr.destroy());
        pop.footer.insertBefore(skip, pop.footer.firstChild);
      },
      onNextClick: (_el, _step, { driver: dr }) => go(dr, 1),
      onPrevClick: (_el, _step, { driver: dr }) => go(dr, -1),
      onDestroyed: () => {
        document.body.classList.remove(MOVING_CLASS);
        setTourDrawer(false);
        markTourSeen();
      },
    });
    d.drive();
  }, [t]);

  const hasSeen = useCallback(() => hasSeenTour(), []);

  return { run, hasSeen };
}
