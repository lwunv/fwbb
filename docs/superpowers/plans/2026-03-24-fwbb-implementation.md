# FWBB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first badminton club management app with session scheduling, voting, cost splitting, inventory tracking, and financial management.

**Architecture:** Next.js 14+ App Router with Server Actions for all mutations. Drizzle ORM connects to Turso (libSQL/SQLite) for persistence. Public pages (no auth) for member voting/debt viewing, admin pages protected by JWT middleware. Three themes (Light/Dark/Pink) via next-themes, three languages (VI/EN/ZH) via next-intl.

**Tech Stack:** Next.js 14+, TypeScript, Tailwind CSS v4, shadcn/ui, Drizzle ORM, Turso (libSQL), jose (JWT), Recharts, React Hook Form, Zod, next-themes, next-intl, date-fns, nuqs

**Spec:** `docs/superpowers/specs/2026-03-24-fwbb-design.md`

---

## File Structure

```
fwbb/
├── src/
│   ├── app/
│   │   ├── layout.tsx                          # Root layout: ThemeProvider + NextIntlProvider
│   │   ├── globals.css                         # Tailwind imports + theme CSS vars
│   │   ├── (public)/
│   │   │   ├── layout.tsx                      # Public layout: Header + BottomNav
│   │   │   ├── page.tsx                        # Home: next session + vote
│   │   │   ├── vote/[id]/page.tsx              # Vote for specific session
│   │   │   ├── history/page.tsx                # Past sessions
│   │   │   ├── my-debts/page.tsx               # Personal debts
│   │   │   └── me/page.tsx                     # Profile + settings
│   │   ├── (admin)/admin/
│   │   │   ├── layout.tsx                      # Admin layout: Sidebar + auth check
│   │   │   ├── login/page.tsx                  # Admin login
│   │   │   ├── dashboard/page.tsx              # Admin dashboard
│   │   │   ├── sessions/page.tsx               # Session list
│   │   │   ├── sessions/[id]/page.tsx          # Session detail + finalize
│   │   │   ├── members/page.tsx                # Member CRUD
│   │   │   ├── courts/page.tsx                 # Court CRUD
│   │   │   ├── shuttlecocks/page.tsx           # Brand CRUD
│   │   │   ├── inventory/page.tsx              # Inventory management
│   │   │   ├── finance/page.tsx                # Debt + payment management
│   │   │   └── stats/page.tsx                  # Statistics + charts
│   │   └── api/cron/create-session/route.ts    # Cron: auto-create sessions
│   ├── actions/
│   │   ├── auth.ts                             # login, logout, verifyAdmin
│   │   ├── members.ts                          # CRUD members
│   │   ├── courts.ts                           # CRUD courts
│   │   ├── shuttlecocks.ts                     # CRUD brands
│   │   ├── sessions.ts                         # CRUD sessions, status transitions
│   │   ├── votes.ts                            # Submit/update votes
│   │   ├── inventory.ts                        # Record purchases, usage
│   │   ├── finance.ts                          # Calculate costs, manage debts
│   │   └── stats.ts                            # Statistics queries
│   ├── db/
│   │   ├── index.ts                            # Drizzle client (Turso)
│   │   ├── schema.ts                           # All table definitions
│   │   ├── seed.ts                             # Seed admin account
│   │   └── migrations/                         # Auto-generated migrations
│   ├── components/
│   │   ├── ui/                                 # shadcn/ui components (auto-installed)
│   │   ├── layout/
│   │   │   ├── header.tsx                      # Public header
│   │   │   ├── bottom-nav.tsx                  # Mobile bottom nav
│   │   │   ├── admin-sidebar.tsx               # Admin sidebar nav
│   │   │   └── admin-mobile-nav.tsx            # Admin mobile hamburger
│   │   ├── sessions/
│   │   │   ├── session-card.tsx                # Session summary card
│   │   │   ├── vote-buttons.tsx                # Vote toggle buttons
│   │   │   ├── vote-list.tsx                   # Who voted what
│   │   │   ├── guest-form.tsx                  # Add guest form
│   │   │   ├── court-selector.tsx              # Court dropdown
│   │   │   ├── shuttlecock-selector.tsx        # Multi-brand selector
│   │   │   └── finalize-session.tsx            # Session finalization flow
│   │   ├── finance/
│   │   │   ├── debt-card.tsx                   # Single debt display
│   │   │   ├── debt-list.tsx                   # Debt list with filters
│   │   │   ├── cost-breakdown.tsx              # Cost calculation preview
│   │   │   └── payment-actions.tsx             # Confirm payment buttons
│   │   ├── inventory/
│   │   │   ├── stock-card.tsx                  # Stock per brand
│   │   │   ├── purchase-form.tsx               # Record purchase
│   │   │   └── purchase-history.tsx            # Purchase list
│   │   ├── stats/
│   │   │   ├── active-members-chart.tsx        # Bar chart
│   │   │   ├── monthly-expenses-chart.tsx      # Stacked bar
│   │   │   └── attendance-chart.tsx            # Line chart
│   │   └── shared/
│   │       ├── time-filter.tsx                 # Week/month/year/all filter tabs
│   │       ├── copy-link-button.tsx            # Copy session URL
│   │       ├── theme-toggle.tsx                # Sun/moon/heart toggle
│   │       └── language-selector.tsx           # VI/EN/ZH picker
│   ├── lib/
│   │   ├── auth.ts                             # JWT sign/verify, cookie helpers
│   │   ├── user-identity.ts                    # User cookie HMAC sign/verify
│   │   ├── cost-calculator.ts                  # Cost splitting logic
│   │   ├── utils.ts                            # cn(), formatVND(), etc.
│   │   └── validators.ts                       # Zod schemas for all forms
│   ├── i18n/
│   │   ├── config.ts                           # next-intl setup
│   │   ├── request.ts                          # getRequestConfig
│   │   └── messages/
│   │       ├── vi.json
│   │       ├── en.json
│   │       └── zh.json
│   ├── hooks/
│   │   └── use-user.ts                         # Read user identity from cookie
│   ├── types/
│   │   └── index.ts                            # Shared TypeScript types
│   └── middleware.ts                            # Admin auth + i18n middleware
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── vercel.json
├── .env.example
├── .env.local
├── package.json
└── tsconfig.json
```

