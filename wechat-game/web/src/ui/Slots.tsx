import type { GameSession } from "../core/GameSession";
import { cqw, slotCenter, toCssPercent, type SlotRow, type StageLayout } from "../layout";
import { ItemIcon } from "./ItemIcon";

function slotStyle(layout: StageLayout, row: SlotRow, index: number, count: number) {
  const center = slotCenter(row, index, count);
  return { ...toCssPercent(layout, center.x, center.y), width: cqw(row.slotSize), height: cqw(row.slotSize) };
}

interface TargetProps {
  session: GameSession;
  layout: StageLayout;
  /** 每个找寻格最近一次收到物件的序号，变化时播放弹跳动画 */
  bumps: number[];
  onLocateLast: (objectiveIndex: number) => void;
}

/**
 * 顶部找寻格：每种目标占一格，显示“剩余数量 / 初始总数量”。
 * 只差最后 1 个时格子上出现放大镜，点一下免费定位它。
 */
export function TargetSlots({ session, layout, bumps, onLocateLast }: TargetProps) {
  const count = session.objectives.length;
  return (
    <>
      {session.objectives.map((o, i) => {
        const display = session.level.objectives[i].displayVariant;
        const locatable = session.canLocateLast(i);
        const className = [
          "slot",
          "target-slot",
          o.completed && "target-slot--done",
          locatable && "target-slot--locate",
          (bumps[i] ?? 0) > 0 && "target-slot--bump",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={`${o.itemId}-${bumps[i] ?? 0}`}
            className={className}
            style={slotStyle(layout, layout.target, i, count)}
            disabled={!locatable}
            onClick={() => onLocateLast(i)}
            aria-label={locatable ? "定位最后一个" : undefined}
          >
            <ItemIcon itemId={o.itemId} variantId={display} />
            <span className="target-slot__count">
              {o.completed ? "✓" : `${o.requiredCount - o.collectedCount}/${o.requiredCount}`}
            </span>
            {locatable && <span className="target-slot__locate">🔍</span>}
          </button>
        );
      })}
    </>
  );
}

/** 底部归位格：存放错误物件。arriving 中的物件还在飞行，暂不显示图标。只剩 1 格时整行变红警告 */
export function StorageSlots({ session, layout, arriving }: { session: GameSession; layout: StageLayout; arriving: Set<string> }) {
  const count = session.collection.length;
  const used = session.collection.filter(Boolean).length;
  const danger = session.status === "playing" && used === count - 1;
  return (
    <>
      <div
        className={danger ? "storage-label storage-label--danger" : "storage-label"}
        style={{ top: toCssPercent(layout, 0, layout.storageLabelY).top }}
      >
        {danger ? `归位格只剩 1 格了！再放错就满了` : `归位格 ${used}/${count}`}
      </div>
      {session.collection.map((slot, i) => (
        <div
          key={i}
          className={["slot", "storage-slot", slot && "storage-slot--filled", danger && !slot && "storage-slot--danger"]
            .filter(Boolean)
            .join(" ")}
          style={slotStyle(layout, layout.storage, i, count)}
        >
          {slot && !arriving.has(slot.instanceId) && <ItemIcon itemId={slot.itemId} variantId={slot.variantId} />}
        </div>
      ))}
    </>
  );
}
