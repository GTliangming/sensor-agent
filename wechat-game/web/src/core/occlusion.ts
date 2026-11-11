import type { ItemInstance } from "./types";

/** 当前仍在场景中的遮挡者（谁挡住我且还没被拿走） */
export function activeBlockers(
  instance: ItemInstance,
  inScene: (id: string) => boolean,
): string[] {
  return instance.blocking.filter(inScene);
}

/** 返回遮挡关系中的环（如有），用于配置校验。每个环用实例 ID 列表表示。 */
export function findBlockingCycle(instances: ItemInstance[]): string[] | null {
  const byId = new Map(instances.map((i) => [i.id, i]));
  const state = new Map<string, 0 | 1 | 2>(); // 0 未访问 1 访问中 2 已完成
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const next of byId.get(id)?.blocking ?? []) {
      if (!byId.has(next)) continue;
      const s = state.get(next) ?? 0;
      if (s === 1) return stack.slice(stack.indexOf(next));
      if (s === 0) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };

  for (const inst of instances) {
    if ((state.get(inst.id) ?? 0) === 0) {
      const cycle = visit(inst.id);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** 某实例的全部传递遮挡者（挡住它的、挡住挡住它的……） */
export function transitiveBlockers(
  id: string,
  byId: Map<string, ItemInstance>,
  inScene: (id: string) => boolean = () => true,
): Set<string> {
  const result = new Set<string>();
  const queue = [...(byId.get(id)?.blocking ?? [])];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (result.has(next) || !inScene(next)) continue;
    result.add(next);
    queue.push(...(byId.get(next)?.blocking ?? []));
  }
  return result;
}
