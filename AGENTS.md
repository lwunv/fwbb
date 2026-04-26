<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

---

## Project Overview

**FWBB** is a badminton group management app — handling **sessions**, **votes**, **cost-splitting**, **debt tracking**, and **shuttlecock inventory**. The primary users are group members on mobile devices. The admin manages sessions, finances, and inventory.

**Tech Stack:**
| Layer | Tool |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Styling | Tailwind CSS v4 + Shadcn UI (`base-nova`) |
| Database | Drizzle ORM + Turso (SQLite) |
| Animation | `framer-motion` |
| Data Fetching (client) | `@tanstack/react-query` |
| Client State | `zustand` |
| URL State | `nuqs` |
| Forms | `react-hook-form` + `zod` |
| i18n | `next-intl` |
| Toasts | `sonner` |
| Icons | `lucide-react` |

---

## 📱 Mobile-First & Responsive Design (MANDATORY)

Members interact with the app **primarily on mobile** (Zalo/Messenger in-app browser). Every UI decision must start from a small screen.

1. **Design mobile first, enhance for desktop.** Always write mobile styles first; use `sm:`, `md:`, `lg:` breakpoints to scale up — never the reverse.
2. **Touch targets:** All interactive elements (buttons, checkboxes, toggles, steppers) must be at minimum `44×44px` touch area. Use generous padding, not tiny icons.
3. **Bottom-anchored actions:** Primary actions (Submit, Confirm, Vote) should be sticky at the bottom of the viewport on mobile, within easy thumb reach.
4. **No horizontal scroll.** Content must wrap or truncate. Tables on mobile should transform into card/list layouts.
5. **Font sizes:** Body text ≥ `16px` (prevents iOS zoom). Labels ≥ `14px`. Never use `text-xs` for critical information.
6. **Sheet/Drawer > Modal:** On mobile, prefer bottom sheets (`framer-motion` slide-up) over centered modals. Modals are acceptable on `md:` and above.
7. **Skeleton & loading states:** Every data-fetching view must show skeleton loaders (not spinners) sized to match the real content to prevent layout shift.

---

## ⚡ Optimistic UI (project-wide)

**Every** interactive flow that calls a server action or API and updates visible UI must be optimistic. No exceptions.

### Pattern

1. **Update the UI immediately** on the client when the user acts (toggle, submit, stepper, vote, confirm payment, etc.).
2. **Persist in the background** via server action; on success, rely on `revalidatePath` / `queryClient.invalidateQueries` to converge with the server.
3. **On failure**, roll back **both** local control state **and** any mirrored global UI (e.g. shared lists, counters, badges), and show a clear `toast.error()`.
4. **Client hooks** that mirror server props should **`useEffect`-sync** when props change so post-refresh and rollback stay consistent.
5. Put reusable merge/rollback helpers in **`src/lib/`** (not in `"use client"` files) so Server Components can import counts/utils without crossing the client boundary.

### Existing helpers — always use them:

- `fireAction()` → `src/lib/optimistic-action.ts` — fire-and-forget with auto-retry + rollback + toast.
- `applyMemberVotePatch()` → `src/lib/optimistic-votes.ts` — optimistic vote list patch.

### Scope (non-exhaustive):

- Vote toggles (play / dine / guest count)
- Payment confirmation (member-side & admin-side)
- Undo payment
- Inventory purchase entry
- Stock adjustment
- Session creation / status change
- Attendee check-in
- Settings changes

---

## 💰 Financial Accuracy (CRITICAL)

Money logic in this app controls **real debt** between real people. Bugs cause trust issues and arguments. Treat every financial calculation as **mission-critical**.

### Rules

1. **All monetary values are integers (VND).** Never use floats for money. The database stores integers; keep it that way end-to-end.
2. **Single source of truth for cost calculation:** `src/lib/cost-calculator.ts` (`calculateSessionCosts`). Do NOT duplicate this logic anywhere — not in components, not in API routes, not inline in actions. If you need to preview costs on the client, import and call the same function.
3. **Rounding:** Use `roundToThousand()` from `src/lib/utils.ts` — rounds **up** to the next 1,000 VND (`1K`) for member-facing charges so the admin is not underpaid for court/shuttlecock costs. Never use `Math.round()` on money directly.
4. **Division formula (per-head):**
   - `playCostPerHead = roundToThousand((courtPrice + totalShuttlecockCost) / totalPlayers)`
   - `dineCostPerHead = roundToThousand(diningBill / totalDiners)`
   - Guests count towards the divisor. The member who invited them pays their share.
5. **Validate before persist:** Every server action that writes financial data must:
   - Check session exists and is in valid status.
   - Check amounts are non-negative integers.
   - Recalculate totals server-side (never trust client-sent totals).
