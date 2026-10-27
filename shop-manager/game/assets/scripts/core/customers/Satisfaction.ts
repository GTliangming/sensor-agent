// 满意度的增减(夹在 0~100)。单独成文件,让顾客系统、反馈、事件等模块都能直接引用,不必互相绕路。
import type { GameState } from '../state/GameState';

export function addSatisfaction(state: GameState, delta: number): void {
    state.satisfaction = Math.min(100, Math.max(0, state.satisfaction + delta));
}
