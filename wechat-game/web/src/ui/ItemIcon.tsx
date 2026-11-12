import type { CSSProperties } from "react";
import { ITEM_MAP } from "../data";
import { spriteUrl } from "../render/sprites";

/** HUD 中的物件图标：与场景里用同一张贴图，只显示图标，不带文字和边框 */
export function ItemIcon({ itemId, variantId, style }: { itemId: string; variantId?: string; style?: CSSProperties }) {
  const item = ITEM_MAP.get(itemId);
  if (!item) return null;
  const variant = variantId ?? item.defaultVariantId;
  return <img className="item-icon" style={style} src={spriteUrl(itemId, variant)} alt={item.name} title={item.name} draggable={false} />;
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
