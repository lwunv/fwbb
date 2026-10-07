import { describe, it, expect, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Hồi quy 07/10/2026: index.ts từng `await client.execute("PRAGMA ...")` ở cấp
// module. Với Turso, kết nối đứt đúng lúc đó làm module nạp hỏng, và Next giữ
// nguyên module hỏng cho mọi request sau, kể cả khi DB đã khỏi. Instance trả
// "Internal Server Error" tới khi Vercel thay instance mới.

let server: http.Server | undefined;
const savedUrl = process.env.TURSO_DATABASE_URL;
const savedToken = process.env.TURSO_AUTH_TOKEN;

afterEach(async () => {
  process.env.TURSO_DATABASE_URL = savedUrl;
  process.env.TURSO_AUTH_TOKEN = savedToken;
  vi.resetModules();
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.closeAllConnections();
    server.close(() => resolve());
  });
  server = undefined;
});

describe("src/db/index.ts với DB từ xa", () => {
  it("nạp module không gọi mạng, nên DB đứt lúc đó không làm hỏng module", async () => {
    let requests = 0;
    server = http.createServer((req) => {
      requests++;
      req.socket.destroy();
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    process.env.TURSO_DATABASE_URL = `http://127.0.0.1:${port}`;
    process.env.TURSO_AUTH_TOKEN = "test";
    vi.resetModules();

    const mod = await import("./index");

    expect(mod.db).toBeDefined();
    expect(requests).toBe(0);
  });
});
