"use client";

import { useRef } from "react";

/**
 * Xếp hàng các lần ghi THEO TỪNG KHOÁ: lần ghi sau chỉ bắn đi khi lần ghi
 * trước của cùng khoá đã định đoạt xong. Hai khoá khác nhau vẫn chạy song song.
 *
 * Vì sao cần: `updateSetting` (và phần lớn action ghi cấu hình) là upsert kiểu
 * ai-đến-sau-thắng, KHÔNG kiểm phiên bản. Admin sửa nhanh hai lần trên cùng một
 * ô — đổi cách tính rồi gõ ngay số tiền, bấm liên tiếp hai ngày trong tuần, gõ
 * rồi xoá một mức sĩ số — là hai request bắn gần như cùng lúc. Nếu request đầu
 * về CHẬM hơn request sau (mạng di động giật, retry, tái dùng kết nối) thì nó
 * ghi đè bản mới bằng bản cũ. Cả hai payload đều hợp lệ nên schema không bắt
 * được: nó thất bại IM LẶNG, và trên màn cấu hình tiền thì im lặng nghĩa là
 * chia tiền sai.
 *
 * Chọn cách nối promise thay vì đánh số thứ tự rồi bỏ qua kết quả cũ: không cần
 * so sánh gì ở nơi nhận kết quả, và tự nhiên tương thích với retry sẵn có của
 * `fireAction` (retry gọi lại chính `action()`, nên nó vẫn đi qua hàng đợi).
 *
 * KHÔNG đụng tới UI lạc quan: giao diện vẫn đổi ngay, rollback vẫn theo kết quả
 * của chính lần ghi đó. Hook này chỉ sắp thứ tự các request.
 *
 * Dùng:
 * ```ts
 * const enqueue = useWriteQueue();
 * fireAction(
 *   () => enqueue("groupPolicies", () => updateSetting("groupPolicies", next)),
 *   () => rollback(),
 * );
 * ```
 */
export function useWriteQueue() {
  const queues = useRef<Map<string, Promise<void>>>(new Map());

  return function enqueue<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const prev = queues.current.get(key) ?? Promise.resolve();
    // `.then(action, action)` chứ không phải `.then(action)`: một lần ghi HỎNG
    // không được phép chặn đứng mọi lần ghi xếp sau nó.
    const run = prev.then(action, action);
    queues.current.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  };
}
