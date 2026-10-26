// 游戏入口组件:挂在场景里的一个空节点上。启动时读档、生成店铺、接好相机/输入/HUD,并每帧驱动时间与第一人称移动。
// 经营规则一律放在 core/ 下;这里只做"把 core 的结果显示出来、把输入交给 core"。
import { _decorator, Camera, Canvas, Color, Component, DirectionalLight, Game, Layers, Material, Node, Quat, Vec3, director, game, resources, view } from 'cc';
import { GameSession } from '../core/GameSession';
import { getCatalogItem, getTheme } from '../core/data/Catalog';
import { describeEvent } from '../core/events/EventSystem';
import { WEATHER } from '../core/events/Weather';
import { PlayerMotion } from '../core/player/PlayerMotion';
import { SaveManager } from '../core/save/SaveGame';
import type { AdProvider } from '../core/services/AdProvider';
import { createInitialState } from '../core/state/GameState';
import type { StoreLayout } from '../core/world/StoreLayout';
import { hourAt } from '../core/time/GameClock';
import { tutorialTarget } from '../core/tutorial/Tutorial';
import { GameAction, listActions, runAction } from '../core/world/Actions';
import { checkPlacement, makeFixture, normalizeRotation, snap } from '../core/world/Placement';
import { obstaclesOf } from '../core/world/StoreLayout';
import { CocosStorage } from '../platform/CocosStorage';
import { getHudInsets } from '../platform/SafeArea';
import { StubAdProvider } from '../platform/StubAdProvider';
import { BoxFactory } from './BoxFactory';
import { ComputerPanel } from './ComputerPanel';
import { CustomersView } from './CustomersView';
import { DayNightView } from './DayNightView';
import { EventPanel } from './EventPanel';
import { HudView } from './HudView';
import { InputController } from './InputController';
import { JoystickView } from './JoystickView';
import { PlacementGhost, PlacementPanel } from './PlacementPanel';
import { ReportPanel } from './ReportPanel';
import { StoreBuilder } from './StoreBuilder';
import { GuideMarker, TutorialBanner } from './TutorialBanner';
import { WorldItemsView } from './WorldItemsView';

const { ccclass, property } = _decorator;
const DEG2RAD = Math.PI / 180;
/** 自动存档间隔(现实秒)。另外在开/关门、跨天、切到后台、销毁时也会存。 */
const AUTOSAVE_SECONDS = 30;
/** 单帧最多推进的时间,避免卡顿或切后台回来后时间猛跳。 */
const MAX_FRAME_SECONDS = 1;
/** 抱着纸箱时的移动速度倍率(规则:抱着箱子缓慢移动)。 */
const CARRY_SPEED_SCALE = 0.6;
/** 累计走动超过多少米,算完成新手引导第一步。 */
const MOVED_THRESHOLD_METERS = 3;

@ccclass('GameBootstrap')
export class GameBootstrap extends Component {
    @property({ tooltip: '视角灵敏度(度 / UI 像素)' })
    lookSensitivity = 0.12;

    @property({ tooltip: '眼睛离地高度(米)' })
    eyeHeight = 1.6;

    @property({ tooltip: '摄像机垂直视野角(度)' })
    fov = 65;

    private session!: GameSession;
    private saveManager!: SaveManager;
    private motion!: PlayerMotion;
    private input!: InputController;
    private joystick: JoystickView | null = null;
    private hud: HudView | null = null;
    private panel: ComputerPanel | null = null;
    private reportPanel: ReportPanel | null = null;
    private eventPanel: EventPanel | null = null;
    private tutorialBanner: TutorialBanner | null = null;
    private guideMarker: GuideMarker | null = null;
    private customersView: CustomersView | null = null;
    /** 当前是否有全屏面板打开(此时暂停玩家的移动与转视角)。 */
    private modalOpen = false;
    private movedMeters = 0;
    /** 开发期用占位广告;步骤 15 换成真实的微信激励视频。 */
    private readonly ads: AdProvider = new StubAdProvider();
    private worldItems: WorldItemsView | null = null;
    /** 当前位置可做的动作(每帧刷新),HUD 按钮的序号与它一一对应。 */
    private actions: GameAction[] = [];
    private dayNight: DayNightView | null = null;
    private cameraNode!: Node;
    private boxes!: BoxFactory;
    private storeBuilder!: StoreBuilder;
    private storeRoot: Node | null = null;
    /** 上次按哪个布局版本搭的 3D 店铺;session.layoutVersion 变了就重建。 */
    private builtLayoutVersion = -1;
    private placementPanel: PlacementPanel | null = null;
    private ghost: PlacementGhost | null = null;
    /** 摆放模式:正在放哪件设备、旋转了几次;null 表示没在摆放。 */
    private placing: { equipId: string; rot: number } | null = null;
    private placingCheck = { key: '', problem: null as string | null };
    private ready = false;
    private readonly unsubscribers: Array<() => void> = [];

