# FWBB - Ung dung Quan ly Nhom Cau Long

## Tai lieu Dac ta Yeu cau Phan mem (SRS)

**Phien ban:** 1.1
**Ngay:** 2026-03-24
**Du an:** FWBB (Fun With BadminBton)

---

## 1. Gioi thieu

### 1.1 Muc dich

FWBB la ung dung web quan ly nhom cau long phong trao (~20 thanh vien). Ung dung xu ly lich choi, vote diem danh, chia tien, quan ly cau ton kho, va quan ly tai chinh cho truong nhom (admin).

### 1.2 Van de

Truong nhom hien tai quan ly thu cong: thu thap vote, tinh tien, theo doi no, quan ly cau. Voi so nguoi tham gia thay doi, khach giao luu, an nhau sau buoi choi voi nhom nguoi khac, nhieu hang cau voi gia khac nhau — tinh toan thu cong de sai va ton thoi gian.

### 1.3 Giai phap

Ung dung web mobile-first:
- Thanh vien vote buoi choi sap toi va xem no cua minh
- Admin quan ly buoi choi, tinh tien, theo doi tai chinh
- He thong tu dong tao buoi choi va tinh chia tien

### 1.4 Pham vi

**Trong pham vi:**
- Tu dong tao buoi choi theo lich co dinh (Thu 2 & Thu 6)
- Vote diem danh (choi cau + an nhau + khach giao luu)
- Chon san va cau cho moi buoi
- Chia tien (san + cau + an)
- Theo doi no va xac nhan thanh toan
- Quan ly cau ton kho
- Thong ke va bieu do
- Da giao dien (Sang/Toi/Hong) va da ngon ngu (Viet/Anh/Trung)

**Ngoai pham vi:**
- Thong bao push / tin nhan tu dong
- Tich hop thanh toan online
- Chat thoi gian thuc
- Cham diem thi dau

---

## 2. Vai tro nguoi dung

### 2.1 Admin (Truong nhom)
- Mot tai khoan admin duy nhat
- Dang nhap bang username + password
- Truy cap day du moi tinh nang quan ly
- Ung tien truoc cho san, cau, an nhau; thu lai tu thanh vien sau buoi choi
- **Admin cung la thanh vien trong bang members.** Co the vote va tham gia nhu thanh vien binh thuong. No cua admin duoc tu dong xac nhan (tu tra cho minh).

### 2.2 Nguoi dung (Thanh vien)
- Khong can dang nhap
- Nhan dien bang cach chon ten tu danh sach admin tao + nhap so dien thoai (lan dau)
- Thong tin luu trong cookie trinh duyet
- Co the vote, xem thong tin buoi choi, xem no ca nhan, xac nhan thanh toan

---

## 3. Yeu cau chuc nang

### 3.1 Nhan dien nguoi dung (FR-01)

**FR-01.1** Luong nguoi dung lan dau:
1. Nguoi dung mo app
2. Chon ten tu danh sach thanh vien (admin tao san)
3. Nhap so dien thoai xac nhan
4. He thong luu member_id + hash so dien thoai vao cookie httpOnly, **ky bang HMAC-SHA256** voi khoa bi mat phia server de chong gia mao
5. Lan sau vao tu nhan dien (cookie duoc xac minh phia server)

**FR-01.2** Cookie het han: 365 ngay. Neu het han, nguoi dung lam lai buoc tren.

**FR-01.3** Neu cookie ton tai nhung thanh vien bi vo hieu hoa, hien thong bao "Lien he admin".

### 3.2 Quan ly buoi choi (FR-02)

**FR-02.1** Tu dong tao: Cron job chay hang ngay luc 00:00 (Asia/Ho_Chi_Minh). Neu ngay mai la Thu 2 hoac Thu 6, tao buoi choi moi voi:
- `date`: ngay mai
- `start_time`: 20:30
- `end_time`: 22:30
- `status`: `voting`
- `court_id`: NULL (admin chon sau)

**FR-02.2** Trang thai buoi choi:
| Trang thai | Mo ta |
|---|---|
| `voting` | Moi tao, thanh vien co the vote |
| `confirmed` | Admin da chon san + cau, buoi choi da xac nhan |
| `completed` | Buoi choi ket thuc, da tinh tien |
| `cancelled` | Admin huy buoi choi |

**FR-02.3** Admin co the:
- Chon/doi san cho buoi choi
- Chon loai cau va so luong su dung (nhieu hang trong 1 buoi)
- Huy buoi choi (status → `cancelled`)
- Ket thuc buoi choi: chot danh sach + tinh tien → status `completed`

**FR-02.4** Vote tu dong mo khi buoi choi duoc tao (status = `voting`).

**FR-02.5** Admin co the huy buoi choi o bat ky trang thai nao truoc `completed`.

