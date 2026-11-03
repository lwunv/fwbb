# FWBB

Ứng dụng quản lý nhóm cầu lông: buổi chơi, vote, chia tiền, quỹ chung, công nợ và
tồn kho cầu. Thành viên dùng chủ yếu trên điện thoại (trình duyệt trong Zalo/
Messenger); admin quản lý buổi, tiền và kho.

## Stack

| Tầng          | Công cụ                                     |
| ------------- | ------------------------------------------- |
| Framework     | Next.js 16 (App Router) + React 19          |
| Style         | Tailwind CSS v4 + Shadcn UI                 |
| Database      | Drizzle ORM + Turso (SQLite)                |
| Data (client) | TanStack Query · state: Zustand · URL: nuqs |
| Form          | react-hook-form + zod                       |
| i18n          | next-intl                                   |

## Chạy local

```bash
npm install
npm run dev     # http://localhost:3000
```

> ⚠️ **`.env.local` trỏ database PRODUCTION.** Đừng chạy `db:push`, `db:seed` hay
> `db:clone-local`, chúng sẽ phá dữ liệu thật. Test local dùng database file
> `e2e/local.db`.

## Cổng kiểm trước khi commit

Chạy đủ bốn cổng tới exit 0 trước khi báo "xong":

```bash
npx tsc -b           # typecheck đầy đủ (KHÁC tsc -p)
npx eslint .         # lint
npx vitest run       # unit + integration
npm run build        # build production
```

## Tài liệu

| File                                                               | Nội dung                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [AGENTS.md](./AGENTS.md)                                           | Hợp đồng kiến trúc: quy tắc bắt buộc về tiền, kho, mobile-first, optimistic UI |
| [docs/database.md](./docs/database.md)                             | Logic tầng dữ liệu: bảng, sổ cái tiền, tính tiền buổi, vòng đời buổi, tồn kho  |
| [docs/backup-restore.md](./docs/backup-restore.md)                 | Sao lưu, khôi phục, bản dự phòng, tự chuyển database                           |
| [docs/SECURITY-API-CHECKLIST.md](./docs/SECURITY-API-CHECKLIST.md) | Audit bảo mật từng endpoint                                                    |
| [docs/fb-integration-guide.md](./docs/fb-integration-guide.md)     | Đăng nhập Facebook và Messenger API                                            |

## Điều phải nhớ

- **Tiền là integer VND**, không bao giờ dùng float. `src/lib/cost-calculator.ts`
  là nguồn tính tiền duy nhất; làm tròn bằng `roundToThousand` (tròn lên 1K).
- **Số dư member suy ra từ sổ cái** `financial_transactions`, không lưu cột nào.
  Sửa tiền = ghi dòng mới (reversal), không xoá/sửa tại chỗ.
- **Tồn kho tính lại từ nguồn**, không cache. Xem [docs/database.md](./docs/database.md).
- Mọi flow tương tác là **optimistic UI**; thiết kế **mobile-first**.

## Deploy

Push lên `main` KHÔNG tự deploy. Dùng `npx vercel --prod --yes`. Domain:
`https://lwcifer.io.vn`.