---

## Phase 1: Project Setup + Database + Auth

### Task 1: Initialize Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`
- Create: `.env.example`, `.env.local`, `.gitignore`
- Create: `vercel.json`

- [ ] **Step 1: Create Next.js app with pnpm**

```bash
cd d:/Lwcifer/LW/FWBB
pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --turbopack
```

Select: Yes to all defaults. This creates the scaffolding.

- [ ] **Step 2: Install all dependencies**

```bash
pnpm add drizzle-orm @libsql/client jose bcryptjs date-fns recharts react-hook-form @hookform/resolvers zod next-themes next-intl nuqs
pnpm add -D drizzle-kit @types/bcryptjs
```

- [ ] **Step 3: Install shadcn/ui**

```bash
pnpm dlx shadcn@latest init -d
pnpm dlx shadcn@latest add button card input label select dialog dropdown-menu tabs badge separator toast sheet checkbox form table avatar popover command
```

- [ ] **Step 4: Create .env.example and .env.local**

`.env.example`:
```
TURSO_DATABASE_URL=file:local.db
TURSO_AUTH_TOKEN=
JWT_SECRET=change-me-to-random-32-byte-hex
USER_COOKIE_SECRET=change-me-to-random-32-byte-hex
CRON_SECRET=change-me
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

`.env.local` (fill in your real credentials):
```
TURSO_DATABASE_URL=<your-turso-url>
TURSO_AUTH_TOKEN=<your-turso-token>
JWT_SECRET=<generate-random-32-byte-hex>
USER_COOKIE_SECRET=<generate-random-32-byte-hex>
CRON_SECRET=<generate-random-string>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

Note: Get Turso credentials from `turso db show fwbb --url` and `turso db tokens create fwbb`. Generate secrets with `openssl rand -hex 32`.

- [ ] **Step 5: Create vercel.json**

```json
{
  "crons": [
    {
      "path": "/api/cron/create-session",
      "schedule": "0 17 * * *"
    }
  ]
}
```

- [ ] **Step 6: Update .gitignore**

Add to `.gitignore`:
```
.env.local
local.db
local.db-journal
```

- [ ] **Step 7: Verify dev server starts**

```bash
pnpm dev
```

Expected: Server starts at localhost:3000

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: initialize Next.js project with all dependencies"
```

---

### Task 2: Database schema + Drizzle setup

**Files:**
- Create: `src/db/index.ts`
- Create: `src/db/schema.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Create Drizzle config**

`drizzle.config.ts`:
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
```

- [ ] **Step 2: Create database client**

`src/db/index.ts`:
```typescript
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
```

- [ ] **Step 3: Create full database schema**

`src/db/schema.ts`:
```typescript
import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const admins = sqliteTable("admins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
});

export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
});

export const courts = sqliteTable("courts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  address: text("address"),
  pricePerSession: integer("price_per_session").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
});

export const shuttlecockBrands = sqliteTable("shuttlecock_brands", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  pricePerTube: integer("price_per_tube").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  startTime: text("start_time").default("20:30"),
  endTime: text("end_time").default("22:30"),
  courtId: integer("court_id").references(() => courts.id),
  courtPrice: integer("court_price"),
  status: text("status", { enum: ["voting", "confirmed", "completed", "cancelled"] }).default("voting"),
  diningBill: integer("dining_bill"),
  notes: text("notes"),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").default(sql`(current_timestamp)`),
}, (table) => [
  index("idx_sessions_date").on(table.date),
]);

export const votes = sqliteTable("votes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull().references(() => sessions.id),
  memberId: integer("member_id").notNull().references(() => members.id),
  willPlay: integer("will_play", { mode: "boolean" }).default(false),
  willDine: integer("will_dine", { mode: "boolean" }).default(false),
  guestPlayCount: integer("guest_play_count").default(0),
  guestDineCount: integer("guest_dine_count").default(0),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").default(sql`(current_timestamp)`),
}, (table) => [
  uniqueIndex("votes_session_member_idx").on(table.sessionId, table.memberId),
]);

export const sessionAttendees = sqliteTable("session_attendees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull().references(() => sessions.id),
  memberId: integer("member_id").references(() => members.id),
  guestName: text("guest_name"),
  invitedById: integer("invited_by_id").references(() => members.id),
  isGuest: integer("is_guest", { mode: "boolean" }).default(false),
  attendsPlay: integer("attends_play", { mode: "boolean" }).default(false),
  attendsDine: integer("attends_dine", { mode: "boolean" }).default(false),
});

export const sessionShuttlecocks = sqliteTable("session_shuttlecocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull().references(() => sessions.id),
  brandId: integer("brand_id").notNull().references(() => shuttlecockBrands.id),
  quantityUsed: integer("quantity_used").notNull(),
  pricePerTube: integer("price_per_tube").notNull(),
});

export const inventoryPurchases = sqliteTable("inventory_purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brandId: integer("brand_id").notNull().references(() => shuttlecockBrands.id),
  tubes: integer("tubes").notNull(),
  pricePerTube: integer("price_per_tube").notNull(),
  totalPrice: integer("total_price").notNull(),
  purchasedAt: text("purchased_at").notNull(),
  notes: text("notes"),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
});

