// Data Cache giả cho test (thay `next/cache`). Lưu kết quả đã serialize JSON
// như Next, khoá theo `[keyParts, args]` (M3) để hai lần gọi khác tham số
// không đè nhau, và `updateTag(tag)` xoá mọi mục mang tag đó. Wrapper được
// dựng lại mỗi lần gọi nên chỉ khoá quyết định có trúng cache hay không.
//
// Dùng: `vi.mock("next/cache", async () =>
//   (await import("@/test-utils/next-cache-store")).createCacheStore())`, rồi
// lấy lại cùng đối tượng bằng `(await import("next/cache")) as unknown as CacheStore`.

type Entry = { json: string; tags: string[] };

export type CacheStore = {
  store: Map<string, Entry>;
  unstable_cache: <A extends unknown[], R>(
    fn: (...args: A) => Promise<R>,
    keyParts?: string[],
    opts?: { tags?: string[]; revalidate?: number | false },
  ) => (...args: A) => Promise<R>;
  updateTag: (tag: string) => void;
  revalidateTag: (tag: string) => void;
  revalidatePath: (path: string) => void;
  /** Lượt `updateTag` đã gọi, theo thứ tự. */
  updatedTags: string[];
  clear: () => void;
};

export function createCacheStore(): CacheStore {
  const store = new Map<string, Entry>();
  const updatedTags: string[] = [];
  const dropTag = (tag: string) => {
    for (const [k, v] of store) if (v.tags.includes(tag)) store.delete(k);
  };
  return {
    store,
    updatedTags,
    unstable_cache:
      (fn, keyParts = [], opts = {}) =>
      async (...args) => {
        const key = JSON.stringify([keyParts, args]);
        const hit = store.get(key);
        if (hit) return JSON.parse(hit.json);
        const out = await fn(...args);
        const json = JSON.stringify(out ?? null);
        store.set(key, { json, tags: opts.tags ?? [] });
        return JSON.parse(json);
      },
    updateTag: (tag) => {
      updatedTags.push(tag);
      dropTag(tag);
    },
    revalidateTag: dropTag,
    revalidatePath: () => {},
    clear: () => {
      store.clear();
      updatedTags.length = 0;
    },
  };
}