    private readonly qYaw = new Quat();
    private readonly qPitch = new Quat();
    private readonly qOut = new Quat();

    start(): void {
        this.loadOrCreateSession();

        const layout = this.session.layout;
        this.motion = new PlayerMotion(layout.spawn, {
            bounds: layout.worldBounds,
            obstacles: obstaclesOf(layout),
        });
        this.input = new InputController();
        this.input.enable();

        this.schedule(this.persist, AUTOSAVE_SECONDS);
        game.on(Game.EVENT_HIDE, this.persist, this);

        // 材质必须通过资源加载(原因见 StoreBuilder),加载完成后才能搭建场景
        resources.load('materials/block', Material, (err, baseMaterial) => {
            if (err || !baseMaterial) {
                console.error('[GameBootstrap] 加载基础材质 resources/materials/block 失败', err);
                return;
            }
            this.buildWorld(baseMaterial);
        });
    }

    /** 读档;没有存档、存档损坏或来自更新版本时都从新游戏开始(后两种情况会打印警告)。 */
    private loadOrCreateSession(): void {
        this.saveManager = new SaveManager(new CocosStorage());
        const loaded = this.saveManager.load();
        if (loaded.kind === 'corrupt') console.warn(`[GameBootstrap] 存档损坏(${loaded.reason}),已备份并开始新游戏`);
        if (loaded.kind === 'tooNew') console.warn(`[GameBootstrap] 存档版本 ${loaded.version} 高于当前游戏,本次不会写入存档`);
        // 新游戏用随机种子,让每局的顾客序列不同;存档里会保存随机数状态,读档后序列继续
        const seed = Math.floor(Math.random() * 2147483646) + 1;
        this.session = new GameSession(loaded.kind === 'ok' ? loaded.state : createInitialState(seed));
        console.log(`[GameBootstrap] 存档状态:${loaded.kind},第 ${this.session.state.day} 天`);

        this.unsubscribers.push(
            this.session.events.on('dayChanged', (e) => {
                this.hud?.showMessage(`第 ${e.day} 天开始了`);
                this.persist();
            }),
            this.session.events.on('storeOpenChanged', (e) => {
                if (e.reason === 'nightfall') this.hud?.showMessage('天黑了,已自动打烊');
                if (e.reason === 'newDay') this.hud?.showMessage('新的一天,记得开门营业');
                this.persist();
            }),
            this.session.events.on('orderPlaced', () => this.persist()),
            this.session.events.on('customerNotice', (n) => {
                const text =
                    n.type === 'angry' ? '有顾客等太久,生气地走了(满意度下降)'
                    : n.type === 'noStock' ? '有顾客没找到想要的商品就走了'
                    : n.type === 'queueFull' ? '队伍太长,有顾客直接走了'
                    : '打烊了,排队的顾客被请走';
                this.hud?.showMessage(text);
            }),
            this.session.events.on('levelUp', (e) => {
                const unlocked = e.unlocked.length > 0 ? `,解锁:${e.unlocked.join('、')}` : '';
                this.hud?.showMessage(`升级了!现在是 ${e.level} 级${unlocked}`);
                this.persist();
            }),
            this.session.events.on('tutorialAdvanced', () => this.persist()),
            this.session.events.on('weatherChanged', (e) => {
                this.hud?.showMessage(`今天天气:${WEATHER[e.weather].name}${e.note ? `。${e.note}` : ''}`);
                this.persist();
            }),
            this.session.events.on('eventStarted', (e) => {
                this.hud?.showMessage(`突发事件:${describeEvent(e.event).title}`);
                this.persist();
            }),
            this.session.events.on('eventResolved', (e) => {
                this.hud?.showMessage(e.message);
                this.persist();
            }),
            this.session.events.on('dayReport', () => this.persist()),
            this.session.events.on('orderArrived', (e) => {
                const item = getCatalogItem(e.order.itemId);
                this.hud?.showMessage(`货车到了:${item ? item.name : e.order.itemId} 已送到店门口`);
                this.persist();
            }),
        );
    }

