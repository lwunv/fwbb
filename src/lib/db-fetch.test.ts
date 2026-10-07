import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { createRetryingFetch, isConnectionResetError } from "./db-fetch";

// hrana-client luôn gọi fetch bằng Request của cross-fetch (node-fetch@2), không
// phải Request chuẩn của Node. Lấy đúng class đó từ cây phụ thuộc của
// @libsql/client để test khớp với thứ thư viện thật sự truyền vào.
const requireFromHere = createRequire(import.meta.url);
const requireFromClient = createRequire(
  requireFromHere.resolve("@libsql/client"),
);
const requireFromHrana = createRequire(
  requireFromClient.resolve("@libsql/hrana-client"),
);
const { Request: CrossFetchRequest, Headers: CrossFetchHeaders } =
  requireFromHrana("cross-fetch") as {
    Request: typeof Request;
    Headers: typeof Headers;
  };

type Seen = { method?: string; body: string; auth?: string; type?: string };

let server: http.Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.closeAllConnections();
    server.close(() => resolve());
  });
  server = undefined;
});

/** Server cắt ngang `resetCount` request đầu (giống Turso đóng kết nối idle), sau đó trả JSON. */
async function startServer(resetCount: number) {
  const seen: Seen[] = [];
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        method: req.method,
        body: Buffer.concat(chunks).toString(),
        auth: req.headers.authorization,
        type: req.headers["content-type"],
      });
      if (seen.length <= resetCount) {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, attempt: seen.length }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/v2/pipeline`, seen };
}

function pipelineRequest(url: string, body: string) {
  const headers = new CrossFetchHeaders();
  headers.set("content-type", "application/json");
  headers.set("authorization", "Bearer test-token");
  return new CrossFetchRequest(url, { method: "POST", headers, body });
}

describe("createRetryingFetch", () => {
  it("thử lại một lần khi kết nối bị cắt, gửi lại y nguyên method, header và body", async () => {
    const { url, seen } = await startServer(1);
    const body = JSON.stringify({ requests: [{ type: "execute" }] });

    const res = await createRetryingFetch()(pipelineRequest(url, body));

    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true, attempt: 2 });
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s).toEqual({
        method: "POST",
        body,
        auth: "Bearer test-token",
        type: "application/json",
      });
    }
  });

  it("không đứt ở lần đầu thì chỉ gọi đúng một lần", async () => {
    const { url, seen } = await startServer(0);

    const res = await createRetryingFetch()(pipelineRequest(url, "{}"));

    expect(await res.json()).toEqual({ ok: true, attempt: 1 });
    expect(seen).toHaveLength(1);
  });

  it("đứt cả hai lần thì ném lỗi, không thử quá một lần", async () => {
    const { url, seen } = await startServer(5);

    await expect(
      createRetryingFetch()(pipelineRequest(url, "{}")),
    ).rejects.toSatisfy(isConnectionResetError);
    expect(seen).toHaveLength(2);
  });

  it("request GET không body (bước dò phiên bản giao thức) vẫn đi được", async () => {
    const { url, seen } = await startServer(1);

    const res = await createRetryingFetch()(
      new CrossFetchRequest(url, { method: "GET" }),
    );

    expect(res.ok).toBe(true);
    expect(seen.map((s) => s.method)).toEqual(["GET", "GET"]);
  });

  it("lỗi không phải đứt kết nối thì ném luôn, không thử lại", async () => {
    let calls = 0;
    const boom = new TypeError("Invalid URL");
    const fetchImpl = (async () => {
      calls++;
      throw boom;
    }) as typeof fetch;

    await expect(
      createRetryingFetch(fetchImpl)(pipelineRequest("http://x.test/", "{}")),
    ).rejects.toBe(boom);
    expect(calls).toBe(1);
  });

  it("HTTP 500 là phản hồi hợp lệ, trả nguyên cho thư viện xử lý chứ không thử lại", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response("boom", { status: 500 });
    }) as typeof fetch;

    const res = await createRetryingFetch(fetchImpl)(
      pipelineRequest("http://x.test/", "{}"),
    );

    expect(res.status).toBe(500);
    expect(calls).toBe(1);
  });
});

describe("isConnectionResetError", () => {
  it.each([
    [
      "node-fetch ECONNRESET",
      Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    ],
    [
      "undici other side closed",
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("other side closed"), {
          code: "UND_ERR_SOCKET",
        }),
      }),
    ],
    [
      "undici ECONNRESET lồng trong cause",
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("read ECONNRESET"), {
          code: "ECONNRESET",
        }),
      }),
    ],
    ["EPIPE", Object.assign(new Error("write EPIPE"), { code: "EPIPE" })],
    [
      "chỉ có message socket hang up",
      new Error("request failed, reason: socket hang up"),
    ],
  ])("nhận ra %s", (_label, err) => {
    expect(isConnectionResetError(err)).toBe(true);
  });

  it.each([
    [
      "timeout",
      Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }),
    ],
    [
      "DNS",
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), {
          code: "ENOTFOUND",
        }),
      }),
    ],
    ["abort", new DOMException("aborted", "AbortError")],
    ["không phải Error", "socket"],
    ["null", null],
  ])("bỏ qua %s", (_label, err) => {
    expect(isConnectionResetError(err)).toBe(false);
  });
});
