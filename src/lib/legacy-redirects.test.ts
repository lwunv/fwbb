import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("legacy /san redirects", () => {
  it("permanently redirects the old venue routes, de-xuat before :id", async () => {
    const rules = await (
      nextConfig as unknown as {
        redirects: () => Promise<
          { source: string; destination: string; permanent: boolean }[]
        >;
      }
    ).redirects();
    expect(rules.map((r) => [r.source, r.destination, r.permanent])).toEqual([
      ["/san", "/venues", true],
      ["/san/de-xuat", "/venues/suggest", true],
      ["/san/:id", "/venues/:id", true],
    ]);
  });
});
