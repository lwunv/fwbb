import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMailMock = vi.hoisted(() => vi.fn());
const createTransportMock = vi.hoisted(() =>
  vi.fn(() => ({ sendMail: sendMailMock })),
);
vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
  createTransport: createTransportMock,
}));

const ORIG = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIG };
  vi.resetModules();
});

describe("sendPasswordResetEmail", () => {
  it("returns success:false and does NOT send when SMTP is unconfigured", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const { sendPasswordResetEmail } = await import("./mailer");
    const r = await sendPasswordResetEmail("a@b.com", "https://x/reset/tok");
    expect(r.success).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sends with a link and from-address when configured", async () => {
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_SECURE = "true";
    process.env.SMTP_USER = "bot@gmail.com";
    process.env.SMTP_PASS = "app-pass";
    process.env.MAIL_FROM = "FWBB <bot@gmail.com>";
    sendMailMock.mockResolvedValueOnce({ messageId: "abc" });
    const { sendPasswordResetEmail } = await import("./mailer");
    const r = await sendPasswordResetEmail("a@b.com", "https://x/reset/tok");
    expect(r.success).toBe(true);
    const arg = sendMailMock.mock.calls[0][0];
    expect(arg.to).toBe("a@b.com");
    expect(arg.from).toBe("FWBB <bot@gmail.com>");
    expect(`${arg.html}${arg.text}`).toContain("https://x/reset/tok");
  });

  it("returns success:false (never throws) when sendMail rejects", async () => {
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_USER = "bot@gmail.com";
    process.env.SMTP_PASS = "app-pass";
    sendMailMock.mockRejectedValueOnce(new Error("smtp down"));
    const { sendPasswordResetEmail } = await import("./mailer");
    const r = await sendPasswordResetEmail("a@b.com", "https://x/reset/tok");
    expect(r.success).toBe(false);
  });
});