export const sessionDebts = sqliteTable("session_debts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull().references(() => sessions.id),
  memberId: integer("member_id").notNull().references(() => members.id),
  playAmount: integer("play_amount").default(0),
  dineAmount: integer("dine_amount").default(0),
  guestPlayAmount: integer("guest_play_amount").default(0),
  guestDineAmount: integer("guest_dine_amount").default(0),
  totalAmount: integer("total_amount").notNull(),
  memberConfirmed: integer("member_confirmed", { mode: "boolean" }).default(false),
  memberConfirmedAt: text("member_confirmed_at"),
  adminConfirmed: integer("admin_confirmed", { mode: "boolean" }).default(false),
  adminConfirmedAt: text("admin_confirmed_at"),
  updatedAt: text("updated_at").default(sql`(current_timestamp)`),
}, (table) => [
  uniqueIndex("debts_session_member_idx").on(table.sessionId, table.memberId),
]);
```

- [ ] **Step 4: Generate and run migration**

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit push
```

- [ ] **Step 5: Create seed script**

`src/db/seed.ts`:
```typescript
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import bcrypt from "bcryptjs";
import * as schema from "./schema";

async function seed() {
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const db = drizzle(client, { schema });

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const hash = await bcrypt.hash(password, 12);

  await db.insert(schema.admins).values({
    username,
    passwordHash: hash,
  }).onConflictDoNothing();

  console.log(`Admin seeded: ${username}`);
  process.exit(0);
}

seed().catch(console.error);
```

Add to `package.json` scripts:
```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push",
    "db:seed": "tsx src/db/seed.ts",
    "db:studio": "drizzle-kit studio"
  }
}
```

- [ ] **Step 6: Install tsx and run seed**

```bash
pnpm add -D tsx
pnpm db:seed
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add database schema with Drizzle + Turso + seed script"
```

---

### Task 3: Auth library + Admin middleware

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/lib/user-identity.ts`
- Create: `src/middleware.ts`
- Create: `src/lib/validators.ts`
- Create: `src/lib/utils.ts`

- [ ] **Step 1: Create utility functions**

`src/lib/utils.ts`:
```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatVND(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function roundToThousand(amount: number): number {
  return Math.round(amount / 1000) * 1000;
}
```

Note: shadcn init may have already created `src/lib/utils.ts` with just `cn`. If so, add `formatVND` and `roundToThousand` to it.

- [ ] **Step 2: Create JWT auth helpers**

`src/lib/auth.ts`:
```typescript
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const ADMIN_COOKIE = "fwbb-admin-token";

export async function signAdminToken(adminId: number): Promise<string> {
  return new SignJWT({ sub: String(adminId), role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

export async function verifyAdminToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function setAdminCookie(adminId: number) {
  const token = await signAdminToken(adminId);
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
}

export async function getAdminFromCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  return verifyAdminToken(token);
}

export async function clearAdminCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
}
```

- [ ] **Step 3: Create user identity helpers**

`src/lib/user-identity.ts`:
```typescript
import { cookies } from "next/headers";
import { createHmac } from "crypto";

const USER_COOKIE = "fwbb-user";
const SECRET = process.env.USER_COOKIE_SECRET || "fallback-secret";

function sign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("hex");
}

export function createUserCookieValue(memberId: number, phone: string): string {
  const data = `${memberId}:${phone}`;
  const signature = sign(data);
  return `${data}:${signature}`;
}

export function parseUserCookie(value: string): { memberId: number; phone: string } | null {
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const [memberIdStr, phone, signature] = parts;
  const data = `${memberIdStr}:${phone}`;
  if (sign(data) !== signature) return null;
  return { memberId: parseInt(memberIdStr, 10), phone };
}

export async function setUserCookie(memberId: number, phone: string) {
  const cookieStore = await cookies();
  cookieStore.set(USER_COOKIE, createUserCookieValue(memberId, phone), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 365 days
    path: "/",
  });
}

