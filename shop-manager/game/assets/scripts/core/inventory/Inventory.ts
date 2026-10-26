// 库存规则(纯函数):纸箱里有多少件、货架还放得下多少、什么商品能放进什么容器。
import { CONTAINER_NAMES, ContainerKind, GoodsDef, getCatalogItem } from '../data/Catalog';
import type { CartLine, GameState, Order } from '../state/GameState';
import type { Fixture, FixtureKind, StoreLayout } from '../world/StoreLayout';

/** 订单送达后纸箱里的件数:商品 = 批数 × 每批件数;设备 = 件数。 */
export function unitsForOrder(order: Pick<Order, 'itemId' | 'quantity'>): number {
    const item = getCatalogItem(order.itemId);
    return item && item.kind === 'goods' ? item.batchSize * order.quantity : order.quantity;
}

/** 设施对应的容器类型;柜台、电脑桌等不能存放商品,返回 null。 */
export function containerKindOf(kind: FixtureKind): ContainerKind | null {
    return kind === 'shelf' || kind === 'fridge' || kind === 'glass' ? kind : null;
}

/** 玩家看到的设施名称(用于提示文字)。 */
export function fixtureLabel(fixture: Pick<Fixture, 'kind'>): string {
    const kind = containerKindOf(fixture.kind);
    return kind === 'shelf' ? '货架' : kind ? CONTAINER_NAMES[kind] : '这里';
}

/** 一个容器里已占用的格子数。 */
export function usedSlots(contents: { [itemId: string]: number } | undefined): number {
    let used = 0;
    if (!contents) return 0;
    for (const id of Object.keys(contents)) {
        const item = getCatalogItem(id);
        if (item && item.kind === 'goods') used += contents[id] * item.slots;
    }
    return used;
}

/** 这个容器还能再放几件该商品(按格子数计算,向下取整)。 */
export function maxUnitsFit(fixture: Fixture, contents: { [itemId: string]: number } | undefined, item: GoodsDef): number {
    const free = (fixture.capacity ?? 0) - usedSlots(contents);
    return free > 0 ? Math.floor(free / item.slots) : 0;
}

/** 商品能不能放进这个设施。可以返回 null,不行返回给玩家看的原因。 */
export function containerMismatch(item: GoodsDef, fixture: Fixture): string | null {
    const kind = containerKindOf(fixture.kind);
    if (kind === null) return '这里不能存放商品';
    if (kind !== item.container) {
        return `${item.name}需要放进${CONTAINER_NAMES[item.container]},不能放在${CONTAINER_NAMES[kind]}里`;
    }
    return null;
}

/** 货架/冷柜里某商品的总件数。 */
export function stockedUnits(state: GameState, itemId: string): number {
    let n = 0;
    for (const fixtureId of Object.keys(state.stock)) n += state.stock[fixtureId][itemId] ?? 0;
    return n;
}

/** 从货架上取走最多 units 件商品(按布局里设施的顺序依次取),返回实际取到的明细。 */
export function takeFromShelves(state: GameState, layout: StoreLayout, itemId: string, units: number): CartLine[] {
    const lines: CartLine[] = [];
    let left = units;
    for (const f of layout.fixtures) {
        if (left <= 0) break;
        const bucket = state.stock[f.id];
        const have = bucket ? bucket[itemId] ?? 0 : 0;
        if (have < 1) continue;
        const taken = Math.min(have, left);
        lines.push({ itemId, units: taken, fixtureId: f.id });
        left -= taken;
        bucket[itemId] = have - taken;
        if (bucket[itemId] === 0) delete bucket[itemId];
        if (Object.keys(bucket).length === 0) delete state.stock[f.id];
    }
    return lines;
}

/**
 * 把购物车里的商品放回货架:优先放回原来的设施,放不下再找其他类型匹配且有空位的设施。
 * 都放不下的部分只能丢弃(极少见:玩家在顾客逛店期间把空位占满了)。
 */
export function returnCart(state: GameState, layout: StoreLayout, cart: CartLine[]): void {
    for (const line of cart) {
        const item = getCatalogItem(line.itemId);
        if (!item || item.kind !== 'goods') continue;
        let left = line.units;
        const candidates = layout.fixtures
            .filter((f) => containerMismatch(item, f) === null)
            .sort((a, b) => (a.id === line.fixtureId ? -1 : 0) - (b.id === line.fixtureId ? -1 : 0));
        for (const f of candidates) {
            if (left <= 0) break;
            const fit = Math.min(left, maxUnitsFit(f, state.stock[f.id], item));
            if (fit < 1) continue;
            const bucket = state.stock[f.id] ?? (state.stock[f.id] = {});
            bucket[item.id] = (bucket[item.id] ?? 0) + fit;
            left -= fit;
        }
    }
}
