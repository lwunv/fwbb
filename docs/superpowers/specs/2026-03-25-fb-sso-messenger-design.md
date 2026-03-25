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
| `nickname` | `text` (optional) | **Keep** — user-editable display name independent of FB name |
| `facebookId` | — | **Add** `text UNIQUE NOT NULL` |
| `avatarUrl` | — | **Add** `text` (FB profile picture URL) |
| `avatarKey` | emoji brand code | **Keep** — fallback if FB avatar fails to load |
| `email` | — | **Add** `text` (optional, from FB if user permits) |

### Cookie format change

From: `memberId:phone:signature`
To: `memberId:facebookId:signature`

Same HMAC-SHA256 signing mechanism in `src/lib/user-identity.ts`.

All consumers of `getUserFromCookie()` that access `.phone` must be updated to use `.facebookId`:
- `src/lib/user-identity.ts` — `parseUserCookie` returns `{ memberId, facebookId }` instead of `{ memberId, phone }`
- `src/actions/members.ts` — `updateMyProfile` uses `user.phone` for comparison and cookie re-signing → update to `user.facebookId`
- `src/actions/identify.ts` — deleted entirely (replaced by `fb-auth.ts`)

### Migration

**Important:** No `ON DELETE CASCADE` exists on foreign keys in the current schema, and SQLite does not enforce FK constraints by default. The migration must delete child rows explicitly in dependency order:

1. Delete all rows from `sessionDebts`
2. Delete all rows from `sessionAttendees`
3. Delete all rows from `votes`
4. Delete all rows from `sessionShuttlecocks`
5. Delete all rows from `members`
6. Alter `members` table: remove `phone`, add `facebookId` (text, unique, not null), `avatarUrl` (text), `email` (text)

Also delete all rows from `sessions` to avoid orphaned session records with no attendees/votes/debts.

This is a destructive migration — all historical data will be removed. User confirmed this is acceptable.

---

## Section 2: Auth Flow

### Session strategy

The HMAC-signed cookie is the **sole session mechanism**. The FB access token is used only once during login to verify identity via Graph API, then discarded. The cookie (365-day TTL) maintains the session. No FB token is stored server-side.

### FB JS SDK integration

