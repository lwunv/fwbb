# FWBB - Badminton Club Management

A web application for managing a recreational badminton club. Handles session scheduling, attendance voting, cost splitting, shuttlecock inventory tracking, and financial management.

## Tech Stack

- **Framework**: Next.js 14+ (App Router + Server Actions)
- **UI**: shadcn/ui + Tailwind CSS
- **Database**: Turso (libSQL/SQLite)
- **ORM**: Drizzle ORM
- **Auth**: JWT (jose)
- **Charts**: Recharts
- **Deploy**: Vercel

## Features

- Auto-created sessions (Monday & Friday, 20:30-22:30)
- Member voting (play + dine + guests)
- Cost splitting (court + shuttlecock + dining)
- Debt tracking with payment confirmation
- Shuttlecock inventory management
- Statistics & charts
- 3 themes: Light / Dark / Pink
- 3 languages: Vietnamese / English / Chinese
- Mobile-first responsive design

## Getting Started

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Documentation

- [SRS / Design Spec](docs/superpowers/specs/2026-03-24-fwbb-design.md)