    private buildWorld(baseMaterial: Material): void {
        const boxes = new BoxFactory(baseMaterial);
        this.boxes = boxes;
        this.storeBuilder = new StoreBuilder(boxes);
        this.rebuildStore();
        const sun = this.ensureSunLight();
        const camera = this.setupCamera();
        this.cameraNode = camera.node;
        this.worldItems = new WorldItemsView(this.node, camera.node, boxes, this.session.layout);
        this.dayNight = new DayNightView(sun, camera);
        this.customersView = new CustomersView(this.node, boxes);
        this.ghost = new PlacementGhost(this.node, boxes);
        this.guideMarker = new GuideMarker(this.node, boxes);

        const canvas = director.getScene()?.getComponentInChildren(Canvas) ?? null;
        if (canvas) {
            this.joystick = new JoystickView(canvas);
            const insets = getHudInsets(view.getVisibleSize());
            this.hud = new HudView(canvas, insets, {
                onToggleStore: () => this.toggleStore(),
                onAction: (index) => this.runActionAt(index),
            });
            this.tutorialBanner = new TutorialBanner(canvas, insets, () => this.session.acknowledgeTutorial());
            this.eventPanel = new EventPanel(canvas, insets, (id, optionId) => this.respondToEvent(id, optionId));
            this.panel = new ComputerPanel(canvas, {
                session: this.session,
                ads: this.ads,
                onClose: () => undefined, // 输入的暂停/恢复统一在 update 里按"是否有面板打开"处理
            });
            this.placementPanel = new PlacementPanel(canvas, (equipId) => {
                this.placing = { equipId, rot: 0 };
            });
            this.reportPanel = new ReportPanel(canvas, () => {
                this.session.dismissReport();
                this.persist();
            });
        } else {
            console.warn('[GameBootstrap] 场景里没有 Canvas:HUD、摇杆和操作提示不会显示,但触摸/键盘操作仍然有效。');
        }

        this.applyCamera();
        this.dayNight.apply(hourAt(this.session.state.timeOfDay), this.session.state.weather);
        console.log(`[GameBootstrap] 启动完成:店铺节点数=${this.node.children[0]?.children.length ?? 0},Canvas=${canvas ? '有' : '无'}`);
        this.ready = true;
    }

    /** 按当前布局和主题(重新)搭建 3D 店铺,并更新玩家的碰撞范围。设施/扩建/主题变了才会调用。 */
    private rebuildStore(): void {
        if (this.storeRoot) {
            this.storeRoot.removeFromParent();
            this.storeRoot.destroy();
        }
        const layout = this.session.layout;
        this.storeRoot = this.storeBuilder.build(layout, getTheme(this.session.state.theme), this.node);
        this.motion.setWorld(layout.worldBounds, obstaclesOf(layout));
        this.builtLayoutVersion = this.session.layoutVersion;
    }

    onDestroy(): void {
        this.persist();
        this.input?.disable();
        game.off(Game.EVENT_HIDE, this.persist, this);
        this.unsubscribers.forEach((off) => off());
    }

