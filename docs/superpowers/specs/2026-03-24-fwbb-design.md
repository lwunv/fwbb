# FWBB - Badminton Club Management App

## Software Requirements Specification (SRS)

**Version:** 1.1
**Date:** 2026-03-24
**Project:** FWBB (Fun With BadminBton)
**Author:** AI-assisted design

---

## 1. Introduction

### 1.1 Purpose

FWBB is a web application for managing a recreational badminton club of ~20 members. The app handles session scheduling, attendance voting, cost splitting, shuttlecock inventory tracking, and financial management for the group leader (admin).

### 1.2 Problem Statement

The group leader currently manages everything manually: collecting votes, calculating costs, tracking debts, and managing shuttlecock inventory. With variable attendance, guest players, post-game dining with different participants, and multiple shuttlecock brands at different prices, manual calculation is error-prone and time-consuming.

### 1.3 Solution

A mobile-first web application where:
- Members vote for upcoming sessions and view their debts
- Admin manages sessions, calculates costs, and tracks finances
- The system auto-generates sessions and computes cost splits

### 1.4 Scope

**In scope:**
- Session auto-creation on fixed schedule (Monday & Friday)
- Attendance voting (play + dine + guests)
- Court and shuttlecock selection per session
- Cost splitting (court + shuttlecock + dining)
- Debt tracking and payment confirmation
- Shuttlecock inventory management
- Statistics and charts
- Multi-theme (Light/Dark/Pink) and multi-language (VI/EN/ZH)

**Out of scope:**
- Push notifications / automated messaging
- Online payment integration
- Real-time chat
- Tournament/match scoring

---

## 2. User Roles

### 2.1 Admin (Group Leader)
- Single admin account
- Login with username + password
- Full access to all management features
- Pays upfront for court, shuttlecocks, dining; collects from members after
- **The admin is also a member in the members table.** They can vote and participate like any regular member. Their debt is included in cost calculations but auto-confirmed (they are paying themselves).

### 2.2 User (Member)
- No login required
- Identified by selecting name from admin-created list + phone number (first time)
- Identity persisted via browser cookie
- Can vote, view session info, view personal debts, confirm payment

---

## 3. Functional Requirements

### 3.1 User Identification (FR-01)

**FR-01.1** First-time user flow:
1. User opens app
2. Selects their name from the member list (created by admin)
3. Enters phone number for verification
4. System saves member_id + phone hash in httpOnly cookie, **signed with HMAC-SHA256** using a server-side secret to prevent tampering
5. Subsequent visits auto-identify the user (cookie signature verified server-side)

**FR-01.2** Cookie expiry: 365 days. If expired, user repeats the flow.

**FR-01.3** If cookie exists but member is deactivated, show "Contact admin" message.

### 3.2 Session Management (FR-02)

**FR-02.1** Auto-creation: A cron job runs daily at 00:00 (Asia/Ho_Chi_Minh). If tomorrow is Monday or Friday, create a new session with:
- `date`: tomorrow's date
- `start_time`: 20:30
- `end_time`: 22:30
- `status`: `voting`
- `court_id`: NULL (admin selects later)

**FR-02.2** Session statuses:
| Status | Description |
|---|---|
| `voting` | Auto-created, members can vote |
| `confirmed` | Admin has selected court + shuttlecocks, session is set |
| `completed` | Session finished, costs calculated |
| `cancelled` | Admin cancelled the session |

**FR-02.3** Admin can:
- Select/change court for a session
- Select shuttlecock types and quantities to use (multiple brands per session)
- Cancel a session (status → `cancelled`)
- End a session: finalize attendees + costs → status `completed`

**FR-02.4** Vote auto-opens when session is created (status = `voting`).

**FR-02.5** Admin can cancel a session at any status before `completed`.

**FR-02.6** Session state transitions (explicit state machine):
```
voting → confirmed    (admin selects court + shuttlecocks)
voting → cancelled    (admin cancels)
confirmed → completed (admin finalizes session)
confirmed → cancelled (admin cancels)
```
No backward transitions. `cancelled` and `completed` are terminal states.

**FR-02.7** Copy Link: Each session has a "Copy Link" button that copies the vote URL (`/vote/[id]`) to clipboard. Admin pastes into group chat for members to vote. Available on both public and admin views.