**FR-02.6** Chuyen trang thai buoi choi (state machine):
```
voting → confirmed    (admin chon san + cau)
voting → cancelled    (admin huy)
confirmed → completed (admin chot buoi choi)
confirmed → cancelled (admin huy)
```
Khong co chuyen nguoc. `cancelled` va `completed` la trang thai cuoi cung.

**FR-02.7** Copy Link: Moi buoi choi co nut "Copy Link" sao chep URL vote (`/vote/[id]`) vao clipboard. Admin dan vao group chat de thanh vien vote. Hien thi tren ca giao dien user va admin.

### 3.3 Vote (FR-03)

**FR-03.1** Voi moi buoi choi, thanh vien co the vote:
- Co choi cau khong: Co / Khong
- Co di an nhau khong: Co / Khong
- Them khach giao luu choi: so luong (ten la tuy chon luc vote, admin chot sau)
- Them khach giao luu an: so luong (ten la tuy chon luc vote, admin chot sau)

**FR-03.2** Thanh vien co the doi vote bat ky luc nao truoc khi buoi choi chuyen sang `completed`.

**FR-03.3** Quy tac khach giao luu:
- Bat ky thanh vien nao cung co the them khach qua vote
- Admin cung co the them khach truc tiep
- Tien khach tinh cho nguoi moi

**FR-03.4** Trang vote hien thi:
- Ngay, gio buoi choi
- Thong tin san (neu da chon)
- Danh sach tat ca thanh vien voi trang thai vote (da vote co/khong/chua vote)
- Tong so: choi / an / chua vote

### 3.4 Chia tien (FR-04)

**FR-04.1** Sau buoi choi, admin chot danh sach:
- **Danh sach nguoi choi**: khoi tao tu vote (will_play = true) + khach cua ho
- **Danh sach nguoi an**: khoi tao tu vote (will_dine = true) + khach cua ho
- Admin co the them/xoa bat ky ai tu ca 2 danh sach

**FR-04.2** Cong thuc tinh tien:

```
tong_tien_cau = SUM(so_qua_dung_moi_hang × gia_moi_qua_cua_hang)
  trong do gia_moi_qua = gia_moi_ong / 12

tien_choi_moi_nguoi = (gia_san + tong_tien_cau) / tong_so_nguoi_choi
  trong do tong_so_nguoi_choi = thanh_vien_choi + tat_ca_khach_choi

tien_an_moi_nguoi = tong_bill_an / tong_so_nguoi_an
  trong do tong_so_nguoi_an = thanh_vien_an + tat_ca_khach_an

tong_no_thanh_vien =
  (tien_choi_moi_nguoi NEU thanh vien choi, khong thi 0)
  + (tien_an_moi_nguoi NEU thanh vien an, khong thi 0)
  + (tien_choi_moi_nguoi × so_khach_ho_moi_choi)
  + (tien_an_moi_nguoi × so_khach_ho_moi_an)
```

**FR-04.3** So tien lam tron den 1.000 VND gan nhat cho don gian. Chenh lech lam tron (thua/thieu) do admin chiu. Chap nhan duoc voi nhom nho, chenh lech thuong < 10.000 VND moi buoi.

**FR-04.4** Sau khi admin xac nhan, no duoc tao cho tung thanh vien.

**FR-04.5** So luong khach la doc lap. Mot khach vua choi vua an se duoc tinh trong ca `guest_play_count` va `guest_dine_count`. Chi tiet khach (ten, tham gia cu the) duoc chot khi admin ket thuc buoi choi.

### 3.5 Thanh toan & Theo doi no (FR-05)

**FR-05.1** Sau khi buoi choi ket thuc, moi thanh vien co ban ghi no:
- `play_amount`: tien choi cau + san
- `dine_amount`: tien an nhau
- `guest_play_amount`: tien khach choi
- `guest_dine_amount`: tien khach an
- `total_amount`: tong cong

**FR-05.2** Xac nhan thanh toan (2 luong):
- **Luong A**: Thanh vien bam "Da thanh toan" → `member_confirmed = true` → Admin thay thong bao → Admin bam "Xac nhan da nhan" → `admin_confirmed = true` → Het no
- **Luong B**: Admin truc tiep bam "Da nhan tien" → `admin_confirmed = true` → Het no

**FR-05.3** Xem no:
- Thanh vien xem no theo bo loc: tuan / thang / nam / tat ca
- Moi khoan no hien: ngay, chi tiet buoi choi, phan tich (choi/an/khach), trang thai
- Tong no chua thanh toan

**FR-05.4** Dashboard tai chinh Admin:
- Tong no chua thu
- Tong hop no theo thanh vien
- Lich su thanh toan
- Bo loc: tuan / thang / nam / tat ca

### 3.6 Quan ly cau ton kho (FR-06)

**FR-06.1** Don vi: 1 ong = 12 qua cau.

