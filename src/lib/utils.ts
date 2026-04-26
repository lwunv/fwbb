import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatVND(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function roundToThousand(amount: number): number {
  return Math.ceil(amount / 1000) * 1000;
}

/** Format amount as short: 214000 → "214k", 1558333 → "1559k", 24555 → "25k" (rounds up to nearest k) */
export function formatK(amount: number): string {
  return `${Math.ceil(amount / 1000)}k`;
}
