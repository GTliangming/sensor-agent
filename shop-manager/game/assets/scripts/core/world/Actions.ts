// 玩家当前位置下能做的动作(纯函数):根据站的位置、手里有没有纸箱、附近有什么,给出一份动作清单。
// 界面把清单画成按钮;点击后用 runAction 执行,规则校验仍由 GameSession 负责。
import { cartTotal, cartUnits, queueOf } from '../customers/CustomerSystem';
import { TRASH } from '../data/Balance';
import { getCatalogItem } from '../data/Catalog';
import { containerKindOf } from '../inventory/Inventory';
import type { GameSession } from '../GameSession';
import type { GameState } from '../state/GameState';
import { distanceToRect, findNearbyFixture } from './Interaction';
import type { CommandResult } from '../GameSession';
import type { Fixture, StoreLayout } from './StoreLayout';

/** 各类交互的有效距离(米,到设施边缘)。 */
export const COMPUTER_RANGE = 1.8;
export const CONTAINER_RANGE = 1.6;
export const UNLOAD_RANGE = 1.5;
export const COUNTER_RANGE = 1.8;
/** 同时最多给出几个动作,避免屏幕上堆满按钮。 */
const MAX_ACTIONS = 5;

export type GameAction =
    | { type: 'openComputer'; label: string }
    | { type: 'pickUpCarton'; cartonId: number; label: string }
    | { type: 'putDownCarton'; label: string }
    | { type: 'stock'; fixtureId: string; count: number | 'all'; label: string }
    | { type: 'take'; fixtureId: string; itemId: string; label: string }
    | { type: 'storeEquipment'; label: string }
    | { type: 'scan'; customerId: number; label: string }
    | { type: 'collect'; customerId: number; label: string }
    | { type: 'sweep'; trashId: number; label: string }
    | { type: 'pickUpFixture'; fixtureId: string; label: string }
    | { type: 'startPlacing'; label: string }
    // 以下三种只在"摆放模式"里由界面生成,listActions 不会返回
    | { type: 'placeHere'; label: string }
    | { type: 'rotate'; label: string }
    | { type: 'cancelPlacing'; label: string };

/** 离 (x, z) 最近的容器类设施(货架/冷柜/展柜),范围内没有则为 null。 */
export function nearestContainer(layout: StoreLayout, x: number, z: number): Fixture | null {
    let best: Fixture | null = null;
    let bestDist = CONTAINER_RANGE;
    for (const f of layout.fixtures) {
        if (containerKindOf(f.kind) === null) continue;
        const d = distanceToRect(x, z, f);
        if (d <= bestDist) {
            best = f;
            bestDist = d;
        }
    }
    return best;
}

function fixtureName(f: Fixture): string {
    const item = f.equipId ? getCatalogItem(`equip:${f.equipId}`) : undefined;
    return item ? item.name : f.id;
}

/** 离 (x, z) 最近的、玩家能搬动的设施(范围内),没有则为 null。 */
function nearestMovableFixture(layout: StoreLayout, x: number, z: number): Fixture | null {
    let best: Fixture | null = null;
    let bestDist = CONTAINER_RANGE;
    for (const f of layout.fixtures) {
        if (!f.movable) continue;
        const d = distanceToRect(x, z, f);
        if (d <= bestDist) {
            best = f;
            bestDist = d;
        }
    }
    return best;
}

