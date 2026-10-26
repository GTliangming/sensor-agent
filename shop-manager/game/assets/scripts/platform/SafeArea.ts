// 屏幕安全区与微信胶囊按钮的避让:返回 HUD 各边应该留出的距离(UI 设计分辨率单位)。
// 刘海屏/圆角屏用 Cocos 的 sys.getSafeAreaRect();微信小游戏右上角的胶囊按钮用 wx.getMenuButtonBoundingClientRect()。
import { sys } from 'cc';

// 微信运行环境才有的全局对象;浏览器预览里不存在,所以所有访问前都要判断
declare const wx: any;

export interface HudInsets {
    left: number;
    right: number;
    top: number;
    bottom: number;
    /** 右上角这组 UI 的顶部距离:要排在胶囊按钮下面。 */
    rightTop: number;
}

export function getHudInsets(design: { width: number; height: number }): HudInsets {
    const insets: HudInsets = { left: 0, right: 0, top: 0, bottom: 0, rightTop: 0 };

    try {
        const safe = sys.getSafeAreaRect();
        insets.left = Math.max(0, safe.x);
        insets.bottom = Math.max(0, safe.y);
        insets.right = Math.max(0, design.width - (safe.x + safe.width));
        insets.top = Math.max(0, design.height - (safe.y + safe.height));
    } catch (e) {
        // 取不到安全区就当作没有
    }
    insets.rightTop = insets.top;

    try {
        if (typeof wx !== 'undefined' && wx.getMenuButtonBoundingClientRect) {
            const capsule = wx.getMenuButtonBoundingClientRect(); // 单位:屏幕逻辑像素
            const win = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
            const scale = design.width / win.windowWidth; // 逻辑像素 -> 设计分辨率
            insets.rightTop = Math.max(insets.rightTop, capsule.bottom * scale + 8);
        }
    } catch (e) {
        // 接口不可用时保持默认值
    }
    return insets;
}