**FR-06.2** Admin nhap mua:
- Chon hang
- So ong
- Gia moi ong
- Ngay mua
- Ghi chu (tuy chon)

**FR-06.3** Moi buoi choi, admin nhap su dung:
- Chon hang cau
- So qua da dung theo tung hang

**FR-06.4** Hien thi ton kho theo hang:
- Ton kho hien tai: X ong Y qua le (vi du: "3 ong 8 qua" = 44 qua)
- Tong ton = SUM(ong_mua × 12) - SUM(qua_dung)

**FR-06.5** Canh bao ton kho thap khi bat ky hang nao duoi nguong cau hinh (mac dinh: 12 qua = 1 ong).

**FR-06.6** Lich su mua va lich su su dung.

### 3.7 Quan ly thanh vien (FR-07)

**FR-07.1** Admin co the:
- Them thanh vien moi (ten, so dien thoai)
- Sua thong tin thanh vien
- Vo hieu hoa thanh vien (xoa mem, giu lich su)
- Xem danh sach thanh vien

**FR-07.2** Danh sach hien thi: ten, so dien thoai, trang thai, tong no chua tra.

### 3.8 Quan ly san (FR-08)

**FR-08.1** Admin co the:
- Them san (ten, dia chi, gia moi buoi)
- Sua thong tin san
- Vo hieu hoa san

**FR-08.2** Danh sach san hien thi: ten, dia chi, gia, trang thai.

### 3.9 Quan ly hang cau (FR-09)

**FR-09.1** Admin co the:
- Them hang (ten, gia moi ong)
- Sua thong tin hang
- Vo hieu hoa hang

**FR-09.2** Danh sach hang hien thi: ten, gia moi ong, ton kho hien tai, trang thai.

### 3.10 Thong ke & Bieu do (FR-10)

**FR-10.1** Bieu do thanh vien tich cuc:
- Top thanh vien theo so buoi choi cau
- Top thanh vien theo so buoi an nhau
- Top thanh vien theo ca hai
- Bo loc khoang thoi gian

**FR-10.2** Bieu do chi phi hang thang:
- Tien san theo thang
- Tien cau theo thang
- Tien an theo thang
- Tong cong theo thang
- Bieu do cot hoac duong, co the chon

**FR-10.3** Bieu do diem danh:
- So nguoi choi theo tung buoi (bieu do duong/cot theo thoi gian)
- Xu huong trung binh

**FR-10.4** Tat ca bieu do ho tro bo loc khoang thoi gian.

### 3.11 Xac thuc Admin (FR-11)

**FR-11.1** Mot tai khoan admin duy nhat, khoi tao san trong database.

**FR-11.2** Dang nhap: username + password → xac minh voi bcrypt hash → cap JWT trong cookie httpOnly (het han 7 ngay).

**FR-11.3** Tat ca route `/admin/*` duoc bao ve boi middleware kiem tra JWT.

**FR-11.4** Dang xuat: xoa cookie JWT.

**FR-11.5** Admin co the doi mat khau tu cai dat.

---

## 4. Yeu cau phi chuc nang

### 4.1 Hieu nang (NFR-01)
- First Contentful Paint < 2 giay tren 3G mobile (trang SSR)
- Time to Interactive < 4 giay tren 3G mobile (trang nhieu bieu do co the cao hon)
- Server Actions phan hoi < 500ms
- Truy van database < 100ms (Turso edge)

### 4.2 Thiet ke Responsive (NFR-02)
- **Mobile** (< 640px): 1 cot, thanh dieu huong duoi, than thien cam ung (44px min tap targets)
- **Tablet** (640-1024px): 2 cot, sidebar co the thu gon
- **Desktop** (> 1024px): Sidebar co dinh + vung noi dung
- Tiep can mobile-first

### 4.3 Giao dien (NFR-03)

Ba giao dien voi CSS custom properties:

| Token | Sang (Light) | Toi (Dark) | Hong (Pink) |
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

Giao dien Hong co them: border-radius lon hon (12px), font weight mem hon, icon kieu de thuong.

### 4.4 Da ngon ngu (NFR-04)
- Tieng Viet (mac dinh), Tieng Anh, Tieng Trung
- Chon ngon ngu o header, luu vao cookie
- Tat ca text UI nam trong file JSON dich
- Dinh dang ngay/so theo dia phuong (vi du: dinh dang VND)

### 4.5 Bao mat (NFR-05)
- Mat khau admin hash bang bcrypt (cost factor 12)
- JWT token trong cookie httpOnly, secure, sameSite
- Tat ca Server Actions validate input bang Zod schema
- Cookie nguoi dung: member_id + hash SDT, **ky bang HMAC-SHA256** dung `USER_COOKIE_SECRET` chong gia mao
- Khong luu du lieu nhay cam phia client

