# Facebook SSO Login + Messenger Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pick-your-name identify-gate with Facebook SSO Login and add Messenger group chat notifications.

**Architecture:** FB JS SDK on client detects IAB vs regular browser and obtains an access token. A server action verifies the token via Graph API, upserts the member, and sets an HMAC-signed cookie. Messenger notifications are server-side Graph API calls triggered from existing session/finance actions.

**Tech Stack:** Next.js 16 (App Router), FB JS SDK v19.0, Drizzle ORM + SQLite (Turso), HMAC-SHA256 cookies

**Spec:** `docs/superpowers/specs/2026-03-25-fb-sso-messenger-design.md`

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `src/lib/facebook-sdk.ts` | FB JS SDK helpers: init, login, check status, detect IAB |
| `src/actions/fb-auth.ts` | Server action: verify FB token, upsert member, set cookie |
| `src/app/(public)/facebook-login-gate.tsx` | Client component: FB login UI (replaces identify-gate) |
| `src/lib/messenger.ts` | Server-side helper: send notification via Graph API |

### Modified files
| File | Change summary |
|---|---|
| `src/db/schema.ts` | Remove `phone` from members, add `facebookId`, `avatarUrl`, `email` |
| `src/lib/user-identity.ts` | Cookie format: `memberId:facebookId:signature` |
| `src/lib/validators.ts` | Remove phone schemas, add facebookId to memberSchema |
| `src/actions/members.ts` | Remove phone logic from create/update/profile |
| `src/app/(public)/layout.tsx` | Render `<FacebookLoginGate>`, add FB SDK `<Script>` |
| `src/app/(public)/me/page.tsx` | Remove `memberPhone` prop |
| `src/app/(public)/me/me-client.tsx` | Remove phone input field |
| `src/app/(admin)/admin/members/member-list.tsx` | Remove phone display/search/forms |
| `src/app/(admin)/admin/finance/page.tsx` | Remove `memberPhones` map |
| `src/app/(admin)/admin/finance/finance-client.tsx` | Remove `memberPhones` prop, update search |
| `src/components/sessions/admin-vote-manager.tsx` | Remove phone from search filter |
| `src/i18n/messages/vi.json` | Remove identify/phone keys, add FB login keys |
| `src/i18n/messages/en.json` | Same |
| `src/i18n/messages/zh.json` | Same |
| `src/actions/sessions.ts` | Add notification triggers on create/confirm |
| `src/actions/finance.ts` | Add notification trigger on finalize |

### Deleted files
| File | Reason |
|---|---|
| `src/app/(public)/identify-gate.tsx` | Replaced by `facebook-login-gate.tsx` |
| `src/actions/identify.ts` | Replaced by `src/actions/fb-auth.ts` |

---

## Phase 1: SSO Login

### Task 1: Database Schema Migration

**Files:**
- Modify: `src/db/schema.ts:11-21`

- [ ] **Step 1: Update members table schema**

In `src/db/schema.ts`, replace the `members` table definition:

```typescript
export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  nickname: text("nickname"),
  avatarKey: text("avatar_key"),
  facebookId: text("facebook_id").notNull().unique(),
  avatarUrl: text("avatar_url"),
  email: text("email"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
});
```

Key change: `phone` removed, `facebookId` + `avatarUrl` + `email` added.

- [ ] **Step 2: Push schema to database**

Run: `npx drizzle-kit push`

This will prompt for destructive changes (dropping `phone` column). Confirm yes. Since old data is being discarded, this is safe.

