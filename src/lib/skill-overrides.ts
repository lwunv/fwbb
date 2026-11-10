import type { SkillLevel } from "@/lib/skill-level";

/**
 * Bỏ bản tạm (optimistic) trình độ của những member mà dữ liệu server mới về đã
 * khớp. Member server CHƯA khớp (đang lưu dở) thì giữ, để lượt poll định kỳ
 * không làm nhảy ngược giá trị vừa chọn. Không có gì để bỏ thì trả lại đúng
 * object cũ để React khỏi render thừa.
 */
export function dropConvergedSkillOverrides(
  overrides: Readonly<Record<number, SkillLevel | null>>,
  members: ReadonlyArray<{ id: number; skillLevel: SkillLevel | null }>,
): Record<number, SkillLevel | null> {
  const serverById = new Map(members.map((m) => [m.id, m.skillLevel]));
  let changed = false;
  const next: Record<number, SkillLevel | null> = {};
  for (const [key, value] of Object.entries(overrides)) {
    const id = Number(key);
    if (serverById.has(id) && serverById.get(id) === value) {
      changed = true;
      continue;
    }
    next[id] = value;
  }
  return changed ? next : (overrides as Record<number, SkillLevel | null>);
}