### 4.6 Tiep can (NFR-06)
- Component shadcn/ui tuan thu WAI-ARIA
- Dieu huong bang ban phim
- Ti le tuong phan mau >= 4.5:1 (WCAG AA)
- Chi bao focus hien thi ro

### 4.7 Chat luong code (NFR-07)
- TypeScript strict mode
- ESLint + Prettier
- Drizzle migrations cho thay doi schema
- Zod validation tren moi input
- Quy uoc dat ten file/folder nhat quan

---

## 5. Kien truc ky thuat

### 5.1 Cong nghe su dung

| Tang | Cong nghe | Muc dich |
|---|---|---|
| Framework | Next.js 14+ (App Router) | SSR, Server Actions, API Routes |
| UI | shadcn/ui + Tailwind CSS v4 | Thu vien component + CSS tien ich |
| Giao dien | next-themes | Chuyen doi giao dien (sang/toi/hong) |
| Da ngon ngu | next-intl | Ho tro nhieu ngon ngu |
| ORM | Drizzle ORM | Truy cap database type-safe |
| Database | Turso (libSQL/SQLite) | SQLite tren cloud |
| Xac thuc | jose (JWT) | Xac thuc admin |
| Bieu do | Recharts | Truc quan hoa du lieu |
| Form | React Hook Form + Zod | Xu ly form + validation |
| Ngay | date-fns | Xu ly ngay thang |
| URL State | nuqs | Quan ly trang thai search params |
| Deploy | Vercel | Hosting + Cron Jobs |

### 5.2 Cau truc du an

```
fwbb/
├── public/
│   └── locales/           # Tai nguyen tinh
├── src/
│   ├── app/
│   │   ├── (public)/              # Trang nguoi dung (khong can auth)
│   │   │   ├── page.tsx           # Trang chu - buoi tiep theo + vote
│   │   │   ├── vote/[id]/
│   │   │   │   └── page.tsx       # Vote cho buoi cu the
│   │   │   ├── history/
│   │   │   │   └── page.tsx       # Lich su buoi choi
│   │   │   ├── my-debts/
│   │   │   │   └── page.tsx       # Xem no ca nhan
│   │   │   ├── me/
│   │   │   │   └── page.tsx       # Ho so + cai dat (theme/ngon ngu)
│   │   │   └── layout.tsx         # Layout cong khai (thanh dieu huong duoi)
│   │   ├── (admin)/               # Trang admin (can auth)
│   │   │   ├── admin/
│   │   │   │   ├── login/
│   │   │   │   │   └── page.tsx   # Dang nhap admin
│   │   │   │   ├── dashboard/
│   │   │   │   │   └── page.tsx   # Tong quan admin
│   │   │   │   ├── sessions/
│   │   │   │   │   ├── page.tsx   # Danh sach buoi choi
│   │   │   │   │   └── [id]/
│   │   │   │   │       └── page.tsx # Chi tiet + chot buoi choi
│   │   │   │   ├── members/
│   │   │   │   │   └── page.tsx   # Quan ly thanh vien
│   │   │   │   ├── inventory/
│   │   │   │   │   └── page.tsx   # Quan ly cau ton kho
│   │   │   │   ├── finance/
│   │   │   │   │   └── page.tsx   # Quan ly tai chinh + no
│   │   │   │   ├── stats/
│   │   │   │   │   └── page.tsx   # Thong ke + bieu do
│   │   │   │   ├── courts/
│   │   │   │   │   └── page.tsx   # Quan ly san
│   │   │   │   └── shuttlecocks/
│   │   │   │       └── page.tsx   # Quan ly hang cau
│   │   │   └── layout.tsx         # Layout admin (sidebar)
│   │   ├── api/
│   │   │   └── cron/
│   │   │       └── create-session/
│   │   │           └── route.ts   # Tu dong tao buoi choi
│   │   ├── layout.tsx             # Root layout (theme + i18n providers)
│   │   └── globals.css            # Style toan cuc + theme tokens
│   ├── actions/                   # Server Actions
│   │   ├── auth.ts                # Dang nhap/dang xuat
│   │   ├── sessions.ts            # CRUD buoi choi
│   │   ├── votes.ts               # Xu ly vote
│   │   ├── members.ts             # CRUD thanh vien
│   │   ├── courts.ts              # CRUD san
│   │   ├── shuttlecocks.ts        # CRUD hang cau
│   │   ├── inventory.ts           # Mua + su dung
│   │   ├── finance.ts             # No + thanh toan
│   │   └── stats.ts               # Truy van thong ke
│   ├── db/
│   │   ├── index.ts               # Drizzle client (Turso)
│   │   ├── schema.ts              # Dinh nghia bang Drizzle
│   │   └── migrations/            # SQL migrations
│   ├── components/
│   │   ├── ui/                    # Component shadcn/ui
│   │   ├── layout/                # Header, Sidebar, BottomNav
│   │   ├── sessions/              # Component buoi choi
│   │   ├── vote/                  # Component vote
│   │   ├── finance/               # Component tai chinh
│   │   ├── inventory/             # Component ton kho
│   │   ├── stats/                 # Component bieu do
│   │   └── shared/                # Component dung chung
│   ├── lib/
│   │   ├── auth.ts                # Tien ich JWT
│   │   ├── utils.ts               # Tien ich chung
│   │   ├── cost-calculator.ts     # Logic chia tien
│   │   └── validators.ts          # Zod schemas
│   ├── i18n/
│   │   ├── config.ts              # Cau hinh next-intl
│   │   └── messages/
│   │       ├── vi.json            # Tieng Viet
│   │       ├── en.json            # Tieng Anh
│   │       └── zh.json            # Tieng Trung
│   ├── hooks/                     # Custom React hooks
│   └── types/                     # Dinh nghia TypeScript types
├── drizzle.config.ts              # Cau hinh Drizzle
├── next.config.ts                 # Cau hinh Next.js
├── tailwind.config.ts             # Cau hinh Tailwind
├── vercel.json                    # Cau hinh Vercel cron
├── .env.local                     # Bien moi truong (local)
├── package.json
└── tsconfig.json
```

