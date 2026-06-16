"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { buildTourSteps } from "./tour-steps";

const DONE_KEY = "fwbb-tour-done";

export function useProductTour() {
  const t = useTranslations("tour");

  const run = useCallback(() => {
    const all = buildTourSteps((k) => t(k));
    // Chỉ giữ step có element tồn tại trên trang hiện tại.
    const steps = all.filter(
      (s) =>
        typeof s.element === "string" &&
        document.querySelector(s.element) !== null,
    );
    if (steps.length === 0) return;
    const d = driver({
      showProgress: true,
      nextBtnText: t("next"),
      prevBtnText: t("prev"),
      doneBtnText: t("done"),
      steps,
      onDestroyed: () => {
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
