import {
  getMembers,
  getCurrentAdminMemberId,
  findDuplicateMembers,
} from "@/actions/members";
import { getAllDebts } from "@/actions/finance";
import { getMemberPlayStats } from "@/actions/stats";
import { db } from "@/db";
import { financialTransactions, members as membersTable } from "@/db/schema";
import { eq, inArray, asc, and } from "drizzle-orm";
import { computeBalancesForMembers } from "@/lib/fund-core";
import { getNameMatchesBatch } from "@/actions/member-approval";
import { MemberList } from "./member-list";
import { DuplicateMembersBanner } from "./duplicate-members-banner";
import {
  PendingMembersSection,
  type PendingMember,
} from "./pending-members-section";

export default async function MembersPage() {
  const [
    members,
    allDebts,
    currentAdminMemberId,
    dupGroups,
    fundMemberRows,
    pendingRows,
    playStats,
  ] = await Promise.all([
    getMembers(),
    getAllDebts(),
    getCurrentAdminMemberId(),
    findDuplicateMembers(),
    db.query.members.findMany({
      where: and(
        eq(membersTable.isActive, true),
        eq(membersTable.approvalStatus, "approved"),
      ),
      columns: { id: true },
    }),
    db.query.members.findMany({
      where: eq(membersTable.approvalStatus, "pending"),
      orderBy: [asc(membersTable.createdAt)],
    }),
    getMemberPlayStats(),
  ]);

  // Gợi ý trùng tên cho TẤT CẢ pending trong một lượt.
  //
  // Bản cũ gọi `getNameMatches(p.id)` trong vòng lặp, mà mỗi lần gọi lại nạp
  // nguyên danh sách member đã duyệt. Với 182 người chờ duyệt, một lần mở
  // trang là 380 truy vấn và hơn 8.000 dòng đọc, nhân thêm việc màn này tự
  // tải lại vài giây một lần. Đó là thứ làm cháy hạn mức đọc và sập web ngày
  // 24/10/2026. Bản này đọc hai lần, bất kể bao nhiêu người chờ.
  const suggestionMap = await getNameMatchesBatch(pendingRows.map((p) => p.id));
  const pendingMembers: PendingMember[] = pendingRows.map((p) => ({
    id: p.id,
    name: p.name,
    nickname: p.nickname,
    email: p.email,
    phoneNumber: p.phoneNumber,
    bankAccountNo: p.bankAccountNo,
    avatarKey: p.avatarKey,
    avatarUrl: p.avatarUrl,
    facebookId: p.facebookId,
    googleId: p.googleId,
    createdAt: p.createdAt,
    suggestions: suggestionMap[p.id] ?? [],
  }));

  // Merge targets cho dropdown "gộp thủ công" ở mỗi pending card — TẤT CẢ
  // member đã duyệt (kể cả không trùng tên), để admin chủ động gộp pending
  // signup vào bất kỳ ai. Chỉ whitelist field cần cho dropdown + cảnh báo
  // reset-password (hasPassword), không đổ nguyên row (tránh lộ PII).
  const mergeTargets = members
    .filter((m) => m.approvalStatus === "approved")
    .map((m) => ({
      id: m.id,
      name: m.name,
      nickname: m.nickname,
      hasPassword: m.hasPassword,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const fundMemberIdList = fundMemberRows.map((r) => r.id);

  const memberIds = members.map((m) => m.id);
  const memberTxs =
    memberIds.length > 0
      ? await db
          .select({
            memberId: financialTransactions.memberId,
            type: financialTransactions.type,
            amount: financialTransactions.amount,
            id: financialTransactions.id,
            reversalOfId: financialTransactions.reversalOfId,
          })
          .from(financialTransactions)
          .where(inArray(financialTransactions.memberId, memberIds))
      : [];

  const memberTxsFiltered = memberTxs.filter(
    (tx): tx is typeof tx & { memberId: number } => tx.memberId !== null,
  );
  const memberBalances = computeBalancesForMembers(
    memberIds,
    memberTxsFiltered,
  );

  // Group unpaid debts by memberId
  const debtsByMember: Record<
    number,
    Array<{
      id: number;
      sessionId: number;
      sessionDate: string;
      totalAmount: number;
      memberConfirmed: boolean;
    }>
  > = {};

  for (const d of allDebts) {
    if (d.adminConfirmed) continue;
    if (!debtsByMember[d.memberId]) debtsByMember[d.memberId] = [];
    debtsByMember[d.memberId].push({
      id: d.id,
      sessionId: d.sessionId,
      sessionDate: d.session.date,
      totalAmount: d.totalAmount,
      memberConfirmed: d.memberConfirmed ?? false,
    });
  }

  return (
    <div className="space-y-3">
      {pendingMembers.length > 0 && (
        <PendingMembersSection
          pendingMembers={pendingMembers}
          mergeTargets={mergeTargets}
        />
      )}
      {dupGroups.length > 0 && <DuplicateMembersBanner groups={dupGroups} />}
      <MemberList
        members={members}
        debtsByMember={debtsByMember}
        currentAdminMemberId={currentAdminMemberId}
        memberBalances={memberBalances}
        fundMemberIds={fundMemberIdList}
        playStats={playStats}
      />
    </div>
  );
}