### 5.3 Database Schema (Drizzle)

```typescript
// db/schema.ts

// ===== ADMIN =====
admins {
  id            integer    PK autoincrement
  username      text       NOT NULL UNIQUE
  password_hash text       NOT NULL
  created_at    text       DEFAULT current_timestamp
}

// ===== THANH VIEN =====
members {
  id            integer    PK autoincrement
  name          text       NOT NULL
  phone         text       NOT NULL UNIQUE
  is_active     integer    DEFAULT 1 (boolean)
  created_at    text       DEFAULT current_timestamp
}

// ===== SAN CAU LONG =====
courts {
  id                integer    PK autoincrement
  name              text       NOT NULL
  address           text
  price_per_session integer    NOT NULL  -- VND
  is_active         integer    DEFAULT 1
}

// ===== HANG CAU =====
shuttlecock_brands {
  id             integer    PK autoincrement
  name           text       NOT NULL
  price_per_tube integer    NOT NULL  -- VND
  is_active      integer    DEFAULT 1
}

// ===== BUOI CHOI =====
sessions {
  id            integer    PK autoincrement
  date          text       NOT NULL  -- ISO date YYYY-MM-DD
  start_time    text       DEFAULT '20:30'
  end_time      text       DEFAULT '22:30'
  court_id      integer    FK → courts (nullable)
  court_price   integer    -- snapshot gia san luc chon (VND)
  status        text       DEFAULT 'voting'
                           CHECK (status IN ('voting','confirmed','completed','cancelled'))
  dining_bill   integer    -- tong bill an nhau VND (nullable)
  notes         text
  created_at    text       DEFAULT current_timestamp
  updated_at    text       DEFAULT current_timestamp
}
INDEX idx_sessions_date ON sessions(date)

// ===== VOTE =====
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

// ===== NGUOI THAM GIA BUOI CHOI (admin chot) =====
session_attendees {
  id              integer    PK autoincrement
  session_id      integer    FK → sessions NOT NULL
  member_id       integer    FK → members (nullable, NULL cho khach)
  guest_name      text       -- ten khach giao luu
  invited_by_id   integer    FK → members (nullable, NULL neu la thanh vien)
  is_guest        integer    DEFAULT 0 (boolean)
  attends_play    integer    DEFAULT 0 (boolean)
  attends_dine    integer    DEFAULT 0 (boolean)
}

// ===== CAU SU DUNG TRONG BUOI CHOI =====
session_shuttlecocks {
  id              integer    PK autoincrement
  session_id      integer    FK → sessions NOT NULL
  brand_id        integer    FK → shuttlecock_brands NOT NULL
  quantity_used   integer    NOT NULL  -- tinh bang qua
  price_per_tube  integer    NOT NULL  -- snapshot gia hang luc dung (VND)
}

// ===== NHAP MUA CAU =====
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

// ===== NO THEO BUOI CHOI =====
session_debts {
  id                  integer    PK autoincrement
  session_id          integer    FK → sessions NOT NULL
  member_id           integer    FK → members NOT NULL
  play_amount         integer    DEFAULT 0  -- VND (tien choi cau + san)
  dine_amount         integer    DEFAULT 0  -- VND (tien an nhau)
  guest_play_amount   integer    DEFAULT 0  -- VND (tien khach choi)
  guest_dine_amount   integer    DEFAULT 0  -- VND (tien khach an)
  total_amount        integer    NOT NULL    -- VND (tong no)
  member_confirmed    integer    DEFAULT 0 (boolean)
  member_confirmed_at text
  admin_confirmed     integer    DEFAULT 0 (boolean)
  admin_confirmed_at  text
  updated_at          text       DEFAULT current_timestamp
  UNIQUE(session_id, member_id)
}
INDEX idx_debts_member ON session_debts(member_id, admin_confirmed)
```