6. **Double-entry confirmation:** Debts require both `memberConfirmed` AND `adminConfirmed` before being considered paid. Never auto-confirm both sides.
7. **Idempotent finalization:** `finalizeSession` deletes old attendees/debts before inserting — safe to re-run. Preserve this pattern.
8. **Never silently swallow errors** in financial flows. Always return `{ error: string }` and surface it to the user.

### ⛔ Forbidden in financial code:

- `parseFloat()` or floating-point arithmetic on VND values.
- Client-only calculations that bypass `cost-calculator.ts`.
- Auto-confirming payment without explicit user action.
- Modifying debt records without `revalidatePath` on all affected routes.

---

## 📦 Inventory Accuracy (CRITICAL)

Shuttlecock stock directly impacts session cost calculation and purchasing decisions.

### Stock formula

```
currentStockQua = totalPurchasedQua − totalUsedQua + adjustQua
```

- `totalPurchasedQua = SUM(purchase.tubes) × 12`
- `totalUsedQua = SUM(sessionShuttlecocks.quantityUsed)`
- `adjustQua = shuttlecockBrands.stockAdjustQua` (manual correction delta)

### Rules

1. **Always recalculate stock from source data** (purchases − usage + adjustment). Never store a cached "current stock" column.
2. **Low stock threshold:** `< 12 quả` (1 tube). Flag clearly in UI with a warning badge.
3. **Prevent negative stock on display:** Use `Math.max(0, currentStockQua)` for display, but preserve the real value internally for debugging.
4. **Price snapshot:** `sessionShuttlecocks.pricePerTube` is a snapshot at the time of usage. Don't retroactively update it when brand price changes.
5. **`setStockQua()`** adjusts the delta — it does NOT overwrite purchase/usage records. Preserve this pattern.
6. **Validate `tubes ≥ 1`** on purchase entry. Validate `quantityUsed ≥ 1` on usage entry.

---

## 🎨 Creative Standards & Vibe (Antigravity)

The UI must feel **premium, modern, and alive** — not like a basic CRUD app.

1. **No MVP designs.** Every screen should feel polished. Use glassmorphism, vibrant gradients, smooth rounded corners, and subtle shadows.
2. **Animation:** Always use `framer-motion` for:
   - Page/layout transitions (`AnimatePresence`, `motion.div`)
   - List reordering (`layout` prop)
   - Micro-interactions (button press, card hover, toggle switch)
   - Sheet/drawer slide-in/out
   - Skeleton shimmer effects
3. **Color system:** Use the CSS custom properties defined in `globals.css`. Respect light/dark/pink themes. Never hardcode hex values in components.
4. **Cards over tables** on mobile. Use `backdrop-blur`, `bg-card/80`, and subtle borders for glassmorphism cards.
5. **Feedback on every action:** Loading spinners on buttons, success checkmarks, error shakes. The user must always know what's happening.
6. **Empty states:** Never show a blank page. Design illustrated empty states with a call-to-action.
7. **Typography:** Use the project's font stack (Roboto for vi/en, Geist for zh). Headings should be `font-semibold` or `font-bold` with proper hierarchy.

---

## 🛠 Code Patterns & Conventions

### Data Fetching

- **Server Components** (default): Fetch data directly via `db.query.*` or server actions. No client-side fetching needed.
- **Client Components** that need live data: Use `@tanstack/react-query` (`useQuery`, `useMutation`). **NEVER** use `useEffect` + `fetch`.
- **URL state:** Use `nuqs` for filters, pagination, search — keeps state shareable via URL.
- **Complex client state** (multi-step forms, wizard state): Use `zustand`.

### Forms

- Use `react-hook-form` + `zod` for all forms. Validate on both client (UX) and server (security).

### File structure

```
src/
├── actions/     # Server actions (use server)
├── app/         # Next.js App Router pages & layouts
├── components/  # Reusable UI components
│   └── ui/      # Shadcn base components
├── db/          # Drizzle schema, migrations, seed
├── i18n/        # Translation files
└── lib/         # Pure utilities, calculators, helpers
```

### Naming

- Components: `PascalCase` (`DebtCard.tsx`)
- Server actions: `camelCase` functions (`finalizeSession`)
- Files: `kebab-case` (`cost-calculator.ts`)
- CSS variables: `--kebab-case` (`--color-primary`)

### Git

- Commit messages: **Conventional Commits** format → `type(scope): description`
- Examples: `feat(finance): add debt reminder notification`, `fix(inventory): correct stock calculation rounding`

---

## ⛔ Forbidden Actions

- **No `useEffect` + `fetch`** for data loading. Use TanStack Query or Server Components.
- **No floating-point money.** All VND values are integers.
- **No `SELECT *`** in raw SQL. Use specific columns via Drizzle's query builder.
- **No hardcoded colors.** Use CSS custom properties from the theme.
- **No `any` type.** TypeScript must be strict.
- **No `console.log` in production code.** Use `toast` for user-facing messages, structured logging for server-side.
- **No `force push` to main.**
- **No skipping validation** on server actions. Always validate with Zod before database writes.