export async function getUserFromCookie(): Promise<{ memberId: number; phone: string } | null> {
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

- [ ] **Step 4: Create Zod validators**

`src/lib/validators.ts`:
```typescript
import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, "Bat buoc"),
  password: z.string().min(1, "Bat buoc"),
});

export const memberSchema = z.object({
  name: z.string().min(1, "Ten khong duoc de trong"),
  phone: z.string().min(10, "So dien thoai khong hop le").max(11),
});

export const courtSchema = z.object({
  name: z.string().min(1, "Ten san khong duoc de trong"),
  address: z.string().optional(),
  pricePerSession: z.number().min(0, "Gia khong hop le"),
});

export const brandSchema = z.object({
  name: z.string().min(1, "Ten hang khong duoc de trong"),
  pricePerTube: z.number().min(0, "Gia khong hop le"),
});

export const voteSchema = z.object({
  sessionId: z.number(),
  willPlay: z.boolean(),
  willDine: z.boolean(),
  guestPlayCount: z.number().min(0).default(0),
  guestDineCount: z.number().min(0).default(0),
});

export const purchaseSchema = z.object({
  brandId: z.number(),
  tubes: z.number().min(1),
  pricePerTube: z.number().min(0),
  purchasedAt: z.string(),
  notes: z.string().optional(),
});

export const identifySchema = z.object({
  memberId: z.number(),
  phone: z.string().min(10).max(11),
});
```

- [ ] **Step 5: Create middleware**

`src/middleware.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect all /admin routes except /admin/login
  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
    const token = request.cookies.get("fwbb-admin-token")?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    try {
      await jwtVerify(token, JWT_SECRET);
    } catch {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add auth, user identity, validators, and admin middleware"
```

---

### Task 4: Auth Server Actions + Login page

**Files:**
- Create: `src/actions/auth.ts`
- Create: `src/app/(admin)/admin/login/page.tsx`

- [ ] **Step 1: Create auth server actions**

`src/actions/auth.ts`:
```typescript
"use server";

import { db } from "@/db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { setAdminCookie, clearAdminCookie } from "@/lib/auth";
import { redirect } from "next/navigation";
import { loginSchema } from "@/lib/validators";

export async function login(formData: FormData) {
  const raw = {
    username: formData.get("username") as string,
    password: formData.get("password") as string,
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Vui long nhap day du thong tin" };
  }

  const admin = await db.query.admins.findFirst({
    where: eq(admins.username, parsed.data.username),
  });

  if (!admin || !(await bcrypt.compare(parsed.data.password, admin.passwordHash))) {
    return { error: "Sai ten dang nhap hoac mat khau" };
  }

  await setAdminCookie(admin.id);
  redirect("/admin/dashboard");
}

export async function logout() {
  await clearAdminCookie();
  redirect("/admin/login");
}
```

- [ ] **Step 2: Create admin login page**

`src/app/(admin)/admin/login/page.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { login } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center text-2xl">FWBB Admin</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Ten dang nhap</Label>
              <Input id="username" name="username" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mat khau</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            {state?.error && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Dang nhap..." : "Dang nhap"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Verify login works**

```bash
pnpm dev
```

Navigate to `localhost:3000/admin/login`, login with admin/admin123.
Expected: Redirects to `/admin/dashboard` (404 is fine, it means auth worked).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add admin login page + auth server actions"
```

---

## Phase 2: Admin CRUD Pages

### Task 5: Admin layout (Sidebar + Mobile nav)

**Files:**
- Create: `src/app/(admin)/admin/layout.tsx`
- Create: `src/components/layout/admin-sidebar.tsx`
- Create: `src/components/layout/admin-mobile-nav.tsx`
- Create: `src/app/(admin)/admin/dashboard/page.tsx` (placeholder)

- [ ] **Step 1: Create admin sidebar**

`src/components/layout/admin-sidebar.tsx`:
```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Calendar,
  Users,
  MapPin,
  CircleDot,
  Package,
  DollarSign,
  BarChart3,
  LogOut,
} from "lucide-react";
import { logout } from "@/actions/auth";

const navItems = [
  { href: "/admin/dashboard", label: "Tong quan", icon: LayoutDashboard },
  { href: "/admin/sessions", label: "Buoi choi", icon: Calendar },
  { href: "/admin/members", label: "Thanh vien", icon: Users },
  { href: "/admin/courts", label: "San", icon: MapPin },
  { href: "/admin/shuttlecocks", label: "Hang cau", icon: CircleDot },
  { href: "/admin/inventory", label: "Ton kho", icon: Package },
  { href: "/admin/finance", label: "Tai chinh", icon: DollarSign },
  { href: "/admin/stats", label: "Thong ke", icon: BarChart3 },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex lg:w-60 lg:flex-col lg:fixed lg:inset-y-0 border-r bg-card">
      <div className="p-6">
        <h1 className="text-xl font-bold">FWBB Admin</h1>
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              pathname.startsWith(item.href)
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="p-3 border-t">
        <form action={logout}>
          <button
            type="submit"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium w-full hover:bg-accent transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Dang xuat
          </button>
        </form>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Create admin mobile nav**

`src/components/layout/admin-mobile-nav.tsx`:
```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Menu, X, LayoutDashboard, Calendar, Users, MapPin, CircleDot, Package, DollarSign, BarChart3, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { logout } from "@/actions/auth";

const navItems = [
  { href: "/admin/dashboard", label: "Tong quan", icon: LayoutDashboard },
  { href: "/admin/sessions", label: "Buoi choi", icon: Calendar },
  { href: "/admin/members", label: "Thanh vien", icon: Users },
  { href: "/admin/courts", label: "San", icon: MapPin },
  { href: "/admin/shuttlecocks", label: "Hang cau", icon: CircleDot },
  { href: "/admin/inventory", label: "Ton kho", icon: Package },
  { href: "/admin/finance", label: "Tai chinh", icon: DollarSign },
  { href: "/admin/stats", label: "Thong ke", icon: BarChart3 },
];

export function AdminMobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden flex items-center justify-between p-4 border-b bg-card">
      <h1 className="text-lg font-bold">FWBB Admin</h1>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <div className="p-6 border-b">
            <h2 className="text-lg font-bold">FWBB Admin</h2>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  pathname.startsWith(item.href)
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="p-3 border-t">
            <form action={logout}>
              <button type="submit" className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium w-full hover:bg-accent">
                <LogOut className="h-4 w-4" />
                Dang xuat
              </button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

- [ ] **Step 3: Create admin layout**

`src/app/(admin)/admin/layout.tsx`:
```tsx
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminMobileNav } from "@/components/layout/admin-mobile-nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <AdminSidebar />
      <AdminMobileNav />
      <main className="lg:ml-60 p-4 md:p-6">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Create dashboard placeholder**

`src/app/(admin)/admin/dashboard/page.tsx`:
```tsx
export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Tong quan</h1>
      <p className="text-muted-foreground">Dashboard dang duoc xay dung...</p>
    </div>
  );
}
```

- [ ] **Step 5: Verify layout works**

Login → should see sidebar on desktop, hamburger on mobile.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add admin layout with sidebar and mobile nav"
```

---

### Task 6: Member management

**Files:**
- Create: `src/actions/members.ts`
- Create: `src/app/(admin)/admin/members/page.tsx`

- [ ] **Step 1: Create member server actions**

`src/actions/members.ts`:
```typescript
"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { memberSchema } from "@/lib/validators";

export async function getMembers() {
  return db.query.members.findMany({
    orderBy: (m, { asc }) => [asc(m.name)],
  });
}

export async function getActiveMembers() {
  return db.query.members.findMany({
    where: eq(members.isActive, true),
    orderBy: (m, { asc }) => [asc(m.name)],
  });
}

export async function createMember(formData: FormData) {
  const raw = {
    name: formData.get("name") as string,
    phone: formData.get("phone") as string,
  };
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message };
  }
  await db.insert(members).values(parsed.data);
  revalidatePath("/admin/members");
  return { success: true };
}

export async function updateMember(id: number, formData: FormData) {
  const raw = {
    name: formData.get("name") as string,
    phone: formData.get("phone") as string,
  };
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message };
  }
  await db.update(members).set(parsed.data).where(eq(members.id, id));
  revalidatePath("/admin/members");
  return { success: true };
}

export async function toggleMemberActive(id: number) {
  const member = await db.query.members.findFirst({ where: eq(members.id, id) });
  if (!member) return { error: "Khong tim thay thanh vien" };
  await db.update(members).set({ isActive: !member.isActive }).where(eq(members.id, id));
  revalidatePath("/admin/members");
  return { success: true };
}
```