If drizzle-kit cannot handle the column change in SQLite (SQLite doesn't support DROP COLUMN before 3.35), you may need to recreate the table. drizzle-kit push handles this automatically for SQLite by recreating the table.

- [ ] **Step 3: Verify schema is correct**

Run: `npx drizzle-kit studio` or check the database directly to confirm the `members` table has the new columns.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: update members schema — remove phone, add facebookId/avatarUrl/email"
```

---

### Task 2: Update Cookie Identity System

**Files:**
- Modify: `src/lib/user-identity.ts` (full file)

- [ ] **Step 1: Update user-identity.ts**

Replace the entire file:

```typescript
import { cookies } from "next/headers";
import { createHmac } from "crypto";

const USER_COOKIE = "fwbb-user";
const SECRET = process.env.USER_COOKIE_SECRET || "fallback-secret";

function sign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("hex");
}

export function createUserCookieValue(memberId: number, facebookId: string): string {
  const data = `${memberId}:${facebookId}`;
  const signature = sign(data);
  return `${data}:${signature}`;
}

export function parseUserCookie(value: string): { memberId: number; facebookId: string } | null {
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const [memberIdStr, facebookId, signature] = parts;
  const data = `${memberIdStr}:${facebookId}`;
  if (sign(data) !== signature) return null;
  return { memberId: parseInt(memberIdStr, 10), facebookId };
}

export async function setUserCookie(memberId: number, facebookId: string) {
  const cookieStore = await cookies();
  cookieStore.set(USER_COOKIE, createUserCookieValue(memberId, facebookId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}

export async function getUserFromCookie(): Promise<{ memberId: number; facebookId: string } | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(USER_COOKIE)?.value;
  if (!value) return null;
  return parseUserCookie(value);
}

export async function clearUserCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(USER_COOKIE);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/user-identity.ts
git commit -m "feat: update cookie format — memberId:facebookId:signature"
```

---

### Task 3: Update Validators

**Files:**
- Modify: `src/lib/validators.ts:8-16,46-49`

- [ ] **Step 1: Update memberSchema and remove phone schemas**

In `src/lib/validators.ts`:

1. Replace `memberSchema` (lines 8-11) — now used only for admin edit (name validation):
```typescript
export const memberSchema = z.object({
  name: z.string().min(1, "Ten khong duoc de trong"),
});
```

2. Remove `myProfilePhoneSchema` (lines 14-16) entirely.

3. Remove `identifySchema` (lines 46-49) entirely.

- [ ] **Step 2: Commit**

```bash
git add src/lib/validators.ts
git commit -m "feat: update validators — remove phone, add facebookId"
```

---

### Task 4: Create FB SDK Helpers

**Files:**
- Create: `src/lib/facebook-sdk.ts`

- [ ] **Step 1: Create facebook-sdk.ts**

```typescript
declare global {
  interface Window {
    FB: any;
    fbAsyncInit: () => void;
  }
}

const SDK_TIMEOUT_MS = 10_000;

export function initFacebookSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    // If already initialized
    if (window.FB) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error("Facebook SDK load timeout"));
    }, SDK_TIMEOUT_MS);

    window.fbAsyncInit = function () {
      clearTimeout(timer);
      window.FB.init({
        appId: process.env.NEXT_PUBLIC_FB_APP_ID,
        cookie: true,
        xfbml: false,
        version: "v19.0",
      });
      resolve();
    };

    // Inject SDK script if not already in DOM
    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
}

export function checkLoginStatus(): Promise<{ status: string; authResponse?: { accessToken: string; userID: string } }> {
  return new Promise((resolve) => {
    window.FB.getLoginStatus((response: any) => {
      resolve(response);
    });
  });
}

export function loginWithFacebook(): Promise<{ accessToken: string; userID: string }> {
  return new Promise((resolve, reject) => {
    window.FB.login(
      (response: any) => {
        if (response.authResponse) {
          resolve(response.authResponse);
        } else {
          reject(new Error("User cancelled login"));
        }
      },
      { scope: "public_profile,email" },
    );
  });
}

