/**
 * Get Gmail Refresh Token
 *
 * Runs a local OAuth2 flow to obtain a refresh_token for Gmail API access.
 * This token is used by the Gmail Pub/Sub webhook to read notification emails.
 *
 * Prerequisites:
 * 1. Create a Google Cloud project with Gmail API enabled
 * 2. Create OAuth 2.0 Desktop Client credentials
 * 3. Add http://localhost:8765/oauth2callback as redirect URI
 *
 * Usage:
 *   node scripts/get-gmail-refresh-token.mjs
 *
 * Environment variables (from .env.local):
 *   GMAIL_CLIENT_ID     - OAuth client ID
 *   GMAIL_CLIENT_SECRET - OAuth client secret
 */

import { createServer } from "http";
import { URL } from "url";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load env from .env.local
const envPath = resolve(process.cwd(), ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length && !key.startsWith("#")) {
      process.env[key.trim()] = rest.join("=").trim();
    }
  }
} catch {
  console.log("⚠️  No .env.local found, using existing env vars.");
}

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:8765/oauth2callback";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env.local");
  process.exit(1);
}

// Step 1: Build authorization URL
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent"); // Force refresh_token

console.log("\n🔑 Gmail OAuth2 Refresh Token Generator\n");
console.log("1. Open this URL in your browser:\n");
console.log(`   ${authUrl.toString()}\n`);
console.log("2. Sign in with the Gmail account that receives Timo notifications.");
console.log("3. Allow access to Gmail (read-only).\n");

// Step 2: Start local server to receive callback
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:8765`);

  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400);
    res.end("No code parameter");
    return;
  }

  // Step 3: Exchange code for tokens
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.refresh_token) {
      console.log("\n✅ Success! Your refresh token:\n");
      console.log(`   GMAIL_REFRESH_TOKEN=${tokenData.refresh_token}\n`);
      console.log("Copy this to your .env.local file.\n");
    } else {
      console.log("\n⚠️  No refresh_token in response. This can happen if:");
      console.log("   - You already authorized this app before.");
      console.log("   - Fix: Go to https://myaccount.google.com/permissions");
      console.log("   - Remove the app, then run this script again.\n");
      console.log("Response:", JSON.stringify(tokenData, null, 2));
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html>
        <body style="font-family: sans-serif; text-align: center; margin-top: 100px;">
          <h1>${tokenData.refresh_token ? "✅ Success!" : "⚠️ Check terminal"}</h1>
          <p>You can close this tab and return to the terminal.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("\n❌ Token exchange failed:", err.message);
    res.writeHead(500);
    res.end("Token exchange failed");
  }

  // Shutdown after handling
  setTimeout(() => {
    server.close();
    process.exit(0);
  }, 1000);
});

server.listen(8765, () => {
  console.log("⏳ Waiting for OAuth callback on http://localhost:8765/oauth2callback ...\n");
});
