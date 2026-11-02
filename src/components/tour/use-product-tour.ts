"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { buildTourSteps, type TourStep } from "./tour-steps";
import { setTourDrawer } from "./tour-drawer";

// Có version: đổi nội dung tour đáng kể thì tăng số để ai đã xem bản cũ cũng
// được xem bản mới 1 lần (v2: 02/11/2026, thêm từng mục menu + step vote).
const DONE_KEY = "fwbb-tour-done-v2";
// Sheet trượt vào/ra mất 200ms (duration-200) — chờ dư 1 nhịp rồi mới neo,
// nếu không driver đo vị trí lúc mục menu còn đang trượt → khung lệch.
const DRAWER_ANIM_MS = 350;

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

    // Bước qua ranh giới trong/ngoài ngăn kéo → mở/đóng ngăn kéo trước, chờ
    // animation xong mới chuyển step.
    const go = (d: Driver, dir: 1 | -1) => {
      const i = d.getActiveIndex() ?? 0;
      const move = () => (dir === 1 ? d.moveNext() : d.movePrevious());
      if (inDrawer(i + dir) === inDrawer(i)) return move();
      setTourDrawer(inDrawer(i + dir));
      setTimeout(move, DRAWER_ANIM_MS);
    };

    const d = driver({
      showProgress: true,
      // Dạng số, dùng chung mọi ngôn ngữ (mặc định "x of y" là tiếng Anh).
      progressText: "{{current}}/{{total}}",
      smoothScroll: true,
      allowClose: true,
      stagePadding: 6,
      stageRadius: 10,
      overlayOpacity: 0.6,
      popoverClass: "fwbb-tour",
      nextBtnText: t("next"),
      prevBtnText: t("prev"),
      doneBtnText: t("done"),
      steps: resolved.map((r) => r.step),
      onNextClick: (_el, _step, { driver: dr }) => go(dr, 1),
      onPrevClick: (_el, _step, { driver: dr }) => go(dr, -1),
      onDestroyed: () => {
        setTourDrawer(false);
        try {
          localStorage.setItem(DONE_KEY, "1");
        } catch {
          /* localStorage chặn → bỏ qua */
        }
      },
    });
    d.drive();
  }, [t]);

  const hasSeen = useCallback(() => {
    try {
      return localStorage.getItem(DONE_KEY) === "1";
    } catch {
      return true; // localStorage chặn → coi như đã xem, không auto-run.
    }
  }, []);

  return { run, hasSeen };
}
