import { describe, it, expect, afterEach, vi } from "vitest";
import { notificationConfigWarnings } from "./config-warnings";

const FULL = {
  NEXT_PUBLIC_APP_URL: "https://fwbb.example",
  QSTASH_TOKEN: "t",
  QSTASH_CURRENT_SIGNING_KEY: "c",
  QSTASH_NEXT_SIGNING_KEY: "n",
  SMTP_HOST: "smtp.example",
  SMTP_USER: "u",
  SMTP_PASS: "p",
};

function stub(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

afterEach(() => vi.unstubAllEnvs());

describe("notificationConfigWarnings", () => {
  it("is empty when everything is configured", () => {
    stub(FULL);
    expect(notificationConfigWarnings()).toEqual([]);
  });

  it("warns about a missing NEXT_PUBLIC_APP_URL even when the QStash keys are set", () => {
    stub({ ...FULL, NEXT_PUBLIC_APP_URL: "" });
    expect(notificationConfigWarnings()).toEqual(["appUrlMissing"]);
    stub({ NEXT_PUBLIC_APP_URL: "   " });
    expect(notificationConfigWarnings()).toEqual(["appUrlMissing"]);
  });

  it("lists QStash and SMTP gaps separately", () => {
    stub({ ...FULL, QSTASH_TOKEN: "", SMTP_PASS: "" });
    expect(notificationConfigWarnings()).toEqual([
      "qstashMissing",
      "smtpMissing",
    ]);
  });
});
