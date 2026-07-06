import {
  countVoteParticipation,
  type ParticipationVote,
} from "@/lib/vote-list-utils";

/**
 * Giới hạn số người CHƠI CẦU mỗi buổi (sức chứa sân). Đủ số này → chặn vote
 * chơi thêm, hiển "Hết slot". Chỉ áp cho CẦU (play); nhậu (dine) không giới hạn.
 *
 * "Số người chơi" = số đầu member chơi (gồm "đi 2 mình") + khách của admin
 * (`session.adminGuestPlayCount`). Khách của member đã bỏ (giờ chỉ admin thêm
 * khách) nên `countVoteParticipation(...).totalPlayers` = member heads; cộng
 * thêm khách-admin ở caller.
 */
export const MAX_PLAY_SLOTS = 16;

/** Tổng đầu người chơi cầu = member heads (gồm partner) + khách admin. */
export function playHeadcount(
  votes: ReadonlyArray<ParticipationVote>,
  adminGuestPlayCount = 0,
): number {
  return countVoteParticipation(votes).totalPlayers + adminGuestPlayCount;
}

/** Đã đủ / vượt sức chứa chơi cầu. */
export function isPlayFull(headcount: number): boolean {
  return headcount >= MAX_PLAY_SLOTS;
}

/** Số slot chơi còn lại (không âm). */
export function remainingPlaySlots(headcount: number): number {
  return Math.max(0, MAX_PLAY_SLOTS - headcount);
}

/** Số đầu chơi mà 1 vote đóng góp (member + partner). Khách member đã bỏ. */
export function votePlayContribution(vote: ParticipationVote): number {
  return countVoteParticipation([vote]).totalPlayers;
}
