"use client";

import { usePolling } from "@/lib/use-polling";

/** Drop-in component to enable auto-refresh on server-rendered pages */
export function AutoRefresh({ interval = 5000 }: { interval?: number }) {
  usePolling(interval);
  return null;
}