- [ ] **Step 2: Create members page**

`src/app/(admin)/admin/members/page.tsx`:
```tsx
import { getMembers } from "@/actions/members";
import { MemberList } from "./member-list";

export default async function MembersPage() {
  const members = await getMembers();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Quan ly thanh vien</h1>
      <MemberList members={members} />
    </div>
  );
}
```

- [ ] **Step 3: Create member list client component**

`src/app/(admin)/admin/members/member-list.tsx`:
```tsx
"use client";

import { useState } from "react";
import { createMember, updateMember, toggleMemberActive } from "@/actions/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Edit, UserX, UserCheck } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type { members as membersTable } from "@/db/schema";

type Member = InferSelectModel<typeof membersTable>;

export function MemberList({ members }: { members: Member[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);

  async function handleSubmit(formData: FormData) {
    if (editingMember) {
      await updateMember(editingMember.id, formData);
    } else {
      await createMember(formData);
    }
    setDialogOpen(false);
    setEditingMember(null);
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-muted-foreground">{members.length} thanh vien</p>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingMember(null); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Them thanh vien</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingMember ? "Sua thanh vien" : "Them thanh vien moi"}</DialogTitle>
            </DialogHeader>
            <form action={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Ten</Label>
                <Input id="name" name="name" defaultValue={editingMember?.name ?? ""} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">So dien thoai</Label>
                <Input id="phone" name="phone" defaultValue={editingMember?.phone ?? ""} required />
              </div>
              <Button type="submit" className="w-full">
                {editingMember ? "Cap nhat" : "Them"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {members.map((member) => (
          <Card key={member.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{member.name}</p>
                <p className="text-sm text-muted-foreground">{member.phone}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={member.isActive ? "default" : "secondary"}>
                  {member.isActive ? "Hoat dong" : "Ngung"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { setEditingMember(member); setDialogOpen(true); }}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <form action={() => toggleMemberActive(member.id)}>
                  <Button variant="ghost" size="icon" type="submit">
                    {member.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify member CRUD works**

Navigate to `/admin/members`, add a member, edit, toggle active.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add member management (CRUD + toggle active)"
```

---

### Task 7: Court management

**Files:**
- Create: `src/actions/courts.ts`
- Create: `src/app/(admin)/admin/courts/page.tsx`
- Create: `src/app/(admin)/admin/courts/court-list.tsx`

- [ ] **Step 1: Create court server actions**

`src/actions/courts.ts`:
```typescript
"use server";

import { db } from "@/db";
import { courts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { courtSchema } from "@/lib/validators";

export async function getCourts() {
  return db.query.courts.findMany({ orderBy: (c, { asc }) => [asc(c.name)] });
}

export async function getActiveCourts() {
  return db.query.courts.findMany({
    where: eq(courts.isActive, true),
    orderBy: (c, { asc }) => [asc(c.name)],
  });
}

export async function createCourt(formData: FormData) {
  const parsed = courtSchema.safeParse({
    name: formData.get("name") as string,
    address: (formData.get("address") as string) || undefined,
    pricePerSession: Number(formData.get("pricePerSession")),
  });
  if (!parsed.success) return { error: parsed.error.errors[0].message };
  await db.insert(courts).values(parsed.data);
  revalidatePath("/admin/courts");
  return { success: true };
}

export async function updateCourt(id: number, formData: FormData) {
  const parsed = courtSchema.safeParse({
    name: formData.get("name") as string,
    address: (formData.get("address") as string) || undefined,
    pricePerSession: Number(formData.get("pricePerSession")),
  });
  if (!parsed.success) return { error: parsed.error.errors[0].message };
  await db.update(courts).set(parsed.data).where(eq(courts.id, id));
  revalidatePath("/admin/courts");
  return { success: true };
}

export async function toggleCourtActive(id: number) {
  const court = await db.query.courts.findFirst({ where: eq(courts.id, id) });
  if (!court) return { error: "Khong tim thay san" };
  await db.update(courts).set({ isActive: !court.isActive }).where(eq(courts.id, id));
  revalidatePath("/admin/courts");
  return { success: true };
}
```

- [ ] **Step 2: Create court page + list component**

Same pattern as members page. `src/app/(admin)/admin/courts/page.tsx` (server) + `src/app/(admin)/admin/courts/court-list.tsx` (client). Fields: name, address, pricePerSession. Display price with `formatVND()`.

- [ ] **Step 3: Verify and commit**

```bash
git add -A
git commit -m "feat: add court management (CRUD + toggle active)"
```

---

### Task 8: Shuttlecock brand management

**Files:**
- Create: `src/actions/shuttlecocks.ts`
- Create: `src/app/(admin)/admin/shuttlecocks/page.tsx`
- Create: `src/app/(admin)/admin/shuttlecocks/brand-list.tsx`

- [ ] **Step 1: Create shuttlecock server actions**

`src/actions/shuttlecocks.ts` — same CRUD pattern as courts. Fields: name, pricePerTube.

- [ ] **Step 2: Create page + list component**

Same pattern. Display pricePerTube with `formatVND()`.

- [ ] **Step 3: Verify and commit**

```bash
git add -A
git commit -m "feat: add shuttlecock brand management (CRUD + toggle active)"
```

---

## Phase 3: Sessions + Voting

### Task 9: Session CRUD + Cron job

**Files:**
- Create: `src/actions/sessions.ts`
- Create: `src/app/api/cron/create-session/route.ts`
- Create: `src/app/(admin)/admin/sessions/page.tsx`

- [ ] **Step 1: Create session server actions**

