# Facebook SSO Login + Messenger Group Notifications

> **Date:** 2026-03-25 | **Status:** Draft | **Approach:** FB JS SDK (client-side) + server-side token verification

---

## Context

~90% of FWBB users open the web app through Facebook Messenger (In-App Browser). The current identify-gate (pick-your-name from a list) is being replaced entirely with Facebook Login SSO. Old member data will be discarded; FB Login creates new members automatically.

## Requirements

1. **Replace identify-gate** with Facebook Login — no more pick-your-name
2. **FB Login is mandatory** for all users — IAB gets auto/1-tap, regular browser gets redirect flow
3. **Auto-create members** from FB profile (id, name, avatar URL) — old members discarded, phone field removed
4. **Messenger group chat notifications** with auto triggers (new session, vote confirmed, debt reminder)

## Non-goals

- 1-1 Messenger inbox messages
- Messenger API for receiving messages (webhook listener)
- Admin mapping of FB accounts to existing members
- Phone-based identification

---

## Section 1: Database Schema Changes

### Members table — modifications

| Field | Before | After |
|---|---|---|
| `phone` | `text NOT NULL UNIQUE` | **Remove** |
| `facebookId` | — | **Add** `text UNIQUE NOT NULL` |
| `avatarUrl` | — | **Add** `text` (FB profile picture URL) |
| `avatarKey` | emoji brand code | **Keep** — fallback if FB avatar fails to load |
| `email` | — | **Add** `text` (optional, from FB if user permits) |

### Cookie format change

From: `memberId:phone:signature`
To: `memberId:facebookId:signature`

Same HMAC-SHA256 signing mechanism in `src/lib/user-identity.ts`.

### Migration

- Drop all existing member rows (user confirmed old data is discarded)
- Alter `members` table: remove `phone`, add `facebookId`, `avatarUrl`, `email`
- Foreign key references from `votes`, `sessionDebts`, `sessionAttendees` will cascade (rows referencing deleted members get cleaned up)

---

## Section 2: Auth Flow

### FB JS SDK integration

- Load SDK via `<Script>` tag in `src/app/layout.tsx`
- SDK helpers in `src/lib/facebook-sdk.ts`: `initFacebookSDK()`, `checkLoginStatus()`, `loginWithFacebook()`, `isInFacebookBrowser()`

### Login flow (replaces identify-gate)

```
User opens link
  → PublicLayout checks cookie (server-side)
  → No cookie → render <FacebookLoginGate>
    → Client detects IAB vs regular browser
    → IAB: getLoginStatus()
      → connected → auto-login silently
      → not connected → show "Continue with Facebook" button (1 tap)
    → Regular browser: show "Sign in with Facebook" → redirect flow
  → Client receives accessToken
  → Calls server action facebookLogin(accessToken)
    → Server verifies token via Graph API (GET /me?fields=id,name,email,picture&access_token=...)
    → Find member by facebookId
      → Found → update name/avatarUrl if changed → set cookie
      → Not found → insert new member → set cookie
    → revalidatePath("/")
  → Layout re-renders → user enters app
```

### Security

- Server action `facebookLogin` always verifies the access token server-side via Graph API before trusting it
- Never trust client-side token directly
- HMAC-signed cookie prevents tampering

### File changes

| File | Change |
|---|---|
| `src/app/(public)/identify-gate.tsx` | **Delete** → replaced by `facebook-login-gate.tsx` |
| `src/app/(public)/facebook-login-gate.tsx` | **New** — client component with FB Login UI |
| `src/app/(public)/layout.tsx` | Render `<FacebookLoginGate>` instead of `<IdentifyGate>` |
| `src/actions/identify.ts` | **Delete** → replaced by `src/actions/fb-auth.ts` |
| `src/actions/fb-auth.ts` | **New** — server action: verify token, upsert member, set cookie |
| `src/lib/user-identity.ts` | Update cookie format: `memberId:facebookId:signature` |
| `src/lib/facebook-sdk.ts` | **New** — SDK helpers: init, login, check status, detect IAB |
| `src/app/layout.tsx` | Add `<Script>` to load FB JS SDK |

### Environment variables (new)

```
NEXT_PUBLIC_FB_APP_ID=<facebook-app-id>
FB_APP_SECRET=<facebook-app-secret>
```

---

## Section 3: Messenger Group Chat Notifications

### Mechanism

Server-side Graph API calls to send messages to a Messenger group chat. A Facebook Page acts as the "sender" (Page must be added to the group).

### Helper

`src/lib/messenger.ts` — `sendGroupMessage(message: string)` wrapper around Graph API.

### Auto triggers

| Trigger | When | Message content |
|---|---|---|
| New session | Admin creates a voting session | "📋 Session mới ngày {date} tại {court}! Vào vote: {link}" |
| Vote confirmed | Session status → confirmed | "✅ Session {date} confirmed! {X} người chơi, {Y} người ăn" |
| Debt reminder | Session completed + debts calculated | "💰 Session {date} đã kết thúc. Tổng chi {amount}. Xem nợ: {link}" |

### Trigger integration points

| Server action file | Trigger point |
|---|---|
| `src/actions/sessions.ts` | On session create → send new session notification |
| `src/actions/sessions.ts` | On status update to "confirmed" → send vote confirmed notification |
| `src/actions/finance.ts` | On finalize debts → send debt reminder notification |

### Environment variables (new)

```
FB_PAGE_ACCESS_TOKEN=EAAxxxxxx...
FB_MESSENGER_GROUP_THREAD_ID=t_xxxxx...
```

### Fallback note

Messenger Group API is currently limited. If Graph API doesn't support sending to group threads directly, the fallback approach is: Page gets added to the group → users send a message to the Page in the group to activate → Page can then send messages to the group.

---

## Error Handling

| Scenario | Handling |
|---|---|
| FB SDK fails to load | Show retry button + manual error message |
| Token verification fails | Show "Login failed, try again" + clear any partial state |
| FB API rate limit | Log error, skip notification (non-blocking), retry on next trigger |
| Group message send fails | Log error, don't block the main action (session create/confirm/finalize) |
| User revokes FB permission | Next request detects invalid cookie → redirect to login gate |
| Token expired | Client-side: `getLoginStatus()` to refresh; Server-side: return 401 → client re-triggers login |

## Testing Plan

1. **IAB flow**: Open link in Messenger on real device (iOS + Android) → verify auto-login
2. **Browser flow**: Open in Chrome/Safari → verify redirect flow works
3. **First-time user**: Login with new FB account → verify member created in DB
4. **Returning user**: Login again → verify same member, name/avatar updated if changed
5. **Messenger notifications**: Create session, confirm, finalize → verify messages appear in group chat
6. **Token expiry**: Wait for token to expire → verify re-login works smoothly
7. **Error cases**: Block FB SDK loading, use invalid token → verify graceful error handling
