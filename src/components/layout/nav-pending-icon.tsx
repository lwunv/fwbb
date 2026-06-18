"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Icon của 1 mục điều hướng, hiện spinner NGAY khi user bấm (trong lúc trang
 * đích đang tải) nhờ `useLinkStatus` (Next 16). BẮT BUỘC render BÊN TRONG
 * <Link> để đọc đúng trạng thái pending của link đó. Dùng chung cho bottom-nav
 * (member) + admin sidebar/mobile → hết cảnh "bấm xong không thấy gì".
 *
 * Spinner KHÔNG ép màu (inherit từ <Link>) để khớp mọi ngữ cảnh: mục active
 * trên admin có nền primary (chữ trắng) → spinner trắng; mục thường → theo
 * màu chữ hiện tại.
 */
export function NavPendingIcon({
  Icon,
  isActive = false,
  className = "h-5 w-5",
}: {
  Icon: React.ComponentType<{ className?: string }>;
  isActive?: boolean;
  className?: string;
}) {
  const { pending } = useLinkStatus();
  if (pending) {
    return <Loader2 className={cn(className, "animate-spin")} />;
  }
  return <Icon className={cn(className, isActive && "text-primary")} />;
}