### 3.3 Voting (FR-03)

**FR-03.1** For each session, a member can vote:
- Will play badminton: Yes / No
- Will dine after: Yes / No
- Add guest(s) for play: count (names are optional at vote stage, finalized by admin later)
- Add guest(s) for dine: count (names are optional at vote stage, finalized by admin later)

**FR-03.2** Members can change their vote anytime before session status becomes `completed`.

**FR-03.3** Guest (giao luu) rules:
- Any member can add guests via vote
- Admin can also add guests directly
- Guest cost is attributed to the member who invited them

**FR-03.4** The vote page displays:
- Session date, time
- Court info (if selected)
- List of all members with their vote status (voted yes/no/not yet)
- Total count: playing / dining / not voted

### 3.4 Cost Splitting (FR-04)

**FR-04.1** After a session, admin finalizes the attendee list:
- **Players list**: initialized from votes (will_play = true) + their guests
- **Diners list**: initialized from votes (will_dine = true) + their guests
- Admin can add/remove anyone from either list

**FR-04.2** Cost calculation:

```
total_shuttlecock_cost = SUM(quantity_used_per_brand × price_per_quả_of_brand)
  where price_per_quả = price_per_tube / 12

play_cost_per_head = (court_price + total_shuttlecock_cost) / total_players
  where total_players = members_playing + all_guests_playing

dine_cost_per_head = dining_bill / total_diners
  where total_diners = members_dining + all_guests_dining

member_total =
  (play_cost_per_head IF member plays, else 0)
  + (dine_cost_per_head IF member dines, else 0)
  + (play_cost_per_head × number_of_guests_they_invited_to_play)
  + (dine_cost_per_head × number_of_guests_they_invited_to_dine)
```

**FR-04.3** Amounts are rounded to nearest 1,000 VND for simplicity. Rounding differences (surplus/deficit) are absorbed by the admin. This is acceptable for a small club where differences are minimal (typically < 10,000 VND per session).

**FR-04.5** Guest counts are independent. A single guest who both plays and dines should be counted in both `guest_play_count` and `guest_dine_count`. Final guest details (names, exact participation) are reconciled during session finalization by admin.

**FR-04.4** After admin confirms, debts are created for each member.

### 3.5 Payment & Debt Tracking (FR-05)

**FR-05.1** After session completion, each member has a debt record:
- `play_amount`: cost for playing
- `dine_amount`: cost for dining
- `guest_play_amount`: cost for guests playing
- `guest_dine_amount`: cost for guests dining
- `total_amount`: sum of above

**FR-05.2** Payment confirmation (dual flow):
- **Flow A**: Member clicks "I've paid" → `member_confirmed = true` → Admin sees notification → Admin clicks "Confirm received" → `admin_confirmed = true` → Debt settled
- **Flow B**: Admin directly clicks "Received" → `admin_confirmed = true` → Debt settled

**FR-05.3** Debt viewing:
- Members can view their debts filtered by: week / month / year / all time
- Each debt shows: date, session details, breakdown (play/dine/guest), status
- Running total of unpaid debts

**FR-05.4** Admin finance dashboard:
- Total outstanding debts
- Per-member debt summary
- Payment history
- Filter by: week / month / year / all time

### 3.6 Shuttlecock Inventory (FR-06)

**FR-06.1** Unit system: 1 tube = 12 shuttlecocks (quả).

**FR-06.2** Admin can record purchases:
- Select brand
- Number of tubes
- Price per tube
- Purchase date
- Notes (optional)

**FR-06.3** Per session, admin records usage:
- Select brand(s)
- Number of shuttlecocks used (in quả) per brand

**FR-06.4** Inventory display per brand:
- Current stock: X tubes + Y loose quả (e.g., "3 ống 8 quả" = 44 quả)
- Total stock = SUM(purchased_tubes × 12) - SUM(used_quả)

**FR-06.5** Low stock warning when any brand falls below a configurable threshold (default: 12 quả = 1 tube).

**FR-06.6** Purchase history and usage history views.

### 3.7 Member Management (FR-07)

**FR-07.1** Admin can:
- Add new member (name, phone)
- Edit member info
- Deactivate member (soft delete, preserves history)
- View member list

**FR-07.2** Member list shows: name, phone, active status, total outstanding debt.