- Load SDK via `<Script>` tag in `src/app/(public)/layout.tsx` (public layout only, not root — admin doesn't need it)
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
      → Found + isActive=true → update name/avatarUrl if changed → set cookie
      → Found + isActive=false → return error "Account deactivated, contact admin"
      → Not found → insert new member → set cookie
    → revalidatePath("/")
  → Layout re-renders → user enters app
```

### Logout flow

1. Clear HMAC cookie (same as current `clearUserCookie()`)
2. Do NOT call `FB.logout()` — this would log the user out of Facebook entirely, which is undesirable
3. Redirect to login gate
4. In IAB: next visit will auto-login via `getLoginStatus()` (FB session still active)
5. In browser: user will need to click "Sign in with Facebook" again

### Security

- Server action `facebookLogin` always verifies the access token server-side via Graph API before trusting it
- Never trust client-side token directly
- HMAC-signed cookie prevents tampering

### File changes

| File | Change |
|---|---|
| `src/app/(public)/identify-gate.tsx` | **Delete** → replaced by `facebook-login-gate.tsx` |
| `src/app/(public)/facebook-login-gate.tsx` | **New** — client component with FB Login UI |
| `src/app/(public)/layout.tsx` | Render `<FacebookLoginGate>` instead of `<IdentifyGate>`, add FB SDK `<Script>` |
| `src/actions/identify.ts` | **Delete** → replaced by `src/actions/fb-auth.ts` |
| `src/actions/fb-auth.ts` | **New** — server action: verify token, upsert member, set cookie |
| `src/actions/members.ts` | Update `updateMyProfile`: remove phone logic, use `facebookId` for cookie. Remove phone from create/update member |
| `src/lib/user-identity.ts` | Update cookie format: `memberId:facebookId:signature`, return type `{ memberId, facebookId }` |
| `src/lib/facebook-sdk.ts` | **New** — SDK helpers: init, login, check status, detect IAB |
| `src/lib/validators.ts` | Update `memberSchema` (remove phone, add facebookId). Remove `myProfilePhoneSchema`. Remove `identifySchema` |
| `src/app/(public)/me/page.tsx` | Remove `memberPhone` prop, remove `member.phone` from component key |
| `src/app/(public)/me/me-client.tsx` | Remove phone input field. Keep nickname editing only |
| `src/app/(admin)/admin/members/member-list.tsx` | Remove phone display, phone search, phone in create/edit forms. Show facebookId (read-only) |
| `src/app/(admin)/admin/finance/page.tsx` | Remove `memberPhones` map construction |
| `src/app/(admin)/admin/finance/finance-client.tsx` | Remove `memberPhones` prop usage, update search to use name only |
| `src/app/api/reset-identity/route.ts` | **Keep** — already just clears cookie and redirects, works as-is for new flow |
| `src/components/sessions/admin-vote-manager.tsx` | Remove phone-based filtering |
| `src/i18n/messages/{en,vi,zh}.json` | Remove `identify.*` keys. Add FB login keys. Remove phone-related keys from `me.*` |

### Environment variables (new)

```
NEXT_PUBLIC_FB_APP_ID=<facebook-app-id>
```

Note: `FB_APP_SECRET` is not needed for the current design — the token verification call (`GET /me?access_token=...`) doesn't require it. Can be added later if `appsecret_proof` hardening is desired.

---

## Section 3: Messenger Group Chat Notifications

### Phase separation

**Important:** The Messenger Platform Send API is designed for Page-to-user 1:1 messaging. Sending to group threads is not a well-supported, stable API. This section is implemented as **Phase 2** — separate from the SSO login work.

### Approach: investigation spike first

Before implementing, a spike is needed to determine the viable approach:

1. **Option A: Messenger Group API** — Test if the Page can send to a group thread ID via Send API. This may work if the Page is a member of the group, but is undocumented/unstable.
2. **Option B: Facebook Group post** — If the club uses a Facebook Group (not Messenger group), the Graph API `/{group-id}/feed` endpoint IS supported and can post to the group wall.
3. **Option C: Messenger chatbot 1:1** — Page sends notifications to each member individually (contradicts non-goals, but may be the only stable option).

### Provisional design (pending spike results)

Helper: `src/lib/messenger.ts` — `sendNotification(message: string)` wrapper.

### Auto triggers (unchanged regardless of delivery method)

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

### Environment variables (added after spike)

```
FB_PAGE_ACCESS_TOKEN=EAAxxxxxx...
FB_MESSENGER_GROUP_THREAD_ID=t_xxxxx...  (or FB_GROUP_ID for Option B)
```

Notifications are **non-blocking** — if send fails, log error and continue the main action.

---

## Error Handling

| Scenario | Handling |
|---|---|
| FB SDK fails to load | Show retry button + manual error message |
| Token verification fails | Show "Login failed, try again" + clear any partial state |
| Deactivated member tries to login | Return error "Account deactivated, contact admin" — do NOT create new member |
| FB API rate limit | Log error, skip notification (non-blocking), retry on next trigger |
| Notification send fails | Log error, don't block the main action (session create/confirm/finalize) |
| User revokes FB permission | Next visit: cookie still valid (cookie-based session). On logout + re-login: FB will ask for permission again |
| Cookie expired (365 days) | Redirect to login gate, user re-authenticates via FB |

## Testing Plan

1. **IAB flow**: Open link in Messenger on real device (iOS + Android) → verify auto-login
2. **Browser flow**: Open in Chrome/Safari → verify redirect flow works
3. **First-time user**: Login with new FB account → verify member created in DB
4. **Returning user**: Login again → verify same member, name/avatar updated if changed
5. **Deactivated user**: Admin deactivates member → verify login returns error, no duplicate created
6. **Logout + re-login**: Logout → verify cookie cleared → re-login works in both IAB and browser
7. **Me page**: Verify nickname editing works, phone field gone
8. **Admin member list**: Verify phone removed from display/search/forms
9. **Messenger notifications** (Phase 2): Create session, confirm, finalize → verify messages delivered
10. **Error cases**: Block FB SDK loading, use invalid token → verify graceful error handling
