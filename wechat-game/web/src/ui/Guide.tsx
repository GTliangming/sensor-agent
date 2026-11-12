import { useEffect, useState } from "react";
import { toCssPercent, type StageLayout } from "../layout";
import type { ThreeStage } from "../render/ThreeStage";

/** 第 1 关新手引导：point = 手指指向一个目标；storage = 讲解归位格；none = 不显示 */
export type GuideStep = "point" | "storage" | "none";

interface Props {
  step: GuideStep;
  targetId: string | null;
  stage: ThreeStage | null;
  root: HTMLElement | null;
  layout: StageLayout;
}

export function Guide({ step, targetId, stage, root, layout }: Props) {
  const [hand, setHand] = useState<{ left: number; top: number } | null>(null);

  // 手指位置跟着目标物件实际露出来的地方走；布局变化或换目标时重新计算
  useEffect(() => {
    if (step !== "point" || !targetId || !stage || !root) {
      setHand(null);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const point = stage.findTapPoint(targetId);
      const rect = root.getBoundingClientRect();
      setHand(point ? { left: point.x - rect.left, top: point.y - rect.top } : null);
    });
    return () => cancelAnimationFrame(frame);
  }, [step, targetId, stage, root, layout]);

  if (step === "point") {
    return (
      <>
        <div className="guide-tip" style={{ top: toCssPercent(layout, 0, layout.board.y + layout.board.height - 40).top }}>
          找出和上面一样的东西，点它
        </div>
        {hand && <div className="guide-hand" style={{ left: hand.left, top: hand.top }}>👆</div>}
      </>
    );
  }
  if (step === "storage") {
    return (
      <div className="guide-tip guide-tip--storage" style={{ top: toCssPercent(layout, 0, layout.storageLabelY + 70).top }}>
        点错的东西会进入下面的归位格，放满 4 个就要重来
      </div>
    );
  }
  return null;
}
