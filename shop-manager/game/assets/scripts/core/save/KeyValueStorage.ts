// 键值存储抽象:core 只依赖这个接口,不关心背后是浏览器 localStorage、微信存储还是内存。
// 真实实现放在 platform/CocosStorage;测试用的内存实现在 tests/core/fixtures.ts。

export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
