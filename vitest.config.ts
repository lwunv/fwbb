import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // `scripts/` cũng được quét: mấy script vận hành (sao lưu, khôi phục,
    // cảnh báo hạn mức) có phần logic thuần đáng test, và một script vận
    // hành sai thì chỉ lộ ra đúng lúc đang cần nó nhất.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
    exclude: ["node_modules", ".next"],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