`src/actions/sessions.ts`:
```typescript
"use server";

import { db } from "@/db";
import { sessions, courts } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getSessions() {
  return db.query.sessions.findMany({
    orderBy: [desc(sessions.date)],
    with: { court: true },
  });
  // Note: need to add relations in schema for this to work
}

export async function getSession(id: number) {
  return db.query.sessions.findFirst({
    where: eq(sessions.id, id),
  });
}

export async function selectCourt(sessionId: number, courtId: number) {
  const court = await db.query.courts.findFirst({ where: eq(courts.id, courtId) });
  if (!court) return { error: "San khong ton tai" };

  await db.update(sessions).set({
    courtId,
    courtPrice: court.pricePerSession,
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, sessionId));

  revalidatePath("/admin/sessions");
  return { success: true };
}

export async function confirmSession(sessionId: number) {
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
  if (!session) return { error: "Khong tim thay buoi choi" };
  if (session.status !== "voting") return { error: "Buoi choi khong o trang thai voting" };
  if (!session.courtId) return { error: "Chua chon san" };

  // Check shuttlecocks are configured
  const shuttlecocks = await db.query.sessionShuttlecocks.findMany({
    where: eq(sessionShuttlecocks.sessionId, sessionId),
  });
  if (shuttlecocks.length === 0) return { error: "Chua chon cau" };

  await db.update(sessions).set({
    status: "confirmed",
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, sessionId));

  revalidatePath("/admin/sessions");
  return { success: true };
}

export async function cancelSession(sessionId: number) {
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
  if (!session) return { error: "Khong tim thay buoi choi" };
  if (session.status === "completed") return { error: "Khong the huy buoi da hoan thanh" };

  await db.update(sessions).set({
    status: "cancelled",
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, sessionId));

  revalidatePath("/admin/sessions");
  return { success: true };
}

export async function createSessionManually(date: string) {
  await db.insert(sessions).values({ date, status: "voting" });
  revalidatePath("/admin/sessions");
  return { success: true };
}
```

- [ ] **Step 2: Add Drizzle relations to schema**

Add at the bottom of `src/db/schema.ts`:
```typescript
import { relations } from "drizzle-orm";

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  court: one(courts, { fields: [sessions.courtId], references: [courts.id] }),
  votes: many(votes),
  attendees: many(sessionAttendees),
  shuttlecocks: many(sessionShuttlecocks),
  debts: many(sessionDebts),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  session: one(sessions, { fields: [votes.sessionId], references: [sessions.id] }),
  member: one(members, { fields: [votes.memberId], references: [members.id] }),
}));

export const sessionAttendeesRelations = relations(sessionAttendees, ({ one }) => ({
  session: one(sessions, { fields: [sessionAttendees.sessionId], references: [sessions.id] }),
  member: one(members, { fields: [sessionAttendees.memberId], references: [members.id], relationName: "attendeeMember" }),
  invitedBy: one(members, { fields: [sessionAttendees.invitedById], references: [members.id], relationName: "invitedByMember" }),
}));

export const sessionShuttlecocksRelations = relations(sessionShuttlecocks, ({ one }) => ({
  session: one(sessions, { fields: [sessionShuttlecocks.sessionId], references: [sessions.id] }),
  brand: one(shuttlecockBrands, { fields: [sessionShuttlecocks.brandId], references: [shuttlecockBrands.id] }),
}));

export const sessionDebtsRelations = relations(sessionDebts, ({ one }) => ({
  session: one(sessions, { fields: [sessionDebts.sessionId], references: [sessions.id] }),
  member: one(members, { fields: [sessionDebts.memberId], references: [members.id] }),
}));

export const membersRelations = relations(members, ({ many }) => ({
  votes: many(votes),
  debts: many(sessionDebts),
  attendances: many(sessionAttendees, { relationName: "attendeeMember" }),
  guestsInvited: many(sessionAttendees, { relationName: "invitedByMember" }),
}));

export const courtsRelations = relations(courts, ({ many }) => ({
  sessions: many(sessions),
}));

export const shuttlecockBrandsRelations = relations(shuttlecockBrands, ({ many }) => ({
  sessionShuttlecocks: many(sessionShuttlecocks),
  purchases: many(inventoryPurchases),
}));

export const inventoryPurchasesRelations = relations(inventoryPurchases, ({ one }) => ({
  brand: one(shuttlecockBrands, { fields: [inventoryPurchases.brandId], references: [shuttlecockBrands.id] }),
}));
```

- [ ] **Step 3: Create cron API route**

`src/app/api/cron/create-session/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { addDays, format, getDay } from "date-fns";

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if tomorrow is Monday (1) or Friday (5)
  const tomorrow = addDays(new Date(), 1);
  const dayOfWeek = getDay(tomorrow);

  if (dayOfWeek !== 1 && dayOfWeek !== 5) {
    return NextResponse.json({ message: "Not a session day" });
  }

  const dateStr = format(tomorrow, "yyyy-MM-dd");

  // Check if session already exists
  const existing = await db.query.sessions.findFirst({
    where: eq(sessions.date, dateStr),
  });

  if (existing) {
    return NextResponse.json({ message: "Session already exists" });
  }

  await db.insert(sessions).values({ date: dateStr, status: "voting" });

  return NextResponse.json({ message: `Session created for ${dateStr}` });
}
```

- [ ] **Step 4: Create sessions list page**