### 5.4 Quan he giua cac bang

```
admins          (doc lap, 1 ban ghi duy nhat)

members ──1:N── votes
members ──1:N── session_attendees
members ──1:N── session_debts
members ──1:N── session_attendees (nguoi moi khach)

courts ──1:N── sessions

shuttlecock_brands ──1:N── session_shuttlecocks
shuttlecock_brands ──1:N── inventory_purchases

sessions ──1:N── votes
sessions ──1:N── session_attendees
sessions ──1:N── session_shuttlecocks
sessions ──1:N── session_debts
sessions ──N:1── courts
```

### 5.5 Thuat toan tinh tien

```
function tinhTienBuoiChoi(session):
  // 1. Lay danh sach nguoi tham gia
  nguoi_choi = attendees WHERE attends_play = true
  nguoi_an = attendees WHERE attends_dine = true

  // 2. Tinh tien moi dau nguoi (dung gia snapshot)
  gia_san = session.court_price  // snapshot luc chon san
  tien_cau = SUM(
    VOI MOI session_shuttlecock:
      so_qua_dung × (session_shuttlecock.price_per_tube / 12)  // gia snapshot
  )
  tien_choi_moi_nguoi = (gia_san + tien_cau) / COUNT(nguoi_choi)
  tien_an_moi_nguoi = session.dining_bill / COUNT(nguoi_an)

  // 3. Lam tron den 1.000 VND gan nhat
  tien_choi_moi_nguoi = ROUND(tien_choi_moi_nguoi / 1000) × 1000
  tien_an_moi_nguoi = ROUND(tien_an_moi_nguoi / 1000) × 1000

  // 4. Tinh no cho tung thanh vien
  VOI MOI thanh_vien IN danh_sach_thanh_vien(attendees):
    co_choi = thanh_vien IN nguoi_choi (khong phai khach)
    co_an = thanh_vien IN nguoi_an (khong phai khach)
    so_khach_choi = COUNT(nguoi_choi WHERE invited_by = thanh_vien)
    so_khach_an = COUNT(nguoi_an WHERE invited_by = thanh_vien)

    no = {
      play_amount: co_choi ? tien_choi_moi_nguoi : 0,
      dine_amount: co_an ? tien_an_moi_nguoi : 0,
      guest_play_amount: so_khach_choi × tien_choi_moi_nguoi,
      guest_dine_amount: so_khach_an × tien_an_moi_nguoi,
      total: TONG cac muc tren
    }
    INSERT session_debts(no)
```

### 5.6 Cron Job: Tu dong tao buoi choi

```
Endpoint: /api/cron/create-session
Lich: 0 17 * * * (hang ngay luc 17:00 UTC = 00:00 UTC+7)
Xac thuc: Vercel cron secret header

Logic:
  ngay_mai = hom_nay + 1 ngay
  thu_trong_tuan = ngay_mai.getDay()

  NEU thu_trong_tuan === 1 (Thu 2) HOAC thu_trong_tuan === 5 (Thu 6):
    NEU KHONG TON TAI session WHERE date = ngay_mai:
      INSERT session(date=ngay_mai, status='voting')

Ghi chu: Buoi choi duoc tao ~21 gio truoc gio bat dau (00:00 → 20:30).
Day la du cho nhom nho (~20 nguoi) giao tiep qua group chat.
Admin chia link vote sau khi buoi choi duoc tao.
```

### 5.7 Luong xac thuc

```
Dang nhap Admin:
  POST username + password
  → bcrypt.compare(password, stored_hash)
  → NEU khop: ky JWT { sub: admin_id, role: 'admin' }
  → Dat cookie httpOnly (7 ngay)

Middleware Admin:
  Moi request /admin/*
  → Doc JWT tu cookie
  → Xac minh bang jose
  → NEU khong hop le/het han: chuyen huong ve /admin/login

Nhan dien nguoi dung:
  Lan dau:
  → Chon ten tu danh sach thanh vien
  → Nhap so dien thoai
  → Server xac minh SDT khop voi ban ghi thanh vien
  → Dat cookie: { member_id, phone_hash } ky HMAC (365 ngay)

  Lan sau:
  → Doc cookie → tra cuu thanh vien → da nhan dien
```

---

## 6. Dac ta UI/UX

### 6.1 Nguyen tac thiet ke
- **Mobile-first**: Thiet ke cho dien thoai truoc, mo rong sau
- **De thuong & Hien dai**: Bo goc tron, bong do mem, mau sac vui tuoi (dac biet giao dien Hong)
- **Don gian**: It thao tac nhat de hoan thanh hanh dong
- **Phan cap ro rang**: Thong tin quan trong (buoi tiep theo, no) luon hien thi

