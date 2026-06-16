import { describe, it, expect } from "vitest";
import vi from "./messages/vi.json";
import en from "./messages/en.json";
import zh from "./messages/zh.json";

function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object"
      ? keyPaths(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe("i18n locale parity", () => {
  const viKeys = new Set(keyPaths(vi));
  const enKeys = new Set(keyPaths(en));
  const zhKeys = new Set(keyPaths(zh));

  it("en has exactly the same keys as vi", () => {
    expect([...viKeys].filter((k) => !enKeys.has(k))).toEqual([]);
    expect([...enKeys].filter((k) => !viKeys.has(k))).toEqual([]);
  });
  it("zh has exactly the same keys as vi", () => {
    expect([...viKeys].filter((k) => !zhKeys.has(k))).toEqual([]);
    expect([...zhKeys].filter((k) => !viKeys.has(k))).toEqual([]);
  });
});