export function isInFacebookBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return ua.includes("FBAN") || ua.includes("FBAV") || ua.includes("FB_IAB");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/facebook-sdk.ts
git commit -m "feat: add FB JS SDK helpers"
```

---

### Task 5: Create FB Auth Server Action

**Files:**
- Create: `src/actions/fb-auth.ts`

- [ ] **Step 1: Create fb-auth.ts**

```typescript
"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setUserCookie, clearUserCookie } from "@/lib/user-identity";
import { revalidatePath } from "next/cache";

interface FacebookUserInfo {
  id: string;
  name: string;
  email?: string;
  picture?: { data?: { url?: string } };
}

export async function facebookLogin(accessToken: string) {
  // 1. Verify token server-side via Graph API
  let fbUser: FacebookUserInfo;
  try {
    const res = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${accessToken}`,
    );
    if (!res.ok) {
      return { error: "Facebook verification failed" };
    }
    fbUser = await res.json();
  } catch {
    return { error: "Failed to connect to Facebook" };
  }

  if (!fbUser.id || !fbUser.name) {
    return { error: "Invalid Facebook response" };
  }

  // 2. Find existing member by facebookId
  const existing = await db.query.members.findFirst({
    where: eq(members.facebookId, fbUser.id),
  });

  if (existing) {
    // Check if deactivated
    if (!existing.isActive) {
      return { error: "Account deactivated. Contact admin." };
    }

    // Update name/avatar if changed
    const avatarUrl = fbUser.picture?.data?.url ?? null;
    if (existing.name !== fbUser.name || existing.avatarUrl !== avatarUrl || existing.email !== (fbUser.email ?? null)) {
      await db.update(members).set({
        name: fbUser.name,
        avatarUrl,
        email: fbUser.email ?? null,
      }).where(eq(members.id, existing.id));
    }

    await setUserCookie(existing.id, existing.facebookId);
    revalidatePath("/");
    return { success: true, memberName: existing.name };
  }

  // 3. Create new member
  const avatarUrl = fbUser.picture?.data?.url ?? null;
  const [newMember] = await db.insert(members).values({
    name: fbUser.name,
    facebookId: fbUser.id,
    avatarUrl,
    email: fbUser.email ?? null,
  }).returning();

  await setUserCookie(newMember.id, newMember.facebookId);
  revalidatePath("/");
  return { success: true, memberName: newMember.name };
}

export async function resetIdentity() {
  await clearUserCookie();
  revalidatePath("/");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/actions/fb-auth.ts
git commit -m "feat: add FB auth server action — verify token, upsert member"
```

---

### Task 6: Create Facebook Login Gate Component

**Files:**
- Create: `src/app/(public)/facebook-login-gate.tsx`

- [ ] **Step 1: Create facebook-login-gate.tsx**

```tsx
"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CircleDot, Loader2 } from "lucide-react";
import {
  initFacebookSDK,
  checkLoginStatus,
  loginWithFacebook,
  isInFacebookBrowser,
} from "@/lib/facebook-sdk";
import { facebookLogin } from "@/actions/fb-auth";

export function FacebookLoginGate({ appName = "FWBB" }: { appName?: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "logging-in" | "error">("loading");
  const [error, setError] = useState("");
  const t = useTranslations("fbLogin");

  useEffect(() => {
    initFacebookSDK()
      .then(async () => {
        if (isInFacebookBrowser()) {
          // In IAB: try auto-login
          const response = await checkLoginStatus();
          if (response.status === "connected" && response.authResponse) {
            setStatus("logging-in");
            const result = await facebookLogin(response.authResponse.accessToken);
            if (result.error) {
              setError(result.error);
              setStatus("ready");
            }
            // On success, layout will re-render
            return;
          }
        }
        setStatus("ready");
      })
      .catch(() => {
        setStatus("error");
        setError(t("sdkLoadError"));
      });
  }, [t]);

  async function handleLogin() {
    setStatus("logging-in");
    setError("");
    try {
      const auth = await loginWithFacebook();
      const result = await facebookLogin(auth.accessToken);
      if (result.error) {
        setError(result.error);
        setStatus("ready");
      }
      // On success, layout will re-render
    } catch {
      setError(t("loginCancelled"));
      setStatus("ready");
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="p-6 space-y-6">
        <div className="text-center space-y-2">
          <CircleDot className="h-10 w-10 text-primary mx-auto" />
          <h1 className="text-xl font-bold">{appName}</h1>
          <p className="text-sm text-muted-foreground">
            {status === "loading" ? t("checkingLogin") : t("signInPrompt")}
          </p>
        </div>

        {status === "loading" && (
          <div className="flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {status === "logging-in" && (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t("loggingIn")}</p>
          </div>
        )}

        {status === "ready" && (
          <Button onClick={handleLogin} className="w-full" size="lg">
            <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            {t("continueWithFacebook")}
          </Button>
        )}

        {status === "error" && (
          <div className="text-center space-y-3">
            <p className="text-sm text-destructive">{error || t("genericError")}</p>
            <Button onClick={() => window.location.reload()} variant="outline" size="sm">
              {t("retry")}
            </Button>
          </div>
        )}

        {error && status !== "error" && (
          <p className="text-sm text-destructive text-center">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(public)/facebook-login-gate.tsx
git commit -m "feat: add FacebookLoginGate component — IAB auto-login + redirect flow"
```

---

### Task 7: Update Public Layout

**Files:**
- Modify: `src/app/(public)/layout.tsx` (full file)

- [ ] **Step 1: Update layout.tsx**

Replace the full content of `src/app/(public)/layout.tsx`:

```tsx
import { getUserFromCookie } from "@/lib/user-identity";
import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Header } from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { FacebookLoginGate } from "./facebook-login-gate";
import { getAppName } from "@/actions/settings";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, appName] = await Promise.all([getUserFromCookie(), getAppName()]);

  // If user is not identified, show FB login
  // FB SDK script is injected by initFacebookSDK() in FacebookLoginGate
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header appName={appName} />
        <main className="flex-1 flex items-center justify-center p-4">
          <FacebookLoginGate appName={appName} />
        </main>
      </div>
    );
  }

  // If user exists, check if their member is still active
  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
  });

  if (!member || !member.isActive) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header appName={appName} />
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="text-center max-w-sm space-y-4">
            <div className="text-4xl">🚫</div>
            <h2 className="text-xl font-bold">Tài khoản bị vô hiệu hóa</h2>
            <p className="text-muted-foreground">
              Tài khoản của bạn đã bị vô hiệu hóa. Liên hệ admin để được hỗ trợ.
            </p>
            <form action={async () => {
              "use server";
              const { clearUserCookie } = await import("@/lib/user-identity");
              await clearUserCookie();
            }}>
              <button
                type="submit"
                className="text-sm text-primary underline underline-offset-2"
              >
                Đăng nhập lại với tài khoản khác
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header appName={appName} />
      <main className="flex-1 pb-20 px-4 py-4">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
```

Key changes: Import `FacebookLoginGate` instead of `IdentifyGate`, remove `allMembers` query. FB SDK script is injected by `initFacebookSDK()` inside the login gate component (no `<Script>` tag needed in layout).

Note: `src/app/api/reset-identity/route.ts` needs **no changes** — it already just clears the cookie and redirects, which works for the new flow.

- [ ] **Step 2: Delete old identify-gate**

```bash
rm src/app/\(public\)/identify-gate.tsx
```

- [ ] **Step 3: Delete old identify action**

```bash
rm src/actions/identify.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/app/(public)/layout.tsx
git add src/app/(public)/identify-gate.tsx src/actions/identify.ts
git commit -m "feat: replace identify-gate with FacebookLoginGate in public layout"
```

---

### Task 8: Update Members Server Actions

**Files:**
- Modify: `src/actions/members.ts`

- [ ] **Step 1: Update imports and remove phone logic**

In `src/actions/members.ts`:

1. Line 9: Change import — remove `myProfilePhoneSchema`:
```typescript
import { memberSchema } from "@/lib/validators";
```

2. `createMember` function (line 32-45): **Remove entirely.** Members are now auto-created when they log in via Facebook (handled by `facebookLogin` in `fb-auth.ts`). Admin no longer needs to manually create members. Delete the function body or replace with a stub that returns an error:
```typescript
export async function createMember(_formData: FormData) {
  return { error: "Members are created automatically via Facebook Login" };
}
```

3. `updateMyProfile` function (lines 90-134): Remove all phone logic, only update nickname:
```typescript
export async function updateMyProfile(
  _prev: UpdateMyProfileState,
  formData: FormData,
): Promise<UpdateMyProfileState> {
  const t = await getTranslations("me");
  const user = await getUserFromCookie();
  if (!user) {
    return { error: t("profileNotSignedIn") };
  }

  const nicknameRaw = String(formData.get("nickname") ?? "").trim();
  if (nicknameRaw.length > 40) {
    return { error: t("nicknameTooLong") };
  }
  const nickname = nicknameRaw.length === 0 ? null : nicknameRaw;

  await db
    .update(members)
    .set({ nickname })
    .where(eq(members.id, user.memberId));

  revalidatePath("/me");
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/my-debts");
  return { success: true };
}
```

4. `updateMember` function (lines 136-149): Remove phone:
```typescript
export async function updateMember(id: number, formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "Ten khong duoc de trong" };
  const nickname = (formData.get("nickname") as string)?.trim() || null;
  await db.update(members).set({ name, nickname }).where(eq(members.id, id));
  revalidatePath("/admin/members");
  return { success: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/actions/members.ts
git commit -m "feat: remove phone from member actions, update profile to nickname-only"
```

---

### Task 9: Update Me Page

**Files:**
- Modify: `src/app/(public)/me/page.tsx:58,63`
- Modify: `src/app/(public)/me/me-client.tsx:63-73,155,178-193`

- [ ] **Step 1: Update me/page.tsx**

In `src/app/(public)/me/page.tsx`:

1. Line 58: Remove `member.phone` from key:
```typescript
key={`${member.id}-${member.name}-${member.nickname ?? ""}-${member.avatarKey ?? ""}`}
```

2. Line 63: Remove `memberPhone` prop entirely. The `<MeClient>` call becomes:
```tsx
<MeClient
  key={`${member.id}-${member.name}-${member.nickname ?? ""}-${member.avatarKey ?? ""}`}
  memberId={member.id}
  avatarKey={member.avatarKey ?? null}
  memberName={member.name}
  memberNickname={member.nickname ?? null}
  totalPlayed={totalPlayed}
  totalDined={totalDined}
  totalSpent={totalSpent}
  outstandingDebt={outstandingDebt}
/>
```

- [ ] **Step 2: Update me-client.tsx**

1. Remove `Phone` from lucide imports (line 21).

2. Remove `memberPhone` from interface (line 68) and function params (line 80):
```typescript
interface MeClientProps {
  memberId: number;
  avatarKey: string | null;
  memberName: string;
  memberNickname: string | null;
  totalPlayed: number;
  totalDined: number;
  totalSpent: number;
  outstandingDebt: number;
}
```

3. Remove the entire phone input block (lines 178-193 — the `<div className="space-y-1.5">` containing `me-phone` label and input).

- [ ] **Step 3: Commit**

```bash
git add src/app/(public)/me/page.tsx src/app/(public)/me/me-client.tsx
git commit -m "feat: remove phone from Me page — nickname-only profile editing"
```

---

### Task 10: Update Admin Member List

**Files:**
- Modify: `src/app/(admin)/admin/members/member-list.tsx`

- [ ] **Step 1: Remove phone and create-member from member-list.tsx**

1. Search filter (line 79): Remove phone search:
```typescript
return m.name.toLowerCase().includes(q);
```

2. Remove the "Add member" button and create flow entirely (lines 135-138 DialogTrigger). Members are now auto-created via FB login. Keep the Edit dialog for updating name/nickname.

3. Edit form: Remove the phone field block (lines 164-172, the `<div className="space-y-2">` containing phone Label+Input). Keep name and nickname fields only.

4. Member card display (line 232): Remove `<p className="text-sm text-muted-foreground">{member.phone}</p>`.

- [ ] **Step 2: Commit**

```bash
git add src/app/(admin)/admin/members/member-list.tsx
git commit -m "feat: remove phone from admin member list"
```

---

### Task 11: Update Admin Finance

**Files:**
- Modify: `src/app/(admin)/admin/finance/page.tsx:11-14,42`
- Modify: `src/app/(admin)/admin/finance/finance-client.tsx:22,38,45,66,89`

- [ ] **Step 1: Update finance/page.tsx**

Remove `memberPhones` construction (lines 11-13), remove the `getActiveMembers` import and call (no longer needed), and remove the prop from `<AdminFinanceClient>` (line 42):

```tsx
export default async function AdminFinancePage() {
  const debts = await getAllDebts("all");

  const debtCards = debts.map((d) => ({
    id: d.id,
    sessionId: d.sessionId,
    memberId: d.memberId,
    memberAvatarKey: d.member.avatarKey ?? null,
    memberName: d.member.name,
    sessionDate: d.session.date,
    playAmount: d.playAmount ?? 0,
    dineAmount: d.dineAmount ?? 0,
    guestPlayAmount: d.guestPlayAmount ?? 0,
    guestDineAmount: d.guestDineAmount ?? 0,
    totalAmount: d.totalAmount,
    memberConfirmed: d.memberConfirmed ?? false,
    adminConfirmed: d.adminConfirmed ?? false,
    adminConfirmedAt: d.adminConfirmedAt ?? null,
  }));

  const totalOutstanding = debtCards
    .filter((d) => !d.adminConfirmed)
    .reduce((sum, d) => sum + d.totalAmount, 0);

  return (
    <div className="space-y-6">
      <AdminFinanceClient
        debts={debtCards}
        totalOutstanding={totalOutstanding}
      />
    </div>
  );
}
```

- [ ] **Step 2: Update finance-client.tsx**

1. Remove `memberPhones` from interface (line 22) and function params (line 45).
2. Remove `phone` from `MemberGroup` interface (line 38).
3. Remove `phone: memberPhones[d.memberId] ?? ""` from memberMap construction (line 66).
4. Update search filter (line 89): Remove phone search:
```typescript
memberGroups = memberGroups.filter(
  (g) => g.memberName.toLowerCase().includes(q)
);
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(admin)/admin/finance/page.tsx src/app/(admin)/admin/finance/finance-client.tsx
git commit -m "feat: remove phone from admin finance"
```

---

### Task 12: Update Admin Vote Manager

**Files:**
- Modify: `src/components/sessions/admin-vote-manager.tsx:179`

- [ ] **Step 1: Remove phone from search filter**

Line 179, change:
```typescript
return list.filter((m) => m.name.toLowerCase().includes(lower) || m.phone.includes(q));
```
to:
```typescript
return list.filter((m) => m.name.toLowerCase().includes(lower));
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sessions/admin-vote-manager.tsx
git commit -m "feat: remove phone from admin vote manager search"
```

---

### Task 13: Update i18n Messages

**Files:**
- Modify: `src/i18n/messages/vi.json`
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/zh.json`

- [ ] **Step 1: Update vi.json**

1. Remove the entire `"identify"` block (lines 262-270).
2. Add `"fbLogin"` block:
```json
"fbLogin": {
  "checkingLogin": "Đang kiểm tra đăng nhập...",
  "signInPrompt": "Đăng nhập bằng Facebook để tiếp tục",
  "continueWithFacebook": "Tiếp tục với Facebook",
  "loggingIn": "Đang đăng nhập...",
  "loginCancelled": "Đã hủy đăng nhập",
  "sdkLoadError": "Không thể tải Facebook SDK. Vui lòng thử lại.",
  "genericError": "Đã có lỗi xảy ra. Vui lòng thử lại.",
  "retry": "Thử lại"
}
```
3. In `"me"` block: remove `"phoneLabel"`, `"phoneTaken"` keys.
4. In `"adminMembers"` block: remove `"phone"` key. Update `"searchPlaceholder"` to remove phone reference.

- [ ] **Step 2: Update en.json**

Same changes:
1. Remove `"identify"` block.
2. Add `"fbLogin"` block:
```json
"fbLogin": {
  "checkingLogin": "Checking login status...",
  "signInPrompt": "Sign in with Facebook to continue",
  "continueWithFacebook": "Continue with Facebook",
  "loggingIn": "Signing in...",
  "loginCancelled": "Login cancelled",
  "sdkLoadError": "Could not load Facebook SDK. Please try again.",
  "genericError": "Something went wrong. Please try again.",
  "retry": "Retry"
}
```
3. In `"me"`: remove `"phoneLabel"`, `"phoneTaken"`.
4. In `"adminMembers"`: remove `"phone"`, update `"searchPlaceholder"` to `"Search name..."`.

- [ ] **Step 3: Update zh.json**

Same pattern, Chinese translations:
```json
"fbLogin": {
  "checkingLogin": "正在检查登录状态...",
  "signInPrompt": "使用 Facebook 登录以继续",
  "continueWithFacebook": "使用 Facebook 继续",
  "loggingIn": "正在登录...",
  "loginCancelled": "已取消登录",
  "sdkLoadError": "无法加载 Facebook SDK，请重试。",
  "genericError": "出了点问题，请重试。",
  "retry": "重试"
}
```

- [ ] **Step 4: Commit**

```bash
git add src/i18n/messages/vi.json src/i18n/messages/en.json src/i18n/messages/zh.json
git commit -m "feat: update i18n — remove identify/phone keys, add fbLogin keys"
```

---

### Task 14: Add Environment Variables

- [ ] **Step 1: Add FB App ID to .env.local**

Add to `.env.local`:
```
NEXT_PUBLIC_FB_APP_ID=<your-facebook-app-id>
```

- [ ] **Step 2: Update .env.example if it exists**

Add the same key (without value) to `.env.example`:
```
NEXT_PUBLIC_FB_APP_ID=
```

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`

Fix any TypeScript errors from the phone removal. Common issues:
- Any remaining `member.phone` references
- Any remaining imports of `identifyUser`, `myProfilePhoneSchema`, `identifySchema`

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "feat: add FB env vars to .env.example"
```

---

## Phase 2: Messenger Notifications

### Task 15: Create Messenger Helper

**Files:**
- Create: `src/lib/messenger.ts`

- [ ] **Step 1: Create messenger.ts**

```typescript
const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const GROUP_THREAD_ID = process.env.FB_MESSENGER_GROUP_THREAD_ID;

export async function sendGroupNotification(message: string): Promise<{ success: boolean; error?: string }> {
  if (!PAGE_ACCESS_TOKEN || !GROUP_THREAD_ID) {
    console.warn("[Messenger] Missing PAGE_ACCESS_TOKEN or GROUP_THREAD_ID — skipping notification");
    return { success: false, error: "Not configured" };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { thread_key: GROUP_THREAD_ID },
          message: { text: message },
          messaging_type: "MESSAGE_TAG",
          tag: "CONFIRMED_EVENT_UPDATE",
        }),
      },
    );

    const data = await res.json();

    if (data.error) {
      console.error("[Messenger] API error:", data.error.message);
      return { success: false, error: data.error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("[Messenger] Network error:", err);
    return { success: false, error: "Network error" };
  }
}
```

Note: The `recipient.thread_key` approach may not work — this is the Phase 2 spike area. The helper is structured so only this one function needs to change when the correct API approach is determined.

- [ ] **Step 2: Commit**

```bash
git add src/lib/messenger.ts
git commit -m "feat: add Messenger notification helper"
```

---

### Task 16: Add Notification Triggers

**Files:**
- Modify: `src/actions/sessions.ts:193-221` (createSessionManually)
- Modify: `src/actions/sessions.ts:141-161` (confirmSession)
- Modify: `src/actions/finance.ts:29-end` (finalizeSession)

- [ ] **Step 1: Add import to sessions.ts**

Add at top of `src/actions/sessions.ts`:
```typescript
import { sendGroupNotification } from "@/lib/messenger";
```

- [ ] **Step 2: Add notification to createSessionManually**

After `revalidatePath("/");` (line 220), before `return { success: true }`, add:

```typescript
// Non-blocking notification
const court = courtId
  ? await db.query.courts.findFirst({ where: eq(courts.id, courtId) })
  : null;
