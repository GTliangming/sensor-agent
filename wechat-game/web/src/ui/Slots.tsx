import type { GameSession } from "../core/GameSession";
import { STORAGE_ROW, TARGET_ROW, storageSlotCenter, targetSlotCenter, toCssPercent, DESIGN_WIDTH } from "../layout";
import { ItemIcon } from "./ItemIcon";

const pct = (designPx: number) => `${(designPx / DESIGN_WIDTH) * 100}cqw`;

function slotStyle(center: { x: number; y: number }, size: number) {
  return { ...toCssPercent(center.x, center.y), width: pct(size), height: pct(size) };
}

/** 顶部找寻格：每种目标占一格，显示“剩余数量 / 初始总数量” */
export function TargetSlots({ session }: { session: GameSession }) {
  const count = session.objectives.length;
  return (
    <>
      {session.objectives.map((o, i) => {
        const display = session.level.objectives[i].displayVariant;
        return (
          <div
            key={o.itemId}
            className={o.completed ? "slot target-slot target-slot--done" : "slot target-slot"}
            style={slotStyle(targetSlotCenter(i, count), TARGET_ROW.slotSize)}
          >
            <ItemIcon itemId={o.itemId} variantId={display} />
            <span className="target-slot__count">
              {o.completed ? "✓" : `${o.requiredCount - o.collectedCount}/${o.requiredCount}`}
            </span>
          </div>
        );
      })}
    </>
  );
}

/** 底部归位格：存放错误物件。arriving 中的物件还在飞行，暂不显示图标 */
export function StorageSlots({ session, arriving }: { session: GameSession; arriving: Set<string> }) {
  const count = session.collection.length;
  return (
    <>
      {session.collection.map((slot, i) => (
        <div
          key={i}
          className={slot ? "slot storage-slot storage-slot--filled" : "slot storage-slot"}
          style={slotStyle(storageSlotCenter(i, count), STORAGE_ROW.slotSize)}
        >
          {slot && !arriving.has(slot.instanceId) && <ItemIcon itemId={slot.itemId} variantId={slot.variantId} />}
        </div>
      ))}
    </>
  );
}