`src/app/(admin)/admin/sessions/page.tsx` — list all sessions with status badges, link to detail page.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add session management + cron auto-creation + Drizzle relations"
```

---

### Task 10: Session detail page (admin)

**Files:**
- Create: `src/app/(admin)/admin/sessions/[id]/page.tsx`
- Create: `src/components/sessions/court-selector.tsx`
- Create: `src/components/sessions/shuttlecock-selector.tsx`
- Create: `src/components/sessions/vote-list.tsx`

- [ ] **Step 1: Create session detail page**

Server component that fetches session + votes + attendees. Renders different UI based on session status (voting/confirmed/completed/cancelled). Includes CourtSelector, ShuttlecockSelector, VoteList, and cancel/finalize buttons.

- [ ] **Step 2: Create court selector component**

Dropdown of active courts. On select, calls `selectCourt` server action which snapshots the price.

- [ ] **Step 3: Create shuttlecock selector component**

Multi-select: for each brand, input quantity (in qua). Calls server action to save to `session_shuttlecocks` with price snapshot.

- [ ] **Step 4: Create vote list component**

Displays all members with their vote status (going/not going/not voted). Shows guest counts inline.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add session detail page with court/shuttlecock selection"
```

---

### Task 11: User identification + Public layout

**Files:**
- Create: `src/app/(public)/layout.tsx`
- Create: `src/components/layout/header.tsx`
- Create: `src/components/layout/bottom-nav.tsx`
- Create: `src/actions/identify.ts`
- Create: `src/hooks/use-user.ts`

- [ ] **Step 1: Create identify action**

`src/actions/identify.ts`:
```typescript
"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { setUserCookie, clearUserCookie } from "@/lib/user-identity";
import { identifySchema } from "@/lib/validators";

export async function identifyUser(formData: FormData) {
  const parsed = identifySchema.safeParse({
    memberId: Number(formData.get("memberId")),
    phone: formData.get("phone") as string,
  });
  if (!parsed.success) return { error: "Thong tin khong hop le" };

  const member = await db.query.members.findFirst({
    where: and(
      eq(members.id, parsed.data.memberId),
      eq(members.phone, parsed.data.phone),
      eq(members.isActive, true),
    ),
  });

  if (!member) return { error: "So dien thoai khong khop voi thanh vien" };

  await setUserCookie(member.id, member.phone);
  return { success: true, memberName: member.name };
}

export async function resetIdentity() {
  await clearUserCookie();
}
```

- [ ] **Step 2: Create public header**

`src/components/layout/header.tsx` — Logo, language picker, theme toggle.

- [ ] **Step 3: Create bottom nav**

`src/components/layout/bottom-nav.tsx` — 4 tabs: Home, History, Debts, Me.

- [ ] **Step 4: Create public layout**

`src/app/(public)/layout.tsx` — Header + children + BottomNav. Check user cookie; if not identified, show identify dialog. **Important (FR-01.3)**: If cookie exists but member `isActive = false`, show "Lien he admin" message instead of app content.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add public layout with user identification + header + bottom nav"
```

---

### Task 12: Home page + Voting

**Files:**
- Create: `src/app/(public)/page.tsx`
- Create: `src/actions/votes.ts`
- Create: `src/components/sessions/session-card.tsx`
- Create: `src/components/sessions/vote-buttons.tsx`
- Create: `src/components/sessions/guest-form.tsx`
- Create: `src/components/shared/copy-link-button.tsx`

- [ ] **Step 1: Create vote server actions**

`src/actions/votes.ts`:
```typescript
"use server";

import { db } from "@/db";
import { votes } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getUserFromCookie } from "@/lib/user-identity";

export async function submitVote(sessionId: number, willPlay: boolean, willDine: boolean, guestPlayCount: number, guestDineCount: number) {
  const user = await getUserFromCookie();
  if (!user) return { error: "Vui long xac nhan danh tinh truoc" };

  await db.insert(votes).values({
    sessionId,
    memberId: user.memberId,
    willPlay,
    willDine,
    guestPlayCount,
    guestDineCount,
  }).onConflictDoUpdate({
    target: [votes.sessionId, votes.memberId],
    set: {
      willPlay,
      willDine,
      guestPlayCount,
      guestDineCount,
      updatedAt: new Date().toISOString(),
    },
  });

  revalidatePath("/");
  revalidatePath(`/vote/${sessionId}`);
  return { success: true };
}

export async function getSessionVotes(sessionId: number) {
  return db.query.votes.findMany({
    where: eq(votes.sessionId, sessionId),
    with: { member: true },
  });
}
```

- [ ] **Step 2: Create session card, vote buttons, guest form, copy link button**

These are the core UI components for the home page. SessionCard shows next session info. VoteButtons toggle play/dine. GuestForm lets user add guest count. CopyLinkButton copies `/vote/[id]` URL.

- [ ] **Step 3: Create home page**

`src/app/(public)/page.tsx` — Server component. Fetches next upcoming session (status != completed/cancelled, date >= today). Shows SessionCard + VoteButtons + VoteList + quick debt summary.

- [ ] **Step 4: Create vote/[id] page**

`src/app/(public)/vote/[id]/page.tsx` — Same as home but for specific session ID (deep link from group chat).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add home page + voting + copy link"
```

---

## Phase 4: Cost Splitting + Debts

### Task 13: Session finalization + Cost calculator

**Files:**
- Create: `src/lib/cost-calculator.ts`
- Create: `src/components/sessions/finalize-session.tsx`
- Create: `src/actions/finance.ts`

- [ ] **Step 1: Create cost calculator**

`src/lib/cost-calculator.ts` — Pure function implementing the algorithm from the spec. Takes session data + attendees + shuttlecocks → returns per-member debts.

- [ ] **Step 2: Create finalize session component**

Multi-step form: review/edit player list → review/edit diner list → confirm shuttlecock usage → enter dining bill → preview cost breakdown → confirm.

- [ ] **Step 3: Create finance server actions**