### 6.2 He thong giao dien

Ba giao dien quan ly bang `next-themes` + CSS custom properties:

**Che do Sang**: Sach se, chuyen nghiep. Nen trang, diem nhan indigo.
**Che do Toi**: Nen slate, diem nhan indigo nhat hon. De nhin.
**Che do Hong**: Nen hong nhat, diem nhan hong, bo goc lon hon (12px), trang tri emoji de thuong.

Chuyen doi giao dien o header: nut bam icon (mat troi/trang/trai tim).

### 6.3 Layout Responsive

**Dien thoai (< 640px)**:
- Layout 1 cot
- Thanh dieu huong duoi (4 tab: Trang chu, Lich su, No, Toi)
- The card xep doc
- Admin: menu hamburger → nav toan man hinh

**Tablet (640-1024px)**:
- 2 cot khi phu hop
- Thanh dieu huong duoi cho trang user
- Sidebar co the thu gon cho trang admin

**Desktop (> 1024px)**:
- Admin: sidebar co dinh ben trai (240px) + vung noi dung
- User: noi dung can giua (max-width 640px)

### 6.4 Dac ta trang

#### 6.4.1 Trang chu (`/`)

**Muc dich**: Hien buoi choi sap toi, cho phep vote

**Layout**:
```
[Header: Logo | Chon ngon ngu | Chuyen giao dien]

[The buoi choi tiep theo]
  - Ngay & thu
  - Gio (20:30 - 22:30)
  - Ten san + gia (neu da chon, khong thi "Chua chon san")
  - So nguoi vote / tong thanh vien

  [Nut Vote]
  - "Di choi" / "Khong di" (toggle, highlight khi active)
  - "Di an"  / "Khong an" (toggle, highlight khi active)
  - "+ Them khach giao luu" (form mo rong)

[Danh sach vote]
  - Nhom: Di / Khong di / Chua vote
  - Moi dong: Avatar/chu cai + Ten + icon (vot/bia)
  - So khach hien inline

[Tom tat no nhanh]
  - Tong no chua tra
  - Link "Xem chi tiet →"

[Thanh dieu huong duoi]
```

#### 6.4.2 Trang Vote (`/vote/[id]`)

**Muc dich**: Vote cho buoi cu the (deep link tu group chat)

**Layout**: Giong trang chu nhung cho buoi cu the. Cung hien buoi da qua.

#### 6.4.3 Trang Lich su (`/history`)

**Muc dich**: Xem lich su buoi choi da qua

**Layout**:
```
[Header]

[Danh sach buoi choi - moi nhat truoc]
  Moi the:
  - Ngay + thu
  - Ten san
  - So nguoi choi + so nguoi an
  - Tong chi phi
  - Badge trang thai (da xong/da huy)
  - Bam mo rong: danh sach nguoi tham gia, chi tiet tien

[Thanh dieu huong duoi]
```

#### 6.4.4 Trang Ca nhan (`/me`)

**Muc dich**: Ho so nguoi dung va cai dat

**Layout**:
```
[Header]

[The ho so]
  - Ten + SDT (tu cookie)
  - Link "Doi nguoi dung" (reset cookie, chon lai)

[Cai dat]
  - Chuyen giao dien: Sang / Toi / Hong
  - Ngon ngu: VI / EN / ZH

[Thong ke nhanh]
  - Tong so buoi da choi
  - Tong so buoi da an nhau
  - Tong tien da chi (tat ca)

[Thanh dieu huong duoi]
```

#### 6.4.5 Trang No cua toi (`/my-debts`)

**Muc dich**: Xem lich su no ca nhan

**Layout**:
```
[Header]

[Tab bo loc: Tuan | Thang | Nam | Tat ca]

[Banner tong no: "Ban dang no: 450.000d"]

[Danh sach no - moi nhat truoc]
  Moi the:
  - Ngay + ten san
  - Chi tiet: Tien choi: 85k | Tien an: 120k | Khach: 85k
  - Tong: 290.000d
  - Badge trang thai: "Chua tra" / "Cho xac nhan" / "Da thanh toan"
  - [Nut: "Da thanh toan"] (neu chua tra)

[Thanh dieu huong duoi]
```

#### 6.4.6 Dashboard Admin (`/admin/dashboard`)

**Muc dich**: Tong quan tinh hinh nhom

**Layout**:
```
[Sidebar] | [Noi dung]

[Hang the thong ke]
  - Tong no chua thu
  - Ton kho cau (canh bao hang thap nhat)
  - Thanh vien hoat dong
  - So buoi choi thang nay

[The buoi choi sap toi]
  - Thao tac nhanh: Chon san, Chon cau

[Hoat dong gan day]
  - Vote moi nhat
  - Thanh toan da xac nhan gan day

[Lien ket nhanh]
  - Quan ly buoi tiep theo
  - Xem tai chinh
```