### 3.8 Court Management (FR-08)

**FR-08.1** Admin can:
- Add court (name, address, price per session)
- Edit court info
- Deactivate court

**FR-08.2** Court list shows: name, address, price, active status.

### 3.9 Shuttlecock Brand Management (FR-09)

**FR-09.1** Admin can:
- Add brand (name, price per tube)
- Edit brand info
- Deactivate brand

**FR-09.2** Brand list shows: name, price per tube, current stock, active status.

### 3.10 Statistics & Charts (FR-10)

**FR-10.1** Active members chart:
- Top members by badminton sessions attended
- Top members by dining sessions attended
- Top members by both combined
- Time range filter

**FR-10.2** Monthly expense chart:
- Court costs per month
- Shuttlecock costs per month
- Dining costs per month
- Total combined per month
- Bar chart or line chart, selectable

**FR-10.3** Attendance chart:
- Number of players per session (line/bar chart over time)
- Average attendance trend

**FR-10.4** All charts support time range filtering.

### 3.11 Admin Authentication (FR-11)

**FR-11.1** Single admin account, pre-seeded in database.

**FR-11.2** Login: username + password → validate against bcrypt hash → issue JWT in httpOnly cookie (7-day expiry).

**FR-11.3** All `/admin/*` routes protected by middleware checking JWT validity.

**FR-11.4** Logout: clear JWT cookie.

**FR-11.5** Admin can change their password from settings.

---

## 4. Non-Functional Requirements

### 4.1 Performance (NFR-01)
- First Contentful Paint < 2 seconds on 3G mobile (SSR pages)
- Time to Interactive < 4 seconds on 3G mobile (chart-heavy pages may be higher)
- Server Actions response < 500ms
- Database queries < 100ms (Turso edge)

### 4.2 Responsive Design (NFR-02)
- **Mobile** (< 640px): Single column, bottom navigation, touch-friendly (44px min tap targets)
- **Tablet** (640-1024px): Two-column layout, collapsible sidebar
- **Desktop** (> 1024px): Full sidebar + content area
- Mobile-first CSS approach

### 4.3 Theming (NFR-03)

Three themes with CSS custom properties:

| Token | Light | Dark | Pink |
|---|---|---|---|
| `--background` | `#FFFFFF` | `#0F172A` | `#FFF0F5` |
| `--surface` | `#F8FAFC` | `#1E293B` | `#FFE4EF` |
| `--primary` | `#6366F1` | `#818CF8` | `#EC4899` |
| `--primary-foreground` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| `--text` | `#1E293B` | `#F1F5F9` | `#831843` |
| `--accent` | `#10B981` | `#34D399` | `#F472B6` |
| `--border` | `#E2E8F0` | `#334155` | `#FBCFE8` |
| `--card` | `#FFFFFF` | `#1E293B` | `#FFF5F8` |
| `--destructive` | `#EF4444` | `#F87171` | `#E11D48` |

Pink theme additional styles: larger border-radius (12px), softer font weights, playful emoji icons.

### 4.4 Internationalization (NFR-04)
- Vietnamese (default), English, Chinese
- Language selector in header, persisted in cookie
- All UI text externalized to JSON translation files
- Date/number formatting localized (e.g., VND currency format)

### 4.5 Security (NFR-05)
- Admin password hashed with bcrypt (cost factor 12)
- JWT tokens in httpOnly, secure, sameSite cookies
- All Server Actions validate input with Zod schemas
- User identity cookie: member_id + phone hash, **signed with HMAC-SHA256** using `USER_COOKIE_SECRET` to prevent tampering/impersonation
- No sensitive data in client-side storage

### 4.6 Accessibility (NFR-06)
- shadcn/ui components are WAI-ARIA compliant
- Keyboard navigable
- Color contrast ratio >= 4.5:1 (WCAG AA)
- Focus indicators visible

### 4.7 Code Quality (NFR-07)
- TypeScript strict mode
- ESLint + Prettier
- Drizzle migrations for schema changes
- Zod validation on all inputs
- Consistent file/folder naming conventions

---

## 5. Technical Architecture

