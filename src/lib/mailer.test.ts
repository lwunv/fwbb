import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMailMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

import { sendMail } from "./mailer";

const msg = {
  to: "a@example.com",
  subject: "s",
  text: "t",
  html: "<p>t</p>",
};

describe("sendMail", () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns not_configured without SMTP env and never throws", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_PASS", "");
    await expect(sendMail(msg)).resolves.toEqual({
      ok: false,
      code: "not_configured",
    });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("returns ok when the transport accepts the message", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.test");
    vi.stubEnv("SMTP_USER", "u");
    vi.stubEnv("SMTP_PASS", "p");
    sendMailMock.mockResolvedValue({});
    await expect(
      sendMail({ ...msg, headers: { "List-Unsubscribe": "<https://x>" } }),
    ).resolves.toEqual({ ok: true });
    expect(sendMailMock.mock.calls[0][0].headers).toEqual({
      "List-Unsubscribe": "<https://x>",
    });
  });

  it("maps a 550 reply to permanent and a timeout to transient", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.test");
    vi.stubEnv("SMTP_USER", "u");
    vi.stubEnv("SMTP_PASS", "p");
    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error("mailbox unavailable"), { responseCode: 550 }),
    );
    await expect(sendMail(msg)).resolves.toEqual({
      ok: false,
      code: "permanent",
    });
    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
    );
    await expect(sendMail(msg)).resolves.toEqual({
      ok: false,
      code: "transient",
    });
    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error("greylist"), { responseCode: 451 }),
    );
    await expect(sendMail(msg)).resolves.toEqual({
      ok: false,
      code: "transient",
    });
    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error("bad envelope"), { code: "EENVELOPE" }),
    );
    await expect(sendMail(msg)).resolves.toEqual({
      ok: false,
      code: "permanent",
    });
  });
});
