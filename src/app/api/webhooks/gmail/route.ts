/**
 * Gmail Pub/Sub Webhook Handler
 *
 * Receives push notifications from Google Cloud Pub/Sub when new emails arrive.
 * Verifies OIDC JWT, fetches new emails via Gmail API, parses Timo notifications,
 * and matches payments to debts/fund contributions.
 *
 * Routes:
 * - POST { action: "renew-watch" } → renew Gmail watch (called by Vercel Cron)
 * - POST { message: { data: base64(...) } } → Pub/Sub push notification
 */

import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getGmailAccessToken,
  gmailHistoryList,
  gmailMessageGet,
  gmailWatch,
  findHeader,
  extractEmailBody,
} from "@/lib/gmail";
import {
  parseTimoEmail,
  validateEmailAuth,
  extractEmailFromHeader,
} from "@/lib/timo-parser";
import { processPayment } from "@/lib/payment-matcher";

// Google OIDC JWKS for verifying Pub/Sub push tokens
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

// ─── State helpers (using app_settings table) ───

interface GmailState {
  historyId: string;
  expiry: number;
}

async function getGmailState(): Promise<GmailState> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, "gmail_push_state"),
  });
  if (!row) return { historyId: "0", expiry: 0 };

  try {
    const parsed = JSON.parse(row.value);
    return {
      historyId: String(parsed.historyId ?? "0"),
      expiry: Number(parsed.expiry ?? 0),
    };
  } catch {
    return { historyId: "0", expiry: 0 };
  }
}

async function setGmailState(state: GmailState): Promise<void> {
  const value = JSON.stringify({
    historyId: String(state.historyId),
    expiry: Number(state.expiry),
  });

  await db
    .insert(appSettings)
    .values({ key: "gmail_push_state", value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value },
    });
}

// ─── OIDC Verification ───

async function verifyPubsubOidc(
  req: NextRequest,
): Promise<{ ok: boolean; reason?: string }> {
  const audience = process.env.PUBSUB_OIDC_AUDIENCE;
  const expectedSA = process.env.PUBSUB_OIDC_SERVICE_ACCOUNT;

  // Fail-closed: only allow skip in non-production. In prod, missing audience = misconfigured = reject.
  if (!audience) {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        reason: "PUBSUB_OIDC_AUDIENCE not configured (refusing in production)",
      };
    }
    return { ok: true };
  }

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return { ok: false, reason: "Missing Authorization Bearer" };
  }

  const token = auth.slice(7);
  try {
    const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience,
    });

    if (expectedSA && (payload as { email?: string }).email !== expectedSA) {
      return { ok: false, reason: "SA email mismatch" };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Invalid JWT",
    };
  }
}

// ─── Main Handler ───

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Route: renew-watch
    if (body.action === "renew-watch") {
      return handleRenewWatch(req);
    }

    // Route: Pub/Sub push
    if (body.message?.data) {
      return handlePubSubPush(req, body);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    // Return 200 for permanent errors to prevent Pub/Sub retry storm
    // Return 500 only for transient errors (network, token refresh)
    const isTransient =
      err instanceof TypeError ||
      (err instanceof Error && err.message.includes("token"));
    return NextResponse.json(
      { error: message },
      { status: isTransient ? 500 : 200 },
    );
  }
}

// ─── Handle: Renew Watch ───

async function handleRenewWatch(req: NextRequest) {
  // Verify auth: x-gmail-push-secret header OR internal cron secret
  const pushSecret = process.env.GMAIL_PUSH_WEBHOOK_SECRET;
  const headerSecret = req.headers.get("x-gmail-push-secret");
  const cronSecret = req.headers.get("authorization")?.replace("Bearer ", "");

  if (pushSecret && headerSecret !== pushSecret && cronSecret !== pushSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic) {
    return NextResponse.json(
      { error: "GMAIL_PUBSUB_TOPIC not configured" },
      { status: 500 },
    );
  }

  const accessToken = await getGmailAccessToken();
  const watchResult = await gmailWatch(accessToken, topic);

  await setGmailState({
    historyId: watchResult.historyId,
    expiry: parseInt(watchResult.expiration, 10),
  });

  return NextResponse.json({
    status: "watch_renewed",
    historyId: watchResult.historyId,
    expiration: watchResult.expiration,
  });
}

// ─── Handle: Pub/Sub Push ───

async function handlePubSubPush(
  req: NextRequest,
  body: { message: { data: string }; subscription?: string },
) {
  // Verify OIDC
  const oidcResult = await verifyPubsubOidc(req);
  if (!oidcResult.ok) {
    return NextResponse.json(
      { error: "Unauthorized", reason: oidcResult.reason },
      { status: 401 },
    );
  }

  // Decode push data
  const pushData = JSON.parse(
    Buffer.from(body.message.data, "base64").toString("utf-8"),
  );

  const state = await getGmailState();

  // First push: just save historyId, don't process
  if (state.historyId === "0") {
    await setGmailState({ ...state, historyId: String(pushData.historyId) });
    return NextResponse.json({ status: "initialized" });
  }

  const accessToken = await getGmailAccessToken();

  // Fetch history since last known historyId
  let history;
  try {
    history = await gmailHistoryList(accessToken, state.historyId);
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      // historyId stale — reset
      await setGmailState({ ...state, historyId: String(pushData.historyId) });
      return NextResponse.json({ status: "historyId_reset" });
    }
    throw err;
  }

  let processed = 0;
  let skipped = 0;

  for (const record of history.history ?? []) {
    for (const added of record.messagesAdded ?? []) {
      const msg = await gmailMessageGet(accessToken, added.message.id);

      // Security: verify sender is Timo
      const fromEmail = extractEmailFromHeader(findHeader(msg, "From"));
      if (fromEmail !== "support@timo.vn") {
        skipped++;
        continue;
      }

      // Security: verify SPF + DKIM
      const authResults = findHeader(msg, "Authentication-Results");
      if (!validateEmailAuth(authResults)) {
        skipped++;
        continue;
      }

      // Parse payment
      const emailBody = extractEmailBody(msg);
      const parsed = parseTimoEmail(emailBody, msg.id);
      if (!parsed) {
        skipped++;
        continue;
      }

      // Process payment (match to debt/fund)
      await processPayment(parsed, msg.id);
      processed++;
    }
  }

  // Update historyId
  await setGmailState({ ...state, historyId: String(pushData.historyId) });

  return NextResponse.json({ status: "ok", processed, skipped });
}