### 5.1 Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Framework | Next.js 14+ (App Router) | SSR, Server Actions, API Routes |
| UI | shadcn/ui + Tailwind CSS v4 | Component library + utility CSS |
| Theme | next-themes | Theme switching (light/dark/pink) |
| i18n | next-intl | Multi-language support |
| ORM | Drizzle ORM | Type-safe database access |
| Database | Turso (libSQL/SQLite) | Cloud-hosted SQLite |
| Auth | jose (JWT) | Admin authentication |
| Charts | Recharts | Data visualization |
| Forms | React Hook Form + Zod | Form handling + validation |
| Date | date-fns | Date manipulation |
| URL State | nuqs | Search params state management |
| Deploy | Vercel | Hosting + Cron Jobs |

### 5.2 Project Structure

```
fwbb/
├── public/
│   └── locales/           # Static assets
├── src/
│   ├── app/
│   │   ├── (public)/              # User-facing pages (no auth)
│   │   │   ├── page.tsx           # Home - next session + vote
│   │   │   ├── vote/[id]/
│   │   │   │   └── page.tsx       # Vote for specific session
│   │   │   ├── history/
│   │   │   │   └── page.tsx       # Past session history
│   │   │   ├── my-debts/
│   │   │   │   └── page.tsx       # Personal debt view
│   │   │   ├── me/
│   │   │   │   └── page.tsx       # Profile + settings (theme/lang)
│   │   │   └── layout.tsx         # Public layout (bottom nav)
│   │   ├── (admin)/               # Admin pages (auth required)
│   │   │   ├── admin/
│   │   │   │   ├── login/
│   │   │   │   │   └── page.tsx   # Admin login
│   │   │   │   ├── dashboard/
│   │   │   │   │   └── page.tsx   # Admin dashboard
│   │   │   │   ├── sessions/
│   │   │   │   │   ├── page.tsx   # Session list
│   │   │   │   │   └── [id]/
│   │   │   │   │       └── page.tsx # Session detail + finalize
│   │   │   │   ├── members/
│   │   │   │   │   └── page.tsx   # Member management
│   │   │   │   ├── inventory/
│   │   │   │   │   └── page.tsx   # Shuttlecock inventory
│   │   │   │   ├── finance/
│   │   │   │   │   └── page.tsx   # Finance + debt management
│   │   │   │   ├── stats/
│   │   │   │   │   └── page.tsx   # Statistics + charts
│   │   │   │   ├── courts/
│   │   │   │   │   └── page.tsx   # Court management
│   │   │   │   └── shuttlecocks/
│   │   │   │       └── page.tsx   # Brand management
│   │   │   └── layout.tsx         # Admin layout (sidebar)
│   │   ├── api/
│   │   │   └── cron/
│   │   │       └── create-session/
│   │   │           └── route.ts   # Auto-create sessions
│   │   ├── layout.tsx             # Root layout (theme + i18n providers)
│   │   └── globals.css            # Global styles + theme tokens
│   ├── actions/                   # Server Actions
│   │   ├── auth.ts                # Login/logout
│   │   ├── sessions.ts            # Session CRUD
│   │   ├── votes.ts               # Vote actions
│   │   ├── members.ts             # Member CRUD
│   │   ├── courts.ts              # Court CRUD
│   │   ├── shuttlecocks.ts        # Brand CRUD
│   │   ├── inventory.ts           # Purchase + usage
│   │   ├── finance.ts             # Debt + payment actions
│   │   └── stats.ts               # Statistics queries
│   ├── db/
│   │   ├── index.ts               # Drizzle client (Turso)
│   │   ├── schema.ts              # Drizzle table definitions
│   │   └── migrations/            # SQL migrations
│   ├── components/
│   │   ├── ui/                    # shadcn/ui components
│   │   ├── layout/                # Header, Sidebar, BottomNav
│   │   ├── sessions/              # Session-related components
│   │   ├── vote/                  # Vote-related components
│   │   ├── finance/               # Finance-related components
│   │   ├── inventory/             # Inventory-related components
│   │   ├── stats/                 # Chart components
│   │   └── shared/                # Shared components
│   ├── lib/
│   │   ├── auth.ts                # JWT helpers
│   │   ├── utils.ts               # General utilities
│   │   ├── cost-calculator.ts     # Cost splitting logic
│   │   └── validators.ts          # Zod schemas
│   ├── i18n/
│   │   ├── config.ts              # next-intl config
│   │   └── messages/
│   │       ├── vi.json            # Vietnamese
│   │       ├── en.json            # English
│   │       └── zh.json            # Chinese
│   ├── hooks/                     # Custom React hooks
│   └── types/                     # TypeScript type definitions
├── drizzle.config.ts              # Drizzle configuration
├── next.config.ts                 # Next.js configuration
├── tailwind.config.ts             # Tailwind configuration
├── vercel.json                    # Vercel cron config
├── .env.local                     # Environment variables (local)
├── package.json
└── tsconfig.json
```

