// 输入层:把触摸 / 键盘 / 鼠标翻译成"移动意图"和"视角增量",不直接改任何游戏数据。
// 触屏:屏幕左半边按下 = 虚拟摇杆,右半边拖动 = 转视角;PC 预览:WASD / 方向键移动,按住鼠标拖动转视角。
import { Input, input, EventTouch, EventKeyboard, EventMouse, KeyCode, Touch, view } from 'cc';
import type { MoveInput } from '../core/player/PlayerMotion';

/** 摇杆最大拖动半径(UI 设计分辨率下的像素)。 */
const STICK_RADIUS = 90;

export interface StickState {
    active: boolean;
    /** 摇杆底座中心与当前拇指位置,单位:UI 坐标(原点在屏幕左下)。 */
    centerX: number;
    centerY: number;
    thumbX: number;
    thumbY: number;
    radius: number;
}

export class InputController {
    readonly stick: StickState = { active: false, centerX: 0, centerY: 0, thumbX: 0, thumbY: 0, radius: STICK_RADIUS };

    private stickTouchId: number | null = null;
    private lookTouchId: number | null = null;
    private lastLookX = 0;
    private lastLookY = 0;
    private lookDX = 0;
    private lookDY = 0;
    private mouseDragging = false;
    private interactPressed = false;
    /** 打开面板等场景下为 true:忽略移动/转视角输入,避免点面板时视角乱转。 */
    private blocked = false;
    private readonly keys = new Set<KeyCode>();
    private enabled = false;

    /** 暂停/恢复游戏内操作(移动、转视角、交互键)。 */
    setBlocked(blocked: boolean): void {
        this.blocked = blocked;
        if (blocked) {
            this.releaseAll();
            this.lookDX = 0;
            this.lookDY = 0;
            this.interactPressed = false;
        }
    }

    /** 取走"交互键(E)被按下"的标记。 */
    consumeInteract(): boolean {
        const pressed = this.interactPressed;
        this.interactPressed = false;
        return pressed;
    }

    enable(): void {
        if (this.enabled) return;
        this.enabled = true;
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    }

    disable(): void {
        if (!this.enabled) return;
        this.enabled = false;
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
        this.releaseAll();
    }

    /** 当前帧的移动意图:摇杆优先,没有摇杆时看键盘。 */
    getMove(): MoveInput {
        if (this.stick.active) {
            const dx = (this.stick.thumbX - this.stick.centerX) / this.stick.radius;
            const dy = (this.stick.thumbY - this.stick.centerY) / this.stick.radius;
            return { moveX: dx, moveY: dy };
        }
        let mx = 0;
        let my = 0;
        if (this.keys.has(KeyCode.KEY_W) || this.keys.has(KeyCode.ARROW_UP)) my += 1;
        if (this.keys.has(KeyCode.KEY_S) || this.keys.has(KeyCode.ARROW_DOWN)) my -= 1;
        if (this.keys.has(KeyCode.KEY_D) || this.keys.has(KeyCode.ARROW_RIGHT)) mx += 1;
        if (this.keys.has(KeyCode.KEY_A) || this.keys.has(KeyCode.ARROW_LEFT)) mx -= 1;
        return { moveX: mx, moveY: my };
    }

    /** 取走自上次调用以来累积的视角拖动量(UI 像素;dx 向右为正,dy 向上为正)。 */
    consumeLook(): { dx: number; dy: number } {
        const r = { dx: this.lookDX, dy: this.lookDY };
        this.lookDX = 0;
        this.lookDY = 0;
        return r;
    }

    // ---------- 触摸 ----------

    private onTouchStart(e: EventTouch): void {
        if (this.blocked) return;
        const halfWidth = view.getVisibleSize().width / 2;
        for (const t of this.touchesOf(e)) {
            const id = t.getID();
            if (id === this.stickTouchId || id === this.lookTouchId) continue;
            const p = t.getUILocation();
            if (p.x < halfWidth && this.stickTouchId === null) {
                this.stickTouchId = id;
                this.stick.active = true;
                this.stick.centerX = this.stick.thumbX = p.x;
                this.stick.centerY = this.stick.thumbY = p.y;
            } else if (p.x >= halfWidth && this.lookTouchId === null) {
                this.lookTouchId = id;
                this.lastLookX = p.x;
                this.lastLookY = p.y;
            }
        }
    }

    private onTouchMove(e: EventTouch): void {
        if (this.blocked) return;
        for (const t of this.touchesOf(e)) {
            const id = t.getID();
            const p = t.getUILocation();
            if (id === this.stickTouchId) {
                // 拇指限制在摇杆半径内
                let dx = p.x - this.stick.centerX;
                let dy = p.y - this.stick.centerY;
                const len = Math.hypot(dx, dy);
                if (len > this.stick.radius) {
                    dx = (dx / len) * this.stick.radius;
                    dy = (dy / len) * this.stick.radius;
                }
                this.stick.thumbX = this.stick.centerX + dx;
                this.stick.thumbY = this.stick.centerY + dy;
            } else if (id === this.lookTouchId) {
                this.lookDX += p.x - this.lastLookX;
                this.lookDY += p.y - this.lastLookY;
                this.lastLookX = p.x;
                this.lastLookY = p.y;
            }
        }
    }

    private onTouchEnd(e: EventTouch): void {
        const id = e.touch ? e.touch.getID() : -1;
        if (id === this.stickTouchId) {
            this.stickTouchId = null;
            this.stick.active = false;
        }
        if (id === this.lookTouchId) this.lookTouchId = null;
    }

    private onTouchCancel(): void {
        this.releaseAll();
    }

    /** 合并事件里的触点(不同版本 getTouches / getAllTouches 的语义略有差异,取并集并去重)。 */
    private touchesOf(e: EventTouch): Touch[] {
        const seen = new Set<number>();
        const out: Touch[] = [];
        const push = (t: Touch | null | undefined) => {
            if (t && !seen.has(t.getID())) {
                seen.add(t.getID());
                out.push(t);
            }
        };
        push(e.touch);
        for (const t of e.getTouches()) push(t);
        for (const t of e.getAllTouches()) push(t);
        return out;
    }

    // ---------- 键盘 / 鼠标(PC 预览) ----------

    private onKeyDown(e: EventKeyboard): void {
        if (this.blocked) return;
        if (e.keyCode === KeyCode.KEY_E) this.interactPressed = true;
        this.keys.add(e.keyCode);
    }

    private onKeyUp(e: EventKeyboard): void {
        this.keys.delete(e.keyCode);
    }

    private onMouseDown(): void {
        if (this.blocked) return;
        this.mouseDragging = true;
    }

    private onMouseMove(e: EventMouse): void {
        if (!this.mouseDragging || this.blocked) return;
        this.lookDX += e.getUIDeltaX();
        this.lookDY += e.getUIDeltaY();
    }

    private onMouseUp(): void {
        this.mouseDragging = false;
    }

    private releaseAll(): void {
        this.stickTouchId = null;
        this.lookTouchId = null;
        this.stick.active = false;
        this.mouseDragging = false;
        this.keys.clear();
    }
}
