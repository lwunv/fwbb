// @vitest-environment jsdom
/**
 * Bug user báo 21/9/2026: "xóa rồi sao vẫn 43/43, không giảm?".
 *
 * Số trên chip lọc KHÔNG bằng số dòng mà tab đó hiện ra. Cụ thể chip "Tất cả"
 * loại "ghost" (người chưa từng đi chơi và không nằm trong roster quỹ) khỏi
 * phép đếm, trong khi tab "Tất cả" vẫn liệt kê họ ở cuối danh sách. Trên prod:
 * 47 người trong danh sách, chip ghi 43. Xoá đúng một ghost thì danh sách ngắn
 * đi mà con số đứng im, nhìn y như xoá không ăn.
 *
 * Bất biến được khoá ở đây: **số trên mỗi chip = số dòng tab đó hiện ra.**
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { ConfirmProvider } from "@/components/shared/confirm-provider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InferSelectModel } from "drizzle-orm";
import type { members as membersTable } from "@/db/schema";

vi.mock("@/actions/members", () => ({
  toggleMemberActive: vi.fn(async () => ({ success: true })),
  deleteMember: vi.fn(async () => ({ success: true })),
  createMember: vi.fn(async () => ({ success: true })),
  updateMemberInfo: vi.fn(async () => ({ success: true })),
  resetMemberPassword: vi.fn(async () => ({ success: true })),
  setMemberAsAdmin: vi.fn(async () => ({ success: true })),
  unlinkAdminMember: vi.fn(async () => ({ success: true })),
  findDuplicateMembers: vi.fn(async () => []),
  mergeMembers: vi.fn(async () => ({ success: true })),
  ignoreDuplicateGroup: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/actions/finance", () => ({
  confirmPaymentByAdmin: vi.fn(async () => ({ success: true })),
  undoPaymentByAdmin: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/actions/fund", () => ({
  adjustMemberFund: vi.fn(async () => ({ success: true })),
}));
// `MemberPlayHistorySheet` kéo theo `@/actions/member-history` → `@/db`, và
// `@/db` dựng client libsql ngay lúc import (đọc TURSO_DATABASE_URL). Test
// component không có env đó và cũng không nên chạm DB, nên chặn ở đây.
vi.mock("@/actions/member-history", () => ({
  getMemberPlayHistory: vi.fn(async () => []),
}));
vi.mock("@/db", () => ({ db: {} }));
// Component gọi useRouter; ngoài app router thật thì nó ném "invariant
// expected app router to be mounted".
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/admin/members",
  useSearchParams: () => new URLSearchParams(),
}));

const { MemberList } = await import("./member-list");

type Member = InferSelectModel<typeof membersTable>;

function member(id: number, name: string, isActive = true): Member {
  return {
    id,
    name,
    nickname: null,
    avatarKey: null,
    facebookId: null,
    googleId: null,
    avatarUrl: null,
    email: null,
    passwordHash: null,
    phoneNumber: null,
    username: null,
    passwordResetExpiresAt: null,
    mustChangePassword: false,
    bankAccountNo: null,
    approvalStatus: "approved",
    approvedAt: null,
    approvedBy: null,
    isActive,
    gender: null,
    defaultWithPartner: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Đọc con số in trên một chip lọc. */
function chipCount(label: string): number {
  const tab = screen.getByRole("tab", { name: new RegExp(`^${label}`) });
  const text = tab.textContent ?? "";
  const m = text.match(/(\d+)\s*$/);
  if (!m) throw new Error(`chip "${label}" không có số: "${text}"`);
  return Number(m[1]);
}

// jsdom không có matchMedia, mà `useIsMobile` gọi nó trong effect.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

afterEach(cleanup);

/**
 * 4 người:
 * - Anh, Bình: đã từng chơi + trong roster quỹ → người bình thường
 * - Ghost: chưa từng chơi, KHÔNG trong roster → ghost (hiện ở "Tất cả", ẩn ở
 *   các tab cụ thể)
 * - Khoá: đã vô hiệu hóa → chỉ hiện ở tab "Đã khóa"
 */
function renderList() {
  const rows = [
    member(1, "Anh"),
    member(2, "Bình"),
    member(3, "Ghost"),
    member(4, "Khoá", false),
  ];
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <ConfirmProvider>
          <MemberList
            members={rows}
            fundMemberIds={[1, 2]}
            playStats={{
              1: {
                recent30Play: 2,
                yearPlay: 10,
                lastPlayedDate: "2026-09-01",
              },
              2: { recent30Play: 1, yearPlay: 5, lastPlayedDate: "2026-09-10" },
            }}
          />
        </ConfirmProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("chip lọc ở trang thành viên", () => {
  it('chip "Tất cả" đếm ĐÚNG số dòng nó hiện, ghost cũng phải tính', () => {
    renderList();
    // 3 người còn trong nhóm (Anh, Bình, Ghost). Người đã khoá không nằm đây.
    expect(chipCount("Tất cả")).toBe(3);
    // Tên hiện ở CẢ thẻ mobile lẫn bảng desktop nên dùng getAllByText.
    expect(screen.getAllByText("Anh").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bình").length).toBeGreaterThan(0);
    // Ghost PHẢI hiện ở tab "Tất cả" — và vì nó hiện thì nó phải được đếm.
    expect(screen.getAllByText("Ghost").length).toBeGreaterThan(0);
    // Người đã vô hiệu hóa thì không.
    expect(screen.queryAllByText("Khoá")).toHaveLength(0);
  });

  it('chip "Hoạt động" trừ ghost ra, khớp với việc tab đó ẩn ghost', () => {
    renderList();
    expect(chipCount("Hoạt động")).toBe(2);
  });

  it('chip "Đã khóa" đếm đúng người đã vô hiệu hóa', () => {
    renderList();
    expect(chipCount("Đã khóa")).toBe(1);
  });

  it('"Tất cả" và "Hoạt động" KHÔNG được là cùng một con số khi có ghost', () => {
    renderList();
    // Hai chip bằng nhau nghĩa là một trong hai đang đếm sai: sau khi ẩn người
    // đã khoá, thứ duy nhất phân biệt chúng chính là ghost.
    expect(chipCount("Tất cả")).not.toBe(chipCount("Hoạt động"));
  });
});