### 5.3 Database Schema (Drizzle)

```typescript
// db/schema.ts

// ===== ADMINS =====
admins {
  id            integer    PK autoincrement
  username      text       NOT NULL UNIQUE
  password_hash text       NOT NULL
  created_at    text       DEFAULT current_timestamp
}

// ===== MEMBERS =====
members {
  id            integer    PK autoincrement
  name          text       NOT NULL
  phone         text       NOT NULL UNIQUE
  is_active     integer    DEFAULT 1 (boolean)
  created_at    text       DEFAULT current_timestamp
}

// ===== COURTS =====
courts {
  id                integer    PK autoincrement
  name              text       NOT NULL
  address           text
  price_per_session integer    NOT NULL  -- VND
  is_active         integer    DEFAULT 1
}

// ===== SHUTTLECOCK BRANDS =====
shuttlecock_brands {
  id             integer    PK autoincrement
  name           text       NOT NULL
  price_per_tube integer    NOT NULL  -- VND
  is_active      integer    DEFAULT 1
}

// ===== SESSIONS =====
sessions {
  id            integer    PK autoincrement
  date          text       NOT NULL  -- ISO date YYYY-MM-DD
  start_time    text       DEFAULT '20:30'
  end_time      text       DEFAULT '22:30'
  court_id      integer    FK → courts (nullable)
  court_price   integer    -- snapshot of court price at time of selection (VND)
  status        text       DEFAULT 'voting'
                           CHECK (status IN ('voting','confirmed','completed','cancelled'))
  dining_bill   integer    -- total dining bill VND (nullable)
  notes         text
  created_at    text       DEFAULT current_timestamp
  updated_at    text       DEFAULT current_timestamp
}
INDEX idx_sessions_date ON sessions(date)

// ===== VOTES =====
votes {
  id               integer    PK autoincrement
  session_id       integer    FK → sessions NOT NULL
  member_id        integer    FK → members NOT NULL
  will_play        integer    DEFAULT 0 (boolean)
  will_dine        integer    DEFAULT 0 (boolean)
  guest_play_count integer    DEFAULT 0
  guest_dine_count integer    DEFAULT 0
  created_at       text       DEFAULT current_timestamp
  updated_at       text       DEFAULT current_timestamp
  UNIQUE(session_id, member_id)
}
INDEX idx_votes_session ON votes(session_id)

// ===== SESSION ATTENDEES (finalized by admin) =====
session_attendees {
  id              integer    PK autoincrement
  session_id      integer    FK → sessions NOT NULL
  member_id       integer    FK → members (nullable, NULL for guests)
  guest_name      text       -- for non-member guests
  invited_by_id   integer    FK → members (nullable, NULL if own member)
  is_guest        integer    DEFAULT 0 (boolean)
  attends_play    integer    DEFAULT 0 (boolean)
  attends_dine    integer    DEFAULT 0 (boolean)
}

// ===== SESSION SHUTTLECOCKS (used per session) =====
session_shuttlecocks {
  id              integer    PK autoincrement
  session_id      integer    FK → sessions NOT NULL
  brand_id        integer    FK → shuttlecock_brands NOT NULL
  quantity_used   integer    NOT NULL  -- in quả (shuttlecocks)
  price_per_tube  integer    NOT NULL  -- snapshot of brand price at time of use (VND)
}

// ===== INVENTORY PURCHASES =====
inventory_purchases {
  id             integer    PK autoincrement
  brand_id       integer    FK → shuttlecock_brands NOT NULL
  tubes          integer    NOT NULL
  price_per_tube integer    NOT NULL  -- VND
  total_price    integer    NOT NULL  -- VND
  purchased_at   text       NOT NULL  -- ISO date
  notes          text
  created_at     text       DEFAULT current_timestamp
}

// ===== SESSION DEBTS =====
session_debts {
  id                  integer    PK autoincrement
  session_id          integer    FK → sessions NOT NULL
  member_id           integer    FK → members NOT NULL
  play_amount         integer    DEFAULT 0  -- VND
  dine_amount         integer    DEFAULT 0  -- VND
  guest_play_amount   integer    DEFAULT 0  -- VND
  guest_dine_amount   integer    DEFAULT 0  -- VND
  total_amount        integer    NOT NULL    -- VND
  member_confirmed    integer    DEFAULT 0 (boolean)
  member_confirmed_at text
  admin_confirmed     integer    DEFAULT 0 (boolean)
  admin_confirmed_at  text
  updated_at          text       DEFAULT current_timestamp
  UNIQUE(session_id, member_id)
}
INDEX idx_debts_member ON session_debts(member_id, admin_confirmed)
```

