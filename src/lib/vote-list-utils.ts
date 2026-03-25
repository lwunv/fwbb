/** Số người đã vote tham gia ít nhất một hoạt động (cầu hoặc nhậu) — khớp danh sách hiển thị công khai */
export function attendingVotesCount(
  votes: { willPlay?: boolean | null; willDine?: boolean | null }[],
): number {
  return votes.filter((v) => !!(v.willPlay || v.willDine)).length;
}
