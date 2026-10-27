// 测试专用的固定数据:初始小店布局、内存存储。生产代码不需要它们,所以放在 tests 里。
import type { KeyValueStorage } from '../../assets/scripts/core/save/KeyValueStorage';
import { buildLayout, initialFixtures } from '../../assets/scripts/core/world/StoreLayout';

/** 初始小店布局(扩建 0 级、初始设施)。 */
export const STREET_STORE_LAYOUT = buildLayout(0, initialFixtures());

export class MemoryStorage implements KeyValueStorage {
    private readonly data = new Map<string, string>();

    getItem(key: string): string | null {
        return this.data.has(key) ? this.data.get(key)! : null;
    }

    setItem(key: string, value: string): void {
        this.data.set(key, value);
    }

    removeItem(key: string): void {
        this.data.delete(key);
    }
}
