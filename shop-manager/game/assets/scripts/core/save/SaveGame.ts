// 存档:只保存状态数据(JSON),不保存任何 3D 对象。带 schema_version,便于以后升级迁移。
import type { KeyValueStorage } from './KeyValueStorage';
import type { GameState } from '../state/GameState';

export const SAVE_SCHEMA_VERSION = 1;

export type LoadResult =
    | { kind: 'empty' }
    | { kind: 'ok'; state: GameState }
    | { kind: 'corrupt'; reason: string }
    /** 存档来自更新的游戏版本:不能读,也不能覆盖。 */
    | { kind: 'tooNew'; version: number };

export function serializeState(state: GameState): string {
    return JSON.stringify({ schema_version: SAVE_SCHEMA_VERSION, state });
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);

/** 解析并校验存档文本。校验失败返回 corrupt,绝不抛异常。 */
export function parseSave(raw: string | null | undefined): LoadResult {
    // 空字符串与 null 都表示"没有存档"(部分平台的存储对不存在的 key 返回空字符串)
    if (raw === null || raw === undefined || raw === '') return { kind: 'empty' };

    let obj: any;
    try {
        obj = JSON.parse(raw);
    } catch {
        return { kind: 'corrupt', reason: '不是合法的 JSON' };
    }
    if (typeof obj !== 'object' || obj === null) return { kind: 'corrupt', reason: '存档不是对象' };

    const version = obj.schema_version;
    if (!isInt(version) || version < 1) return { kind: 'corrupt', reason: 'schema_version 缺失或无效' };
    if (version > SAVE_SCHEMA_VERSION) return { kind: 'tooNew', version };
    // 目前只有 v1;以后出现 v2 时,在这里按版本逐级迁移到最新结构

    const s = obj.state;
    if (typeof s !== 'object' || s === null) return { kind: 'corrupt', reason: '缺少 state' };
    if (!isInt(s.coins)) return { kind: 'corrupt', reason: 'coins 无效' };
    if (!isNum(s.satisfaction)) return { kind: 'corrupt', reason: 'satisfaction 无效' };
    if (!isInt(s.level) || s.level < 1) return { kind: 'corrupt', reason: 'level 无效' };
    if (!isInt(s.day) || s.day < 1) return { kind: 'corrupt', reason: 'day 无效' };
    if (!isNum(s.timeOfDay) || s.timeOfDay < 0 || s.timeOfDay >= 1) return { kind: 'corrupt', reason: 'timeOfDay 无效' };
    if (typeof s.isOpen !== 'boolean') return { kind: 'corrupt', reason: 'isOpen 无效' };

    return {
        kind: 'ok',
        state: {
            coins: s.coins,
            satisfaction: Math.min(100, Math.max(0, s.satisfaction)),
            level: s.level,
            day: s.day,
            timeOfDay: s.timeOfDay,
            isOpen: s.isOpen,
        },
    };
}

export class SaveManager {
    /** 读到更新版本的存档时置为 true,此后不再写入,避免把玩家的新版存档覆盖掉。 */
    private writeLocked = false;

    constructor(
        private readonly storage: KeyValueStorage,
        private readonly key = 'shop-manager.save',
    ) {}

    load(): LoadResult {
        const raw = this.storage.getItem(this.key);
        const result = parseSave(raw);
        if (result.kind === 'corrupt' && raw !== null) {
            // 保留一份损坏的原文以便排查,然后清掉主存档,允许重新开局
            this.storage.setItem(`${this.key}.corrupt`, raw);
            this.storage.removeItem(this.key);
        } else if (result.kind === 'tooNew') {
            this.writeLocked = true;
        }
        return result;
    }

    /** 保存。返回是否真的写入了。 */
    save(state: GameState): boolean {
        if (this.writeLocked) return false;
        try {
            this.storage.setItem(this.key, serializeState(state));
            return true;
        } catch {
            return false; // 存储空间不足等:不能因为存档失败让游戏崩溃
        }
    }
}