#### 6.4.7 Chi tiet buoi choi Admin (`/admin/sessions/[id]`)

**Muc dich**: Quan ly tung buoi choi

**Theo trang thai buoi choi**:

**Trang thai Voting**:
- Xem danh sach vote
- Chon san (dropdown)
- Chon cau (multi-select hang + so luong)
- Nut huy buoi choi

**Trang thai Confirmed**:
- Tat ca tren + sua
- Bam "Ket thuc buoi choi" → mo luong chot

**Luong chot buoi choi** (modal/trang):
1. Xem/sua danh sach nguoi choi (checkbox, them/xoa, them khach)
2. Xem/sua danh sach nguoi an (checkbox, them/xoa, them khach)
3. Xac nhan so cau da dung
4. Nhap tong bill an nhau
5. Xem truoc chia tien (moi dau nguoi + moi thanh vien)
6. Xac nhan → tao no → status = completed

**Trang thai Completed**:
- Tom tat chi doc
- Bang chia tien
- Trang thai thanh toan tung thanh vien

#### 6.4.8 Tai chinh Admin (`/admin/finance`)

**Muc dich**: Theo doi tat ca no va thanh toan

**Layout**:
```
[Bo loc: Tuan | Thang | Nam | Tat ca]

[The tom tat]
  - Tong no chua thu
  - Tong da thu ky nay
  - Tong chi phi ky nay

[Bang no]
  Cot: Thanh vien | Ngay buoi choi | So tien | Trang thai | Thao tac
  Trang thai: Chua tra / TV da xac nhan / Da thu
  Thao tac: Nut "Xac nhan da nhan"

[Tab tong hop thanh vien]
  Moi thanh vien:
  - Ten
  - Tong no
  - Chi tiet da tra / chua tra
```

#### 6.4.9 Thong ke Admin (`/admin/stats`)

**Muc dich**: Bieu do va thong ke

**Bieu do**:
1. **Thanh vien tich cuc** (bieu do cot ngang)
   - Chuyen doi: Choi / An / Ca hai
   - Top 10 thanh vien theo so buoi

2. **Chi phi hang thang** (bieu do cot chong)
   - Danh muc: San / Cau / An nhau
   - Truc X: thang, Truc Y: VND

3. **Xu huong diem danh** (bieu do duong)
   - So nguoi choi theo tung buoi
   - Duong trung binh dong

4. **Bo loc khoang thoi gian** ap dung cho tat ca bieu do

#### 6.4.10 Ton kho cau Admin (`/admin/inventory`)

**Muc dich**: Quan ly ton kho cau

**Layout**:
```
[The tom tat ton kho - theo hang]
  Ten hang | Ton: 3 ong 8 qua (44 qua) | Chi bao trang thai

[Tab: Nhap mua | Su dung]

Tab Nhap mua:
  [+ Nhap mua] nut → form: hang, so ong, gia, ngay
  Bang lich su mua

Tab Su dung:
  Bang su dung theo buoi: ngay, hang, so luong dung
```

---

## 7. Trien khai

### 7.1 Cau hinh Vercel

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

Ghi chu: `0 17 * * *` = 17:00 UTC = 00:00 UTC+7 (gio Viet Nam).
Yeu cau Vercel Hobby plan (mien phi, ho tro 2 cron hang ngay — du cho du an nay).

### 7.2 Bien moi truong

```
TURSO_DATABASE_URL=libsql://fwbb-xxx.turso.io
TURSO_AUTH_TOKEN=eyJhbGciOi...
JWT_SECRET=<random-32-byte-hex>
USER_COOKIE_SECRET=<random-32-byte-hex>
CRON_SECRET=<vercel-cron-secret>
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<bcrypt-hash>
```

### 7.3 Phat trien local

```bash
# Cai dat dependencies
pnpm install

# Thiet lap SQLite local
cp .env.example .env.local
# Sua .env.local: TURSO_DATABASE_URL=file:local.db

# Chay migrations
pnpm db:migrate

# Khoi tao tai khoan admin
pnpm db:seed

# Khoi dong dev server
pnpm dev
```

---

## 8. Tu dien thuat ngu

| Thuat ngu | Tieng Viet | Mo ta |
|---|---|---|
| Session | Buoi choi | Mot buoi choi cau long theo lich |
| Vote | Binh chon | Thanh vien tuyen bo co di choi khong |
| Guest | Khach giao luu | Nguoi ngoai nhom duoc thanh vien moi |
| Debt | Du no | So tien thanh vien no sau buoi choi |
| Court | San cau long | Dia diem san choi |
| Shuttlecock | Qua cau | Qua cau long |
| Tube | Ong cau | Ong cau 12 qua |
| Dining | An nhau | An uong sau buoi choi |
| Admin | Truong nhom | Nguoi quan ly moi thu |
