// @vitest-environment jsdom
/**
 * `useWriteQueue` — xếp hàng ghi theo khoá.
 *
 * Ca quan trọng nhất là ca đầu: lần ghi thứ nhất về CHẬM hơn lần thứ hai thì
 * giá trị cuối cùng ở "server" vẫn phải là lần sửa MỚI NHẤT. Không có hàng đợi
 * thì bản cũ đè bản mới, và vì cả hai payload đều hợp lệ nên không có gì báo
 * lỗi — hỏng im lặng.
 */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWriteQueue } from "./use-write-queue";

/** Nhả hết microtask đang chờ. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("useWriteQueue", () => {
  it("lần ghi đầu về chậm vẫn KHÔNG đè được lần ghi sau", async () => {
    const { result } = renderHook(() => useWriteQueue());
    const enqueue = result.current;

    let saved: string | null = null;
    let releaseFirst: (() => void) | null = null;

    // Lần ghi #1 bị giữ lại, chỉ "về tới server" khi test chủ động nhả.
    const first = enqueue("k", async () => {
      await new Promise<void>((r) => {
        releaseFirst = r;
      });
      saved = "cũ";
    });
    // Lần ghi #2 xếp sau, bản thân nó nhanh.
    const second = enqueue("k", async () => {
      saved = "mới";
    });

    await flush();
    // #2 CHƯA được chạy vì #1 chưa xong — đó chính là tác dụng của hàng đợi.
    expect(saved).toBeNull();

    releaseFirst!();
    await Promise.all([first, second]);

    expect(saved).toBe("mới");
  });

  it("hai khoá khác nhau chạy song song, không chờ nhau", async () => {
    const { result } = renderHook(() => useWriteQueue());
    const enqueue = result.current;

    const order: string[] = [];
    let releaseA: (() => void) | null = null;

    const a = enqueue("a", async () => {
      await new Promise<void>((r) => {
        releaseA = r;
      });
      order.push("a");
    });
    const b = enqueue("b", async () => {
      order.push("b");
    });

    await b;
    // b xong trước dù a vẫn đang treo: khoá khác nhau thì không chặn nhau.
    expect(order).toEqual(["b"]);

    releaseA!();
    await a;
    expect(order).toEqual(["b", "a"]);
  });

  it("một lần ghi HỎNG không chặn đứng các lần ghi sau", async () => {
    const { result } = renderHook(() => useWriteQueue());
    const enqueue = result.current;

    const failed = enqueue("k", async () => {
      throw new Error("mạng lỗi");
    });
    await expect(failed).rejects.toThrow("mạng lỗi");

    const after = await enqueue("k", async () => "vẫn chạy");
    expect(after).toBe("vẫn chạy");
  });

  it("trả về đúng kết quả của chính lần ghi đó", async () => {
    const { result } = renderHook(() => useWriteQueue());
    const enqueue = result.current;

    const r1 = enqueue("k", async () => 1);
    const r2 = enqueue("k", async () => 2);
    expect(await r1).toBe(1);
    expect(await r2).toBe(2);
  });

  it("giữ nguyên hàng đợi qua các lần render lại", async () => {
    const { result, rerender } = renderHook(() => useWriteQueue());

    let saved = "";
    let release: (() => void) | null = null;
    const first = result.current("k", async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      saved = "cũ";
    });

    rerender();
    // Sau khi render lại, hàng đợi phải là CÙNG một hàng — nếu hook dựng lại
    // ref mỗi lần render thì lần ghi dưới đây chạy ngay và đè mất thứ tự.
    const second = result.current("k", async () => {
      saved = "mới";
    });

    await flush();
    expect(saved).toBe("");

    release!();
    await Promise.all([first, second]);
    expect(saved).toBe("mới");
  });
});