`src/actions/finance.ts` — `finalizeSession()`: uses cost calculator, inserts session_debts, updates session status to completed. **Important**: After creating debt records, check if any attendee is the admin member (query admins table to find admin's member_id) and auto-set `admin_confirmed = true` + `member_confirmed = true` for their debt record. Also: `confirmPaymentByMember()`, `confirmPaymentByAdmin()`, `getDebts()` with filters.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add session finalization + cost calculator + debt creation"
```

---

### Task 14: User debt page + Admin finance page

**Files:**
- Create: `src/app/(public)/my-debts/page.tsx`
- Create: `src/app/(admin)/admin/finance/page.tsx`
- Create: `src/components/finance/debt-card.tsx`
- Create: `src/components/finance/debt-list.tsx`
- Create: `src/components/shared/time-filter.tsx`

- [ ] **Step 1: Create time filter component**

`src/components/shared/time-filter.tsx` — Tabs: Tuan / Thang / Nam / Tat ca. Uses `nuqs` for URL state.

- [ ] **Step 2: Create debt card + list**

DebtCard shows single debt. DebtList shows filtered list with total.

- [ ] **Step 3: Create user debts page**

Shows user's debts with filter, total unpaid, and "Da thanh toan" button.

- [ ] **Step 4: Create admin finance page**

Shows all debts, per-member summary, payment confirmation buttons.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add user debt page + admin finance page"
```

---

## Phase 5: Inventory

### Task 15: Inventory management

**Files:**
- Create: `src/actions/inventory.ts`
- Create: `src/app/(admin)/admin/inventory/page.tsx`
- Create: `src/components/inventory/stock-card.tsx`
- Create: `src/components/inventory/purchase-form.tsx`

- [ ] **Step 1: Create inventory server actions**

`src/actions/inventory.ts` — `recordPurchase()`, `getStockByBrand()` (SUM purchases*12 - SUM usage), `getPurchaseHistory()`, `getUsageHistory()`, `checkLowStock()` (returns brands where stock < 12 qua threshold per FR-06.5).

- [ ] **Step 2: Create inventory page**

Stock summary cards per brand, purchase form, purchase/usage history tabs.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add inventory management (purchases, stock tracking)"
```

---

## Phase 6: Statistics

### Task 16: Statistics + Charts

**Files:**
- Create: `src/actions/stats.ts`
- Create: `src/app/(admin)/admin/stats/page.tsx`
- Create: `src/components/stats/active-members-chart.tsx`
- Create: `src/components/stats/monthly-expenses-chart.tsx`
- Create: `src/components/stats/attendance-chart.tsx`

- [ ] **Step 1: Create stats server actions**

`src/actions/stats.ts` — Queries for: active members (play/dine/both count), monthly expenses (court/shuttlecock/dining), attendance per session.

- [ ] **Step 2: Create chart components with Recharts**

Three charts: horizontal bar (active members), stacked bar (monthly expenses), line (attendance trend). All support time range filtering.

- [ ] **Step 3: Create stats page**

Combines all charts with time range selector.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add statistics page with Recharts (active members, expenses, attendance)"
```

---

## Phase 7: i18n + Theming + Polish

### Task 17: Theme system (Light/Dark/Pink)

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `src/components/shared/theme-toggle.tsx`

- [ ] **Step 1: Set up next-themes in root layout**

Wrap app in `ThemeProvider` with themes: light, dark, pink.

- [ ] **Step 2: Add CSS custom properties for all 3 themes**

In `globals.css`: `:root` (light), `.dark` (dark), `.pink` (pink) with all color tokens from spec.

- [ ] **Step 3: Create theme toggle component**

Sun/Moon/Heart icon toggle.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add 3 themes (light/dark/pink) with next-themes"
```

---

### Task 18: Internationalization (VI/EN/ZH)

**Files:**
- Create: `src/i18n/config.ts`
- Create: `src/i18n/request.ts`
- Create: `src/i18n/messages/vi.json`
- Create: `src/i18n/messages/en.json`
- Create: `src/i18n/messages/zh.json`
- Create: `src/components/shared/language-selector.tsx`
- Modify: `src/middleware.ts`

- [ ] **Step 1: Set up next-intl**

Configure next-intl with cookie-based locale detection. Default: vi.

**Important**: Update `next.config.ts` with the next-intl plugin wrapper:
```typescript
import createNextIntlPlugin from 'next-intl/plugin';
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
export default withNextIntl({ /* existing next config */ });
```

- [ ] **Step 2: Create translation files**

All UI strings in vi.json, en.json, zh.json.

- [ ] **Step 3: Create language selector**

Dropdown: Tieng Viet / English / 中文. Saves to cookie.

- [ ] **Step 4: Update all pages to use translations**

Replace ALL hardcoded Vietnamese strings from Tasks 1-16 with `useTranslations()` (client components) / `getTranslations()` (server components). This is a large step — go file by file through: login page, admin layout/sidebar, member/court/shuttlecock pages, session pages, vote pages, debt pages, inventory pages, stats pages, public layout/header/bottom-nav.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add i18n support (Vietnamese, English, Chinese)"
```

---

### Task 19: History + Me pages + Admin dashboard

**Files:**
- Create: `src/app/(public)/history/page.tsx`
- Create: `src/app/(public)/me/page.tsx`
- Modify: `src/app/(admin)/admin/dashboard/page.tsx`

- [ ] **Step 1: Create history page**

List past sessions with expand for details.

- [ ] **Step 2: Create me page**

Profile card, theme/language settings, quick stats.

- [ ] **Step 3: Build admin dashboard**

Stat cards (outstanding debt, stock with low-stock warnings, members, sessions), upcoming session quick actions, recent activity.

- [ ] **Step 4: Add admin password change (FR-11.5)**

Add `changePassword` action to `src/actions/auth.ts`. Add a settings section in the dashboard (or a separate `/admin/settings` page) with current password + new password form.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add history, profile pages + admin dashboard + password change"
```

---

### Task 20: Final polish + responsive testing

- [ ] **Step 1: Test all pages at mobile/tablet/desktop breakpoints**
- [ ] **Step 2: Fix any responsive issues**
- [ ] **Step 3: Test all 3 themes across all pages**
- [ ] **Step 4: Test full user flow: identify → vote → view debt → confirm payment**
- [ ] **Step 5: Test full admin flow: login → create session → select court/shuttlecock → finalize → confirm payment**
- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: final polish + responsive fixes"
```
