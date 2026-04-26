/**
 * Gmail API helpers for the FWBB Gmail Pub/Sub integration.
 * Handles OAuth token refresh, history.list, message.get, and watch registration.
 */

interface CachedToken {
  token: string;
  expiresAt: number;
}

// In-memory token cache (per-process, resets on cold start)
const tokenCache = new Map<string, CachedToken>();

/**
 * Get a valid Gmail API access token using the refresh token.
 * Caches tokens in memory with a 5-minute safety margin.
 */
export async function getGmailAccessToken(): Promise<string> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Gmail OAuth credentials (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)",
    );
  }

  const cacheKey = "gmail_default";
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gmail token refresh failed (${res.status}): ${errBody}`);
  }

  const json = await res.json();

  // Cache with 5-minute safety margin (expires_in is typically 3600s)
  tokenCache.set(cacheKey, {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in - 300) * 1000,
  });

  return json.access_token;
}

/**
 * Gmail Users.history.list — returns new messages since a given historyId.
 * Throws with { status: 404 } if historyId is stale (> 7 days).
 */
export async function gmailHistoryList(
  accessToken: string,
  startHistoryId: string,
): Promise<{ history: GmailHistoryRecord[]; historyId: string }> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 404) {
    const err = new Error("historyId expired") as Error & { status: number };
    err.status = 404;
    throw err;
  }

  if (!res.ok) {
    throw new Error(
      `Gmail history.list failed (${res.status}): ${await res.text()}`,
    );
  }

  return res.json();
}

/**
 * Gmail Users.messages.get — full message with headers and body.
 */
export async function gmailMessageGet(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(
      `Gmail message.get failed (${res.status}): ${await res.text()}`,
    );
  }

  return res.json();
}

/**
 * Gmail Users.watch — register push notifications for this mailbox.
 * Must be called at least every 7 days.
 */
export async function gmailWatch(
  accessToken: string,
  topicName: string,
): Promise<{ historyId: string; expiration: string }> {
  const url = "https://gmail.googleapis.com/gmail/v1/users/me/watch";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topicName,
      labelIds: ["INBOX"],
    }),
  });

  if (!res.ok) {
    throw new Error(`Gmail watch failed (${res.status}): ${await res.text()}`);
  }

  return res.json();
}

/**
 * Gmail Users.stop — unregister push notifications.
 */
export async function gmailStop(accessToken: string): Promise<void> {
  const url = "https://gmail.googleapis.com/gmail/v1/users/me/stop";

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Gmail stop failed (${res.status}): ${await res.text()}`);
  }
}

// ─── Helper: extract data from Gmail message objects ───

export function findHeader(msg: GmailMessage, name: string): string {
  const header = msg.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ?? "";
}

export function extractEmailBody(msg: GmailMessage): string {
  // Try plain text first, then HTML
  const parts = msg.payload?.parts ?? [];

  // Single-part message
  if (!parts.length && msg.payload?.body?.data) {
    return decodeBase64Url(msg.payload.body.data);
  }

  // Multi-part: prefer text/plain
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
  }

  // Fallback to text/html, strip tags
  for (const part of parts) {
    if (part.mimeType === "text/html" && part.body?.data) {
      return stripHtml(decodeBase64Url(part.body.data));
    }
  }

  // Nested parts (e.g. multipart/alternative inside multipart/mixed)
  for (const part of parts) {
    if (part.parts) {
      for (const subPart of part.parts) {
        if (subPart.mimeType === "text/plain" && subPart.body?.data) {
          return decodeBase64Url(subPart.body.data);
        }
      }
    }
  }

  return msg.snippet ?? "";
}

function decodeBase64Url(data: string): string {
  // Gmail uses URL-safe base64: replace - → +, _ → /
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

// ─── Types ───

export interface GmailHistoryRecord {
  id: string;
  messagesAdded?: Array<{
    message: { id: string; threadId: string; labelIds: string[] };
  }>;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    mimeType?: string;
    body?: { data?: string; size?: number };
    parts?: GmailMessagePart[];
  };
}

interface GmailMessagePart {
  mimeType: string;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
}
