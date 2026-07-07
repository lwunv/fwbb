"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

interface BaseModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Tailwind max-w-* class — default md (28rem). Pass "max-w-lg" for wider. */
  maxWidthClass?: string;
  /** Tắt close khi click ra ngoài backdrop. Default true. */
  closeOnBackdrop?: boolean;
}

/**
 * Backdrop + animated card wrapper for app modals. Trước đây pattern này
 * được copy-paste ở nhiều chỗ (fund-dashboard, shuttlecock-finance,
 * record-contribution-dialog, …). Giờ centralized — chỉ render content,
 * BaseModal lo phần animation + backdrop + ESC + click-outside + dialog a11y.
 */
export function BaseModal({
  open,
  onClose,
  children,
  maxWidthClass = "max-w-md",
  closeOnBackdrop = true,
}: BaseModalProps) {
  // Esc để đóng (JSDoc trước đây hứa "ESC" nhưng không có listener). Chỉ gắn
  // khi mở để không nuốt Esc của các surface khác.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeOnBackdrop ? onClose : undefined}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className={cn(
              "bg-card w-full rounded-2xl p-6 shadow-xl",
              maxWidthClass,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
