// 游戏入口组件:挂在场景里的一个空节点上。启动时读档、生成店铺、接好相机/输入/HUD,并每帧驱动时间与第一人称移动。
// 经营规则一律放在 core/ 下;这里只做"把 core 的结果显示出来、把输入交给 core"。
import { _decorator, Camera, Canvas, Color, Component, DirectionalLight, Game, Layers, Material, Node, Quat, Vec3, director, game, resources } from 'cc';
import { GameSession } from '../core/GameSession';
import { PlayerMotion } from '../core/player/PlayerMotion';
import { SaveManager } from '../core/save/SaveGame';
import { createInitialState } from '../core/state/GameState';
import { hourAt } from '../core/time/GameClock';
import { STREET_STORE_LAYOUT } from '../core/world/StoreLayout';
import { CocosStorage } from '../platform/CocosStorage';
import { DayNightView } from './DayNightView';
import { HudView } from './HudView';
import { InputController } from './InputController';
import { JoystickView } from './JoystickView';
import { StoreBuilder } from './StoreBuilder';

const { ccclass, property } = _decorator;
const DEG2RAD = Math.PI / 180;
/** 自动存档间隔(现实秒)。另外在开/关门、跨天、切到后台、销毁时也会存。 */
const AUTOSAVE_SECONDS = 30;
/** 单帧最多推进的时间,避免卡顿或切后台回来后时间猛跳。 */
const MAX_FRAME_SECONDS = 1;

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
    private dayNight: DayNightView | null = null;
    private cameraNode!: Node;
    private ready = false;
    private readonly unsubscribers: Array<() => void> = [];

    private readonly qYaw = new Quat();
    private readonly qPitch = new Quat();
    private readonly qOut = new Quat();

    start(): void {
        this.loadOrCreateSession();

        const layout = STREET_STORE_LAYOUT;
        this.motion = new PlayerMotion(layout.spawn, {
            bounds: layout.worldBounds,
            obstacles: [...layout.walls, ...layout.fixtures],
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
        this.session = new GameSession(loaded.kind === 'ok' ? loaded.state : createInitialState());
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
        );
    }

    private buildWorld(baseMaterial: Material): void {
        new StoreBuilder(baseMaterial).build(STREET_STORE_LAYOUT, this.node);
        const sun = this.ensureSunLight();
        const camera = this.setupCamera();
        this.cameraNode = camera.node;
        this.dayNight = new DayNightView(sun, camera);

        const canvas = director.getScene()?.getComponentInChildren(Canvas) ?? null;
        if (canvas) {
            this.joystick = new JoystickView(canvas);
            this.hud = new HudView(canvas, () => this.toggleStore());
        } else {
            console.warn('[GameBootstrap] 场景里没有 Canvas:HUD、摇杆和操作提示不会显示,但触摸/键盘操作仍然有效。');
        }

        this.applyCamera();
        this.dayNight.apply(hourAt(this.session.state.timeOfDay));
        console.log(`[GameBootstrap] 启动完成:店铺节点数=${this.node.children[0]?.children.length ?? 0},Canvas=${canvas ? '有' : '无'}`);
        this.ready = true;
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

        const look = this.input.consumeLook();
        // 手指向右拖 = 向右转(yaw 减小);手指向上拖 = 抬头
        this.motion.turn(-look.dx * this.lookSensitivity, look.dy * this.lookSensitivity);
        this.motion.step(this.input.getMove(), dt);
        this.applyCamera();

        this.dayNight?.apply(hourAt(state.timeOfDay));
        this.joystick?.update(this.input.stick);
        this.hud?.update(state, this.session.phase, dt);
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