### 5.4 Key Entity Relationships

```
admins          (standalone, single record)

members ──1:N── votes
members ──1:N── session_attendees
members ──1:N── session_debts
members ──1:N── session_attendees (as invited_by)

courts ──1:N── sessions

shuttlecock_brands ──1:N── session_shuttlecocks
shuttlecock_brands ──1:N── inventory_purchases

sessions ──1:N── votes
sessions ──1:N── session_attendees
sessions ──1:N── session_shuttlecocks
sessions ──1:N── session_debts
sessions ──N:1── courts
```

### 5.5 Cost Calculation Algorithm

```
function calculateSessionCosts(session):
  // 1. Get all attendees
  players = attendees WHERE attends_play = true
  diners = attendees WHERE attends_dine = true

  // 2. Calculate per-head costs (using snapshot prices)
  court_price = session.court_price  // snapshot at time of selection
  shuttlecock_cost = SUM(
    FOR EACH session_shuttlecock:
      quantity_used × (session_shuttlecock.price_per_tube / 12)  // snapshot price
  )
  play_cost_per_head = (court_price + shuttlecock_cost) / COUNT(players)
  dine_cost_per_head = session.dining_bill / COUNT(diners)

  // 3. Round to nearest 1,000 VND
  play_cost_per_head = ROUND(play_cost_per_head / 1000) × 1000
  dine_cost_per_head = ROUND(dine_cost_per_head / 1000) × 1000

  // 4. Calculate per-member debt
  FOR EACH member IN unique_members(attendees):
    plays = member IN players (not as guest)
    dines = member IN diners (not as guest)
    guest_play = COUNT(players WHERE invited_by = member)
    guest_dine = COUNT(diners WHERE invited_by = member)

    debt = {
      play_amount: plays ? play_cost_per_head : 0,
      dine_amount: dines ? dine_cost_per_head : 0,
      guest_play_amount: guest_play × play_cost_per_head,
      guest_dine_amount: guest_dine × dine_cost_per_head,
      total: SUM of above
    }
    INSERT session_debts(debt)
```

### 5.6 Cron Job: Auto-Create Sessions

```
Endpoint: /api/cron/create-session
Schedule: 0 0 * * * (daily at 00:00 UTC+7)
Auth: Vercel cron secret header

Logic:
  tomorrow = today + 1 day
  dayOfWeek = tomorrow.getDay()

  IF dayOfWeek === 1 (Monday) OR dayOfWeek === 5 (Friday):
    IF NOT EXISTS session WHERE date = tomorrow:
      INSERT session(date=tomorrow, status='voting')

Note: Sessions are created ~21 hours before start time (00:00 → 20:30).
This is sufficient for a small group (~20 members) that communicates via group chat.
Admin shares the vote link after session creation.
```

### 5.7 Authentication Flow

```
Admin Login:
  POST username + password
  → bcrypt.compare(password, stored_hash)
  → IF match: sign JWT { sub: admin_id, role: 'admin' }
  → Set httpOnly cookie (7 days)

Admin Middleware:
  Every /admin/* request
  → Read JWT from cookie
  → Verify with jose
  → IF invalid/expired: redirect to /admin/login

User Identification:
  First visit:
  → Select name from member list
  → Enter phone number
  → Server validates phone matches member record
  → Set cookie: { member_id, phone_hash } (365 days)

  Subsequent visits:
  → Read cookie → lookup member → identified
```

---

