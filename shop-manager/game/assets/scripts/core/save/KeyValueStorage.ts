// 键值存储抽象:core 只依赖这个接口,不关心背后是浏览器 localStorage、微信存储还是内存。
// 微信小游戏的真实实现放在 platform/ 下;测试用下面的 MemoryStorage。

export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

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