    update(dt: number): void {
        if (!this.ready) return; // 材质还在加载,场景尚未搭好
        const state = this.session.state;

        this.session.tick(Math.min(dt, MAX_FRAME_SECONDS));
        if (this.session.layoutVersion !== this.builtLayoutVersion) this.rebuildStore();
        const layout = this.session.layout;

        const look = this.input.consumeLook();
        // 手指向右拖 = 向右转(yaw 减小);手指向上拖 = 抬头
        this.motion.turn(-look.dx * this.lookSensitivity, look.dy * this.lookSensitivity);
        const px = this.motion.x;
        const pz = this.motion.z;
        this.motion.step(this.input.getMove(), dt, this.session.carried ? CARRY_SPEED_SCALE : 1);
        this.applyCamera();
        if (!state.tutorial.moved) {
            this.movedMeters += Math.hypot(this.motion.x - px, this.motion.z - pz);
            if (this.movedMeters >= MOVED_THRESHOLD_METERS) this.session.reportMoved();
        }

        // 日报:每天结束后自动弹出,看完才继续
        if (state.pendingReport && this.reportPanel && !this.reportPanel.isOpen) this.reportPanel.show(state.pendingReport);
        if (!state.pendingReport && this.reportPanel?.isOpen) this.reportPanel.hide();

        // 有全屏面板(采购/日报)打开时,暂停玩家的移动与转视角
        const modal = (this.panel?.isOpen ?? false) || (this.reportPanel?.isOpen ?? false) || (this.placementPanel?.isOpen ?? false);
        if (modal !== this.modalOpen) {
            this.modalOpen = modal;
            this.input.setBlocked(modal);
        }

        // 当前位置能做的动作:走近电脑桌、收银台、卸货区、货架/冷柜时会出现按钮(PC 预览按 E 执行第一个)
        this.actions = modal ? [] : this.placing ? this.placingActions(layout) : listActions(state, layout, this.motion.x, this.motion.z);
        if (this.input.consumeInteract()) this.runActionAt(0);

        if (!this.placing) this.ghost?.update(null, 0, false);
        this.dayNight?.apply(hourAt(state.timeOfDay), state.weather);
        this.worldItems?.update(state, layout);
        this.customersView?.update(state, layout, dt);
        this.guideMarker?.update(tutorialTarget(state, layout), dt);
        this.joystick?.update(this.input.stick);
        this.panel?.update();
        this.tutorialBanner?.update(state);
        this.eventPanel?.update(state);
        this.hud?.update(state, this.session.phase, dt, this.actions.map((a) => a.label), this.carriedText());
    }

    /** 屏幕下方显示手里抱着的东西。 */
    private carriedText(): string {
        const c = this.session.carried;
        if (!c) return '';
        const item = getCatalogItem(c.itemId);
        return `手上:${item ? item.name : c.itemId} × ${c.units}(移动变慢)`;
    }

    /** 执行第 index 个动作:打开电脑,或搬运/上架/收纳,并把结果告诉玩家。 */
    private runActionAt(index: number): void {
        const action = this.actions[index];
        if (!action) return;
        if (action.type === 'openComputer') {
            if (this.panel && !this.panel.isOpen) this.panel.open();
            return;
        }
        if (action.type === 'startPlacing') {
            this.placementPanel?.open(this.session.state.warehouse);
            return;
        }
        if (action.type === 'rotate' && this.placing) {
            this.placing.rot = normalizeRotation(this.placing.rot + 1);
            return;
        }
        if (action.type === 'cancelPlacing') {
            this.placing = null;
            return;
        }
        if (action.type === 'placeHere' && this.placing) {
            const t = this.placeTarget();
            const r = this.session.placeFixture(this.placing.equipId, t.x, t.z, this.placing.rot);
            this.hud?.showMessage(r.ok ? r.info ?? '已摆放' : r.reason);
            if (r.ok) {
                this.persist();
                if ((this.session.state.warehouse[this.placing.equipId] ?? 0) < 1) this.placing = null; // 这种设备放完了
            }
            return;
        }
        const result = runAction(this.session, action);
        if (result.ok) {
            const fallback = action.type === 'pickUpCarton' ? '搬起了纸箱' : action.type === 'putDownCarton' ? '放回了卸货区' : action.type === 'scan' ? '扫码完成,可以收款了' : '';
            this.hud?.showMessage(result.info ?? fallback);
            this.persist();
        } else {
            this.hud?.showMessage(result.reason);
        }
    }