## 6. UI/UX Specification

### 6.1 Design Principles
- **Mobile-first**: Design for phone screens first, scale up
- **Cute & Modern**: Rounded corners, soft shadows, playful colors (especially in Pink theme)
- **Simple**: Minimal clicks to complete any action
- **Clear hierarchy**: Important info (next session, debt) always visible

### 6.2 Theme System

Three themes managed via `next-themes` + CSS custom properties:

**Light Mode**: Clean, professional. White backgrounds, indigo accents.
**Dark Mode**: Slate backgrounds, lighter indigo accents. Easy on eyes.
**Pink Mode**: Lavender-pink backgrounds, pink accents, extra-rounded corners (12px), playful emoji decorations.

Theme switcher in header: icon toggle (sun/moon/heart).

### 6.3 Responsive Layout

**Mobile (< 640px)**:
- Single column layout
- Bottom navigation bar (4 tabs: Home, History, Debts, Me)
- Cards stack vertically
- Admin: hamburger menu → full-screen overlay nav

**Tablet (640-1024px)**:
- Two-column where appropriate
- Bottom nav for user pages
- Collapsible sidebar for admin pages

**Desktop (> 1024px)**:
- Admin: persistent left sidebar (240px) + content area
- User: centered content (max-width 640px) with decorative sides

### 6.4 Page Specifications

#### 6.4.1 Home Page (`/`)

**Purpose**: Show next upcoming session, allow voting

**Layout**:
```
[Header: Logo | Language Picker | Theme Toggle]

[Next Session Card]
  - Date & day of week
  - Time (20:30 - 22:30)
  - Court name + price (if selected, else "Chua chon san")
  - Player count / total members

  [Vote Buttons]
  - "Di choi" / "Khong di" (toggle, highlight active)
  - "Di an"  / "Khong an" (toggle, highlight active)
  - "+ Them khach giao luu" (expandable form)

[Vote Status List]
  - Grouped: Going / Not going / Not voted
  - Each row: Avatar/initial + Name + icons (racket/beer)
  - Guest count shown inline

[My Quick Debt Summary]
  - Total unpaid amount
  - "Xem chi tiet →" link

[Bottom Nav]
```

#### 6.4.2 Vote Page (`/vote/[id]`)

**Purpose**: Vote for a specific session (deep link from group chat)

**Layout**: Same as home but for specific session. Shows past sessions too.

#### 6.4.3 History Page (`/history`)

**Purpose**: View past session history

**Layout**:
```
[Header]

[Session List - sorted newest first]
  Each card:
  - Date + day of week
  - Court name
  - Player count + diner count
  - Total cost breakdown
  - Status badge (completed/cancelled)
  - Tap to expand: attendee list, cost details

[Bottom Nav]
```

#### 6.4.4 Me Page (`/me`)

**Purpose**: User profile and settings

**Layout**:
```
[Header]

[Profile Card]
  - Name + phone (from cookie identity)
  - "Doi nguoi dung" link (reset cookie, re-select)

[Settings]
  - Theme toggle: Light / Dark / Pink
  - Language: VI / EN / ZH

[Quick Stats]
  - Total sessions played
  - Total sessions dined
  - Total spent (all time)

[Bottom Nav]
```

#### 6.4.5 My Debts Page (`/my-debts`)

**Purpose**: View personal debt history

**Layout**:
```
[Header]

[Filter Tabs: Tuan | Thang | Nam | Tat ca]

[Total Unpaid Banner: "Ban dang no: 450,000d"]

[Debt List - sorted newest first]
  Each card:
  - Date + court name
  - Breakdown: Tien choi: 85k | Tien an: 120k | Khach: 85k
  - Total: 290,000d
  - Status badge: "Chua tra" / "Cho xac nhan" / "Da thanh toan"
  - [Button: "Da thanh toan"] (if unpaid)

[Bottom Nav]
```

#### 6.4.6 Admin Dashboard (`/admin/dashboard`)

**Purpose**: Overview of club status

**Layout**:
```
[Sidebar] | [Content]

[Stat Cards Row]
  - Total outstanding debt
  - Shuttlecock stock (lowest brand warning)
  - Members active
  - Sessions this month

[Upcoming Session Card]
  - Quick actions: Select court, Select shuttlecocks

[Recent Activity]
  - Latest votes
  - Recent payments confirmed

[Quick Links]
  - Manage next session
  - View finance
```

