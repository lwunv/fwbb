"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fireAction } from "./optimistic-action";

type ActionResult = { error?: string; success?: boolean } | void;

interface FireOptions {
  retry?: boolean;
  successMsg?: string;
  onSuccess?: () => void;
  onError?: () => void;
}

/**
 * `fireAction` kèm trạng thái chờ và CHỐT CHẶN GỌI TRÙNG.
 *
 * `fireAction` trần là bắn-rồi-quên: nó không cho biết đang chạy hay chưa, nên
 * mỗi nơi gọi phải tự lo việc khoá nút. Rất nhiều nơi quên, và hậu quả không
 * chỉ là xấu:
 *
 * - Trang thuê sân sinh `idempotencyKey` MỚI cho mỗi lần bấm, nên hai cú bấm
 *   liên tiếp tạo hai khoá khác nhau và ghi hẳn HAI lần thanh toán thật. Khoá
 *   idempotency chỉ chặn được retry nội bộ của `fireAction`, không chặn được
 *   người bấm hai lần.
 * - Form lại tự reset ngay sau khi bấm, nên nhìn cứ như chưa gửi, càng dễ bấm
 *   thêm lần nữa.
 *
 * Hook này chặn ngay tại gốc: khi một lần gọi còn đang bay, lần gọi sau bị BỎ
 * QUA (trả về false) chứ không xếp hàng — với thao tác tạo bản ghi thì bỏ qua
 * mới đúng, xếp hàng nghĩa là vẫn tạo hai bản ghi, chỉ chậm hơn. Cần xếp hàng
 * để không mất bản sửa thì dùng [[use-write-queue]] (dành cho ô cấu hình), đó
 * là bài toán khác hẳn.
 *
 * `pending` để khoá nút và hiện trạng thái chờ. UI vẫn lạc quan như cũ: hook
 * KHÔNG đổi gì trong cách cập nhật hay rollback.
 *
 * Dùng:
 * ```tsx
 * const { fire, pending } = useFireAction();
 * <Button disabled={pending} onClick={() => fire(() => doThing(), rollback)}>
 *   {pending ? <Loader2 className="animate-spin" /> : null} Lưu
 * </Button>
 * ```
 */
export function useFireAction() {
  const [pending, setPending] = useState(false);
  // Ref chứ không phải state: cú bấm thứ hai xảy ra TRƯỚC khi React kịp render
  // lại, nên đọc state ở đây vẫn thấy `false` và vẫn lọt.
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const settle = useCallback(() => {
    inFlight.current = false;
    // Component có thể đã unmount (dialog đóng ngay sau khi bấm) — setState lúc
    // đó là cảnh báo vô ích.
    if (mounted.current) setPending(false);
  }, []);

  const fire = useCallback(
    (
      action: () => Promise<ActionResult>,
      rollback?: () => void,
      options?: FireOptions,
    ): boolean => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setPending(true);
      fireAction(action, rollback, {
        ...options,
        onSuccess: () => {
          settle();
          options?.onSuccess?.();
        },
        onError: () => {
          settle();
          options?.onError?.();
        },
      });
      return true;
    },
    [settle],
  );

  return { fire, pending };
}
