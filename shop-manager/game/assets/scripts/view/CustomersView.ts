// 顾客的 3D 表现:核心层只记录顾客"状态",这里根据状态推算该站在哪、怎么走过去。
// 逛店 -> 在货架前换着站;排队 -> 站到收银台前对应的队位;离开 -> 走出店门后消失。
import { Color, Node } from 'cc';
import type { Customer, GameState } from '../core/state/GameState';
import { DOOR_INSIDE, DOOR_OUTSIDE, Point, STREET_SPOT, browseSpot, queuePosition } from '../core/world/Interaction';
import type { StoreLayout } from '../core/world/StoreLayout';
import { BoxFactory } from './BoxFactory';
import type { ModelLibrary } from './ModelLibrary';

const WALK_SPEED = 1.8;
/** 重新计算顾客目标点的间隔(秒)。 */
const REFRESH_SECONDS = 0.15;
/** 逛店时每隔多少秒换一个货架。 */
const BROWSE_ROUND_SECONDS = 4;
/** 南墙所在的 z:大于它就算在店外。 */
const WALL_Z = 4.0;

const BODY_COLORS = [
    new Color(224, 96, 96, 255),
    new Color(96, 160, 224, 255),
    new Color(110, 190, 120, 255),
    new Color(232, 180, 80, 255),
    new Color(170, 120, 210, 255),
    new Color(90, 190, 190, 255),
];
const HAIR_COLORS = [new Color(50, 36, 30, 255), new Color(120, 78, 40, 255), new Color(24, 24, 28, 255), new Color(200, 160, 70, 255)];
const PANTS = new Color(52, 60, 88, 255);
const SKIN = new Color(244, 208, 170, 255);
const SURVEY_MARK = new Color(255, 214, 40, 255);

/** 角色模型(Kenney 员工)原高约 0.72 米,放大到约 1.6 米。 */
const CHARACTER_SCALE = 2.2;
/** 走路时上下起伏的幅度(米)与频率。 */
const BOB_HEIGHT = 0.06;
const BOB_SPEED = 11;

interface Walker {
    node: Node;
    /** 角色模型节点(没有模型时为 null,用方块人)。 */
    body: Node | null;
    moving: boolean;
    yaw: number;
    /** 四肢的摆动轴(髋部/肩部位置的空节点),只有方块人才有;走路时前后摆动。 */
    limbs: Node[];
    x: number;
    z: number;
    leaving: boolean;
}

export class CustomersView {
    private readonly root: Node;
    private readonly walkers = new Map<number, Walker>();
    private time = 0;
    /** 同时最多画出多少位顾客(低性能档会调小;核心逻辑里的顾客数量不受影响)。 */
    private maxVisible = 8;
    private present: { [id: number]: Point } = {};
    private refreshLeft = 0;
    private lastCount = -1;

    private layout!: StoreLayout;

    constructor(
        parent: Node,
        private readonly boxes: BoxFactory,
        private readonly models: ModelLibrary | null = null,
    ) {
        this.root = new Node('Customers');
        parent.addChild(this.root);
    }

    /** layout 是当前布局(摆放设备、扩建后会变),每帧传入。 */
    update(state: GameState, layout: StoreLayout, dt: number): void {
        this.layout = layout;
        this.time += dt;

        // 队位和目标点一秒只重算几次(顾客数量变了也立刻重算),移动本身每帧都做
        this.refreshLeft -= dt;
        if (this.refreshLeft <= 0 || state.customers.length !== this.lastCount) {
            this.refreshLeft = REFRESH_SECONDS;
            this.lastCount = state.customers.length;
            // 排队的顾客按序号排好队位
            const queue = state.customers.filter((c) => c.phase === 'queuing').sort((a, b) => a.joinSeq - b.joinSeq);
            const present: { [id: number]: Point } = {};
            for (const c of state.customers) {
                present[c.id] = this.targetOf(c, queue);
                if (!this.walkers.has(c.id) && this.walkers.size < this.maxVisible) this.walkers.set(c.id, this.spawnWalker(c));
            }
            this.present = present;
        }
        const present = this.present;

        const gone: number[] = [];
        this.walkers.forEach((w, id) => {
            const target = present[id];
            if (target === undefined) w.leaving = true;
            this.move(w, target ?? STREET_SPOT, dt);
            if (w.leaving && Math.abs(w.z - STREET_SPOT.z) < 0.3) gone.push(id);
        });
        for (const id of gone) {
            const w = this.walkers.get(id)!;
            w.node.removeFromParent();
            w.node.destroy();
            this.walkers.delete(id);
        }
    }

    setMaxVisible(n: number): void {
        this.maxVisible = n;
    }

    private targetOf(c: Customer, queue: Customer[]): Point {
        if (c.phase === 'queuing') return queuePosition(this.layout, queue.indexOf(c));
        return browseSpot(this.layout, c.id, Math.floor(this.time / BROWSE_ROUND_SECONDS));
    }