#### 6.4.7 Admin Session Detail (`/admin/sessions/[id]`)

**Purpose**: Manage individual session

**States by session status**:

**Voting state**:
- See vote list
- Select court (dropdown)
- Select shuttlecocks (multi-select brand + quantity)
- Cancel session button

**Confirmed state**:
- All above + edit
- Mark as "Complete session" → opens finalization flow

**Finalization flow** (modal/page):
1. Review/edit player list (checkboxes, add/remove, add guests)
2. Review/edit diner list (checkboxes, add/remove, add guests)
3. Confirm shuttlecock usage
4. Enter dining bill
5. Preview cost breakdown (per-head + per-member)
6. Confirm → creates debts → status = completed

**Completed state**:
- Read-only summary
- Cost breakdown table
- Payment status per member

#### 6.4.8 Admin Finance (`/admin/finance`)

**Purpose**: Track all debts and payments

**Layout**:
```
[Filter: Tuan | Thang | Nam | Tat ca]

[Summary Cards]
  - Total outstanding
  - Total collected this period
  - Total expenses this period

[Debt Table]
  Columns: Member | Session Date | Amount | Status | Actions
  Status: Unpaid / Member Confirmed / Paid
  Actions: "Confirm Payment" button

[Member Summary Tab]
  Each member:
  - Name
  - Total debt
  - Paid / Unpaid breakdown
```

#### 6.4.9 Admin Stats (`/admin/stats`)

**Purpose**: Charts and statistics

**Charts**:
1. **Active Members** (horizontal bar chart)
   - Toggle: Play / Dine / Both
   - Shows top 10 members by session count

2. **Monthly Expenses** (stacked bar chart)
   - Categories: Court / Shuttlecock / Dining
   - X-axis: months, Y-axis: VND

3. **Attendance Trend** (line chart)
   - Players per session over time
   - Moving average line

4. **Time range selector** applies to all charts

#### 6.4.10 Admin Inventory (`/admin/inventory`)

**Purpose**: Manage shuttlecock stock

**Layout**:
```
[Stock Summary Cards - per brand]
  Brand name | Stock: 3 ong 8 qua (44 qua) | Status indicator

[Tab: Mua vao | Su dung]

Mua vao tab:
  [+ Nhap mua] button → form: brand, tubes, price, date
  Purchase history table

Su dung tab:
  Usage per session table: date, brand, quantity used
```

---

## 7. Deployment

### 7.1 Vercel Configuration

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/create-session",
      "schedule": "0 17 * * *"
    }
  ]
}
```

Note: `0 17 * * *` = 17:00 UTC = 00:00 UTC+7 (Vietnam time).
Requires Vercel Hobby plan (free, supports 2 daily crons — sufficient for this project).

### 7.2 Environment Variables

```
TURSO_DATABASE_URL=libsql://fwbb-xxx.turso.io
TURSO_AUTH_TOKEN=eyJhbGciOi...
JWT_SECRET=<random-32-byte-hex>
USER_COOKIE_SECRET=<random-32-byte-hex>
CRON_SECRET=<vercel-cron-secret>
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<bcrypt-hash>
```

### 7.3 Local Development

```bash
# Install dependencies
pnpm install

# Set up local SQLite
cp .env.example .env.local
# Edit .env.local: TURSO_DATABASE_URL=file:local.db

# Run migrations
pnpm db:migrate

# Seed admin account
pnpm db:seed

# Start dev server
pnpm dev
```

---

## 8. Glossary

| Term | Vietnamese | Description |
|---|---|---|
| Session (Buoi choi) | Buoi choi | A scheduled badminton playing session |
| Vote | Vote/Binh chon | Member's declaration of attendance |
| Guest (Giao luu) | Khach giao luu | Non-member invited by a member |
| Debt (Du no) | Du no | Amount owed by member after a session |
| Court (San) | San cau long | Badminton court venue |
| Shuttlecock (Cau) | Qua cau | Badminton shuttlecock |
| Tube (Ong) | Ong cau | Tube of 12 shuttlecocks |
| Dining (An nhau) | An nhau | Post-session dining/drinking |
| Admin | Truong nhom | Group leader who manages everything |
