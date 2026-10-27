import { PlayerMotion, MoveInput } from '../../assets/scripts/core/player/PlayerMotion';
import { STREET_STORE_LAYOUT } from './fixtures';

/** 用真实店铺布局创建一个玩家,可指定出生点。 */
export function makePlayer(x?: number, z?: number, yawDeg?: number): PlayerMotion {
    const layout = STREET_STORE_LAYOUT;
    const spawn = {
        x: x ?? layout.spawn.x,
        z: z ?? layout.spawn.z,
        yawDeg: yawDeg ?? layout.spawn.yawDeg,
    };
    return new PlayerMotion(spawn, {
        bounds: layout.worldBounds,
        obstacles: [...layout.walls, ...layout.fixtures],
    });
}

/** 以 60 帧/秒的节奏持续输入若干秒。 */
export function run(p: PlayerMotion, input: MoveInput, seconds: number): void {
    const frames = Math.round(seconds * 60);
    for (let i = 0; i < frames; i++) p.step(input, 1 / 60);
}

export const FORWARD: MoveInput = { moveX: 0, moveY: 1 };
export const BACKWARD: MoveInput = { moveX: 0, moveY: -1 };
export const RIGHT: MoveInput = { moveX: 1, moveY: 0 };