export function listActions(state: GameState, layout: StoreLayout, x: number, z: number): GameAction[] {
    const actions: GameAction[] = [];
    const hands = state.cartons.find((c) => c.location === 'hands') ?? null;
    const handsItem = hands ? getCatalogItem(hands.itemId) : undefined;
    const nameOf = (id: string) => getCatalogItem(id)?.name ?? id;

    if (hands && handsItem) {
        if (handsItem.kind === 'equipment') {
            actions.push({ type: 'storeEquipment', label: `收进仓库:${handsItem.name} × ${hands.units}` });
        } else {
            const box = nearestContainer(layout, x, z);
            if (box) {
                actions.push({ type: 'stock', fixtureId: box.id, count: 1, label: `放入 1 件${handsItem.name}` });
                if (hands.units > 1) actions.push({ type: 'stock', fixtureId: box.id, count: 'all', label: `全部放入(${hands.units} 件)` });
            }
        }
        if (distanceToRect(x, z, layout.unloadZone) <= UNLOAD_RANGE) {
            actions.push({ type: 'putDownCarton', label: '放回卸货区' });
        }
    } else {
        if (distanceToRect(x, z, layout.unloadZone) <= UNLOAD_RANGE) {
            for (const c of state.cartons) {
                if (c.location === 'door') actions.push({ type: 'pickUpCarton', cartonId: c.id, label: `搬起纸箱:${nameOf(c.itemId)} × ${c.units}` });
            }
        }
        const box = nearestContainer(layout, x, z);
        const contents = box ? state.stock[box.id] : undefined;
        if (box && contents) {
            for (const id of Object.keys(contents)) actions.push({ type: 'take', fixtureId: box.id, itemId: id, label: `拿起${nameOf(id)}(${contents[id]} 件)` });
        }
    }

    // 手上没东西时:可以把附近的货架/冷柜收回仓库,或者把仓库里的设备摆出来
    if (!hands) {
        const f = nearestMovableFixture(layout, x, z);
        if (f) actions.push({ type: 'pickUpFixture', fixtureId: f.id, label: `收回:${fixtureName(f)}` });
        let stored = 0;
        for (const id of Object.keys(state.warehouse)) stored += state.warehouse[id];
        if (stored > 0 && z < layout.interior.z + layout.interior.d / 2) {
            actions.push({ type: 'startPlacing', label: `摆放设备(仓库 ${stored} 件)` });
        }
    }

    // 脚下有垃圾:清扫
    const trash = state.trash
        .filter((t) => Math.hypot(t.x - x, t.z - z) <= TRASH.sweepRange)
        .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    if (trash) actions.unshift({ type: 'sweep', trashId: trash.id, label: '清扫垃圾' });

    // 收银台旁:接待队首的顾客(扫码 -> 收款),优先级高于搬运
    if (findNearbyFixture(x, z, layout.fixtures, 'counter', COUNTER_RANGE)) {
        const head = queueOf(state)[0];
        if (head) {
            actions.unshift(
                head.scanned
                    ? { type: 'collect', customerId: head.id, label: `收款 +${cartTotal(head, state)} 金币` }
                    : { type: 'scan', customerId: head.id, label: `扫码:顾客买了 ${cartUnits(head)} 件商品` },
            );
        }
    }
    if (findNearbyFixture(x, z, layout.fixtures, 'computer', COMPUTER_RANGE)) actions.unshift({ type: 'openComputer', label: '使用电脑' });
    return actions.slice(0, MAX_ACTIONS);
}

/** 执行一个动作。openComputer 属于界面行为,由调用方处理。 */
export function runAction(session: GameSession, action: GameAction): CommandResult {
    switch (action.type) {
        case 'pickUpCarton':
            return session.pickUpCarton(action.cartonId);
        case 'putDownCarton':
            return session.putDownCarton();
        case 'stock':
            return session.stockContainer(action.fixtureId, action.count);
        case 'take':
            return session.takeFromContainer(action.fixtureId, action.itemId, 'all');
        case 'storeEquipment':
            return session.storeEquipment();
        case 'scan':
            return session.scanCustomer(action.customerId);
        case 'collect':
            return session.collectPayment(action.customerId);
        case 'sweep':
            return session.sweepTrash(action.trashId);
        case 'pickUpFixture':
            return session.pickUpFixture(action.fixtureId);
        case 'startPlacing':
        case 'placeHere':
        case 'rotate':
        case 'cancelPlacing':
        case 'openComputer':
            return { ok: false, reason: '该动作由界面处理', code: 'invalid' };
    }
}
