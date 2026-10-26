// 微信小游戏 / 浏览器预览共用的存档存储:Cocos 的 sys.localStorage 在两个平台上都有对应实现。
// core 只依赖 KeyValueStorage 接口,换平台只需要换这个文件。
import { sys } from 'cc';
import type { KeyValueStorage } from '../core/save/KeyValueStorage';

export class CocosStorage implements KeyValueStorage {
    /**
     * 不同平台对"没有这个 key"的返回值不一致:浏览器是 null,微信小游戏里实测返回空字符串(wx.getStorageSync 的行为)。
     * 统一归一化成 null,core 层只需要处理 null。
     */
    getItem(key: string): string | null {
        const v = sys.localStorage.getItem(key);
        return v === null || v === undefined || v === '' ? null : String(v);
    }

    setItem(key: string, value: string): void {
        sys.localStorage.setItem(key, value);
    }

    removeItem(key: string): void {
        sys.localStorage.removeItem(key);
    }
}
