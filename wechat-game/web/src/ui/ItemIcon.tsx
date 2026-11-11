import type { CSSProperties } from "react";
import { ITEM_MAP } from "../data";

/** HUD 中的物件图标：与场景贴图一致，只显示图标，不带文字和边框 */
export function ItemIcon({ itemId, style }: { itemId: string; variantId?: string; style?: CSSProperties }) {
  const item = ITEM_MAP.get(itemId);
  if (!item) return null;
  return (
    <span className="item-icon" style={style} title={item.name} aria-label={item.name}>
      {item.icon}
    </span>
  );
}

export function Stars({ count, total = 3 }: { count: number; total?: number }) {
  return (
    <span className="stars" aria-label={`${count} 星`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < count ? "star star--on" : "star"}>
          ★
        </span>
      ))}
    </span>
  );
}
