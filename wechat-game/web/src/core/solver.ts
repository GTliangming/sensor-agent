import { GameSession } from "./GameSession";
import { transitiveBlockers } from "./occlusion";
import type { LevelConfig } from "./types";

export interface SolveResult {
  completable: boolean;
  /** 不看广告通关时，至少必须拿走的非目标物件数 */
  minWrong: number;
  /** 一条可行的点击顺序（实例 ID） */
  path: string[];
  reason?: string;
}

/**
 * 关卡可完成性检查：用真实 GameSession 模拟一条“最少失误”的点击顺序。
 * 必须拿走的错误物件 = 所有目标实例的传递遮挡者中，不属于目标的那些。
 * 要求不依赖救场通关：minWrong 必须小于归位格容量（填满即触发救场）。
 */
export function solveLevel(level: LevelConfig): SolveResult {
  const byId = new Map(level.itemInstances.map((i) => [i.id, i]));
  const targetIds = new Set(level.objectives.map((o) => o.itemId));
  const targetInstances = level.itemInstances.filter((i) => targetIds.has(i.itemId));

  const mustRemove = new Set<string>();
  for (const t of targetInstances) {
    for (const b of transitiveBlockers(t.id, byId)) {
      if (!targetIds.has(byId.get(b)!.itemId)) mustRemove.add(b);
    }
  }

  const session = new GameSession({
    ...level,
    hintConfig: { ...level.hintConfig, autoHintSeconds: 0 },
  });
  const path: string[] = [];
  const pending = new Set([...targetInstances.map((t) => t.id), ...mustRemove]);

  while (session.status === "playing") {
    const next =
      [...pending].find((id) => targetIds.has(byId.get(id)!.itemId) && session.isClickable(id)) ??
      [...pending].find((id) => session.isClickable(id));
    if (!next) break;
    pending.delete(next);
    session.click(next);
    path.push(next);
  }

  const result = { minWrong: mustRemove.size, path };
  if (session.status === "completed") return { completable: true, ...result };
  if (session.status === "rescue") {
    return { completable: false, ...result, reason: "必须拿走的干扰物会填满归位格" };
  }
  return { completable: false, ...result, reason: "存在无法解锁的目标物件" };
}