    /** 摆放目标位置:玩家正前方 2 米,吸附到网格。 */
    private placeTarget(): { x: number; z: number } {
        const yaw = this.motion.yawDeg * DEG2RAD;
        return { x: snap(this.motion.x - Math.sin(yaw) * 2), z: snap(this.motion.z - Math.cos(yaw) * 2) };
    }

    /** 摆放模式下屏幕右下角的三个按钮,同时刷新幽灵方块(绿 = 能放,红 = 不能放及原因)。 */
    private placingActions(layout: StoreLayout): GameAction[] {
        const placing = this.placing!;
        const def = getCatalogItem(`equip:${placing.equipId}`);
        if (!def || def.kind !== 'equipment' || (this.session.state.warehouse[placing.equipId] ?? 0) < 1) {
            this.placing = null;
            this.ghost?.update(null, 0, false);
            return [];
        }
        const t = this.placeTarget();
        const key = `${t.x},${t.z},${placing.rot},${this.session.layoutVersion},${placing.equipId}`;
        if (key !== this.placingCheck.key) {
            this.placingCheck = { key, problem: checkPlacement(layout, def, t.x, t.z, placing.rot) };
        }
        const problem = this.placingCheck.problem;
        const fixture = makeFixture('ghost', def, t.x, t.z, placing.rot);
        this.ghost?.update(fixture, fixture.height, problem === null);
        return [
            { type: 'placeHere', label: problem === null ? `放在这里:${def.name}` : `不能放:${problem}` },
            { type: 'rotate', label: '旋转 90 度' },
            { type: 'cancelPlacing', label: '取消摆放' },
        ];
    }

    /** 突发事件卡片上的选项:应对或不理会。 */
    private respondToEvent(eventId: number, optionId: string): void {
        const r = this.session.respondEvent(eventId, optionId);
        if (!r.ok) this.hud?.showMessage(r.reason); // 成功的提示由 eventResolved 事件统一显示
        else this.persist();
    }

    /** HUD 按钮:开门 / 打烊。失败时把原因告诉玩家。 */
    private toggleStore(): void {
        const result = this.session.state.isOpen ? this.session.closeStore() : this.session.openStore();
        if (!result.ok) this.hud?.showMessage(result.reason);
    }

    private persist(): void {
        this.saveManager?.save(this.session.state);
    }

    /** 把 core 里的位置/朝向同步到相机节点。 */
    private applyCamera(): void {
        this.cameraNode.setPosition(this.motion.x, this.eyeHeight, this.motion.z);
        // 先绕世界 y 轴转 yaw,再绕自身 x 轴抬头 pitch
        Quat.fromAxisAngle(this.qYaw, Vec3.UNIT_Y, this.motion.yawDeg * DEG2RAD);
        Quat.fromAxisAngle(this.qPitch, Vec3.UNIT_X, this.motion.pitchDeg * DEG2RAD);
        Quat.multiply(this.qOut, this.qYaw, this.qPitch);
        this.cameraNode.setRotation(this.qOut);
    }

    /** 优先使用场景里已有的 3D 相机(Main Camera),没有就创建一个。 */
    private setupCamera(): Camera {
        const scene = director.getScene()!;
        const existing = scene.getComponentsInChildren(Camera).find((c) => (c.visibility & Layers.Enum.DEFAULT) !== 0);
        let camera: Camera;
        if (existing) {
            camera = existing;
        } else {
            const node = new Node('Main Camera');
            scene.addChild(node);
            camera = node.addComponent(Camera);
            camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
            camera.clearColor = new Color(160, 205, 240, 255);
        }
        camera.fov = this.fov;
        camera.near = 0.05; // 贴墙时不要被近裁剪面切掉
        camera.far = 100;
        return camera;
    }

    /** 场景里没有平行光时补一盏,保证方块有明暗;返回用于昼夜变化的那盏光。 */
    private ensureSunLight(): DirectionalLight {
        const scene = director.getScene()!;
        const existing = scene.getComponentInChildren(DirectionalLight);
        if (existing) return existing;
        const sun = new Node('Sun');
        scene.addChild(sun);
        sun.setRotationFromEuler(-55, -35, 0);
        return sun.addComponent(DirectionalLight);
    }
}
