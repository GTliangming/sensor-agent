import { useEffect, useState, type RefObject } from "react";
import { BASE_HEIGHT, DESIGN_WIDTH, MAX_HEIGHT, computeLayout, type StageLayout } from "../layout";

/** 读取 CSS 安全区（刘海、底部手势条），单位 CSS 像素 */
function readSafeArea(): { top: number; bottom: number } {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const result = { top: parseFloat(style.paddingTop) || 0, bottom: parseFloat(style.paddingBottom) || 0 };
  probe.remove();
  return result;
}

/** 根据舞台实际尺寸和安全区计算布局，舞台尺寸变化（旋转、调整窗口）时自动更新 */
export function useStageLayout(ref: RefObject<HTMLElement | null>): StageLayout {
  const [layout, setLayout] = useState<StageLayout>(() => computeLayout());
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { clientWidth, clientHeight } = el;
      if (clientWidth === 0) return;
      const scale = DESIGN_WIDTH / clientWidth;
      const height = Math.min(MAX_HEIGHT, Math.max(BASE_HEIGHT, clientHeight * scale));
      const safe = readSafeArea();
      const next = computeLayout(height, safe.top * scale, safe.bottom * scale);
      setLayout((prev) =>
        prev.height === next.height && prev.safeTop === next.safeTop && prev.safeBottom === next.safeBottom ? prev : next,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, [ref]);
  return layout;
}
