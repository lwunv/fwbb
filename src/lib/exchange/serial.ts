import "server-only";

/**
 * Hàng đợi trong process, cùng lý do với `submitQueue` ở `src/actions/venues.ts`:
 * client libsql mở kết nối mới cho mỗi transaction nên hai transaction ghi đồng
 * thời trong một instance dễ gặp SQLITE_BUSY. Xếp chúng nối đuôi nhau. Một task
 * lỗi không làm hỏng hàng đợi của task sau.
 */
let queue: Promise<unknown> = Promise.resolve();

export function runSerial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}