    private spawnWalker(c: Customer): Walker {
        const node = new Node(`Customer_${c.id}`);
        const limbs: Node[] = [];
        let body: Node | null = this.models ? this.models.create('character-employee') : null;
        if (body) {
            body.setScale(CHARACTER_SCALE, CHARACTER_SCALE, CHARACTER_SCALE);
            node.addChild(body);
        } else {
            const color = BODY_COLORS[c.id % BODY_COLORS.length];
            body = new Node('Body');
            node.addChild(body);
            this.boxes.addBox(body, 'Torso', 0, 0.78, 0, 0.46, 0.6, 0.28, color);
            this.boxes.addBox(body, 'Head', 0, 1.27, 0, 0.32, 0.32, 0.32, SKIN);
            this.boxes.addBox(body, 'Hair', 0, 1.46, -0.02, 0.34, 0.1, 0.34, HAIR_COLORS[c.id % HAIR_COLORS.length]);
            // 腿和手臂各挂在髋/肩的枢轴上,绕枢轴转动才像在迈步
            const addLimb = (name: string, x: number, y: number, h: number, w: number, limbColor: Color) => {
                const pivot = new Node(name);
                pivot.setPosition(x, y, 0);
                body!.addChild(pivot);
                this.boxes.addBox(pivot, 'Part', 0, -h / 2, 0, w, h, w, limbColor);
                limbs.push(pivot);
            };
            addLimb('LegL', -0.12, 0.48, 0.48, 0.17, PANTS);
            addLimb('LegR', 0.12, 0.48, 0.48, 0.17, PANTS);
            addLimb('ArmL', -0.31, 1.04, 0.5, 0.13, color);
            addLimb('ArmR', 0.31, 1.04, 0.5, 0.13, color);
        }
        // 问卷客头顶有一个黄色标记;暗访客和普通客人看起来一样
        if (c.kind === 'survey') this.boxes.addBox(node, 'SurveyMark', 0, 1.8, 0, 0.22, 0.22, 0.22, SURVEY_MARK);
        this.root.addChild(node);
        const w: Walker = { node, body, limbs, moving: false, yaw: 180, x: STREET_SPOT.x + ((c.id % 5) - 2) * 0.5, z: STREET_SPOT.z, leaving: false };
        node.setPosition(w.x, 0, w.z);
        return w;
    }

    /** 朝着下一个路径点走;进出店要先经过门口,不会穿墙。 */
    private move(w: Walker, target: Point, dt: number): void {
        const next = this.waypoint(w, target);
        const dx = next.x - w.x;
        const dz = next.z - w.z;
        const dist = Math.hypot(dx, dz);
        const step = WALK_SPEED * dt;
        w.moving = dist > 1e-3;
        if (dist <= step || dist < 1e-6) {
            w.x = next.x;
            w.z = next.z;
        } else {
            // 模型正面朝 +z,转向走动方向;每帧向目标朝向靠拢,转身不会一下子跳变
            const want = (Math.atan2(dx, dz) * 180) / Math.PI;
            const diff = ((((want - w.yaw + 540) % 360) + 360) % 360) - 180;
            const maxTurn = 720 * dt;
            w.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
            w.x += (dx / dist) * step;
            w.z += (dz / dist) * step;
        }
        w.node.setPosition(w.x, 0, w.z);
        w.node.setRotationFromEuler(0, w.yaw, 0);
        // 走路时腿臂前后摆动(左腿与右臂同相,右腿与左臂反相),停下回正
        const swing = w.moving ? Math.sin(this.time * BOB_SPEED + w.x) * 35 : 0;
        if (w.limbs.length === 4) {
            w.limbs[0].setRotationFromEuler(swing, 0, 0);
            w.limbs[1].setRotationFromEuler(-swing, 0, 0);
            w.limbs[2].setRotationFromEuler(-swing, 0, 0);
            w.limbs[3].setRotationFromEuler(swing, 0, 0);
        }
        if (w.body) w.body.setPosition(0, w.moving ? Math.abs(Math.sin(this.time * BOB_SPEED + w.x)) * BOB_HEIGHT : 0, 0);
    }

    private waypoint(w: Walker, target: Point): Point {
        const fromInside = w.z < WALL_Z;
        const toInside = target.z < WALL_Z;
        if (fromInside === toInside) return target;
        if (toInside) {
            // 进店:街道 -> 门外 -> 门内 -> 目标
            if (w.z > DOOR_OUTSIDE.z + 0.2) return DOOR_OUTSIDE;
            if (w.z > DOOR_INSIDE.z + 0.2) return DOOR_INSIDE;
            return target;
        }
        // 出店:店内 -> 门内 -> 门外 -> 街道
        if (w.z < DOOR_INSIDE.z - 0.2) return DOOR_INSIDE;
        if (w.z < DOOR_OUTSIDE.z - 0.2) return DOOR_OUTSIDE;
        return target;
    }
}
