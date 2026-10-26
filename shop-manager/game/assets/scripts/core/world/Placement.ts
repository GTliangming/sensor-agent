// 摆放规则(纯函数):设备能不能摆在某处——不超出店内、不重叠、人能走过去、不堵死通道。
// 玩家预览(幽灵方块)和真正放置用同一套判定,所以"能放"的提示和结果一致。
import type { EquipmentDef } from '../data/Catalog';
import { distanceToRect, DOOR_INSIDE, queuePosition } from './Interaction';
import { FRONTS, Fixture, Rect, StoreLayout, obstaclesOf } from './StoreLayout';

/** 摆放位置吸附到 0.25 米的网格。 */
export const SNAP = 0.25;
/** 挡路的设施之间、与墙之间至少留多宽的通道(米)——玩家直径 0.6,再留一点余量。 */
export const AISLE = 0.7;
/** 判断"人能不能走到"时玩家的半径。 */
const WALKER_RADIUS = 0.3;
/** 寻路网格大小(米)。 */
const CELL = 0.25;

export function snap(v: number): number {
    return Math.round(v / SNAP) * SNAP;
}

/** 旋转次数归一化到 0~3。 */
export function normalizeRotation(rot: number): number {
    return (((Math.round(rot) % 4) + 4) % 4) as number;
}

/** 由设备定义、位置和旋转生成一个设施(id 由调用方给)。 */
export function makeFixture(id: string, def: EquipmentDef, x: number, z: number, rot: number): Fixture {
    const r = normalizeRotation(rot);
    const p = def.placement;
    const odd = r % 2 === 1;
    const f: Fixture = {
        id,
        kind: p.kind,
        x,
        z,
        w: odd ? p.d : p.w,
        d: odd ? p.w : p.d,
        height: p.height,
        front: FRONTS[r],
        equipId: def.id,
        movable: true,
        collides: p.collides,
    };
    if (p.capacity !== undefined) f.capacity = p.capacity;
    return f;
}

const overlaps = (a: Rect, b: Rect, margin: number) =>
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 + margin && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + margin;

/** 设施正面前方,人站着使用它的位置。 */
export function accessPoint(f: Fixture): { x: number; z: number } {
    const halfDepth = Math.abs(f.front.x) * (f.w / 2) + Math.abs(f.front.z) * (f.d / 2);
    return { x: f.x + f.front.x * (halfDepth + 0.5), z: f.z + f.front.z * (halfDepth + 0.5) };
}

/**
 * 检查布局里的关键地点是否都能从店门走到:每个会被使用的设施正面、收银台排队位。
 * 返回第一个走不到的地点的描述;都能到返回 null。
 */
export function unreachablePlace(layout: StoreLayout): string | null {
    const { interior } = layout;
    const minX = interior.x - interior.w / 2;
    const minZ = interior.z - interior.d / 2;
    const cols = Math.ceil(interior.w / CELL) + 1;
    const rows = Math.ceil((4.6 - minZ) / CELL) + 1; // 一直算到门外一点,保证门洞本身连通
    const blockers = obstaclesOf(layout);

    const blocked = new Array<boolean>(cols * rows);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = minX + c * CELL;
            const z = minZ + r * CELL;
            let b = false;
            for (let i = 0; i < blockers.length && !b; i++) b = distanceToRect(x, z, blockers[i]) < WALKER_RADIUS;
            blocked[r * cols + c] = b;
        }
    }

    const cell = (p: { x: number; z: number }) => ({
        c: Math.round((p.x - minX) / CELL),
        r: Math.round((p.z - minZ) / CELL),
    });
    const inGrid = (c: number, r: number) => c >= 0 && c < cols && r >= 0 && r < rows;

    // 从门内侧出发做广度优先搜索
    const reach = new Array<boolean>(cols * rows);
    const start = cell(DOOR_INSIDE);
    if (!inGrid(start.c, start.r) || blocked[start.r * cols + start.c]) return '店门口被堵住了';
    const queue: number[] = [start.r * cols + start.c];
    reach[queue[0]] = true;
    for (let head = 0; head < queue.length; head++) {
        const cur = queue[head];
        const c = cur % cols;
        const r = Math.floor(cur / cols);
        const neighbors = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
        for (let k = 0; k < 4; k++) {
            const nc = neighbors[k][0];
            const nr = neighbors[k][1];
            if (!inGrid(nc, nr)) continue;
            const idx = nr * cols + nc;
            if (blocked[idx] || reach[idx]) continue;
            reach[idx] = true;
            queue.push(idx);
        }
    }

    const ok = (p: { x: number; z: number }) => {
        const k = cell(p);
        return inGrid(k.c, k.r) && reach[k.r * cols + k.c] === true;
    };
    for (const f of layout.fixtures) {
        if (f.kind === 'decor') continue;
        if (!ok(accessPoint(f))) return f.kind === 'counter' ? '收银台前走不过去' : f.kind === 'computer' ? '店长电脑前走不过去' : '有的货架前走不过去';
    }
    for (let i = 0; i < 5; i++) {
        if (!ok(queuePosition(layout, i))) return '收银台前排不下队';
    }
    return null;
}

/**
 * 能不能把设备 def 以旋转 rot 摆在 (x, z)?可以返回 null,不行返回给玩家看的原因。
 * x、z 会先吸附到网格。
 */
export function checkPlacement(layout: StoreLayout, def: EquipmentDef, x: number, z: number, rot: number): string | null {
    const cand = makeFixture('preview', def, snap(x), snap(z), rot);
    const room = layout.interior;
    if (
        Math.abs(cand.x - room.x) + cand.w / 2 > room.w / 2 - 0.05 ||
        Math.abs(cand.z - room.z) + cand.d / 2 > room.d / 2 - 0.05
    ) {
        return '放不下:超出了店内范围';
    }

    const blocking = cand.collides !== false;
    for (const f of layout.fixtures) {
        if (overlaps(cand, f, 0)) return '这里已经有东西了';
        if (blocking && f.collides !== false && overlaps(cand, f, AISLE)) return '离其他设施太近,人走不过去';
    }
    if (blocking) {
        const problem = unreachablePlace({ ...layout, fixtures: [...layout.fixtures, cand] });
        if (problem) return `会堵住通道:${problem}`;
    }
    return null;
}