const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://fwbb.app";
sendGroupNotification(
  `📋 Session mới ngày ${date}${court ? ` tại ${court.name}` : ""}! Vào vote: ${baseUrl}`,
).catch(() => {});
```

- [ ] **Step 3: Add notification to confirmSession**

After the status update (line 156), before `revalidatePath`, add:

```typescript
// Non-blocking notification
const voteCount = await db.query.votes.findMany({
  where: eq(votes.sessionId, sessionId),
});
const playCount = voteCount.filter((v) => v.willPlay).length;
const dineCount = voteCount.filter((v) => v.willDine).length;
sendGroupNotification(
  `✅ Session ${session.date} confirmed! ${playCount} người chơi, ${dineCount} người ăn`,
).catch(() => {});
```

- [ ] **Step 4: Add import to finance.ts**

Add at top of `src/actions/finance.ts`:
```typescript
import { sendGroupNotification } from "@/lib/messenger";
```

- [ ] **Step 5: Add notification to finalizeSession**

At the end of `finalizeSession`, before the final `return { success: true }`, add:

```typescript
// Non-blocking debt notification
const totalCost = breakdown.memberDebts.reduce((s, d) => s + d.totalAmount, 0);
const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://fwbb.app";
sendGroupNotification(
  `💰 Session ${session.date} đã kết thúc. Tổng chi ${Math.round(totalCost / 1000)}k. Xem nợ: ${baseUrl}/my-debts`,
).catch(() => {});
```

- [ ] **Step 6: Add env vars**

Add to `.env.local`:
```
FB_PAGE_ACCESS_TOKEN=<your-page-access-token>
FB_MESSENGER_GROUP_THREAD_ID=<your-group-thread-id>
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

Add to `.env.example`:
```
FB_PAGE_ACCESS_TOKEN=
FB_MESSENGER_GROUP_THREAD_ID=
NEXT_PUBLIC_APP_URL=
```

- [ ] **Step 7: Commit**

```bash
git add src/actions/sessions.ts src/actions/finance.ts src/lib/messenger.ts .env.example
git commit -m "feat: add Messenger notification triggers on session create/confirm/finalize"
```

---

### Task 17: Final Build Verification

- [ ] **Step 1: Run build**

```bash
npm run build
```

Fix any TypeScript errors. Common remaining issues:
- `member.phone` referenced somewhere not yet updated
- Missing imports for deleted files
- Type mismatches from cookie return type change (`phone` → `facebookId`)

- [ ] **Step 2: Grep for remaining phone references**

```bash
grep -rn "\.phone" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".json"
```

Any remaining `member.phone` or `user.phone` references need to be updated or removed.

- [ ] **Step 3: Test on dev server**

```bash
npm run dev
```

1. Open app → should see Facebook Login gate (not identify-gate)
2. Note: FB Login will only work with a real FB App ID configured

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve remaining phone references and build errors"
```
