import type { ReactNode } from "react";
import type { GameSession } from "../core/GameSession";
import { Stars } from "./ItemIcon";

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overlay">
      <div className="panel">
        <h2 className="panel__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

interface Actions {
  onResume: () => void;
  onRestart: () => void;
  onExit: () => void;
  onRescue: () => void;
  onGiveUp: () => void;
  onNext?: () => void;
}

export function SessionPanel({
  session,
  requiredWrong,
  showResult,
  adPlaying,
  actions,
}: {
  session: GameSession;
  requiredWrong: number;
  showResult: boolean;
  adPlaying: boolean;
  actions: Actions;
}) {
  if (adPlaying) {
    return (
      <Panel title="广告播放中">
        <p className="panel__text">（模拟广告，第一阶段不接入真实 SDK）</p>
        <div className="spinner" />
      </Panel>
    );
  }
  if (!showResult) return null;

  switch (session.status) {
    case "paused":
      return (
        <Panel title="暂停">
          <button className="btn btn--primary" onClick={actions.onResume}>继续</button>
          <button className="btn" onClick={actions.onRestart}>重新开始</button>
          <button className="btn btn--ghost" onClick={actions.onExit}>返回选关</button>
        </Panel>
      );
    case "rescue":
      return (
        <Panel title="归位格满了">
          <p className="panel__text">放错的东西太多了，要清空归位格继续吗？</p>
          {session.canRescue() && (
            <button className="btn btn--primary" onClick={actions.onRescue}>看广告清空归位格（模拟）</button>
          )}
          <button className="btn" onClick={actions.onRestart}>重新开始</button>
          <button className="btn btn--ghost" onClick={actions.onGiveUp}>放弃</button>
        </Panel>
      );
    case "failed":
      return (
        <Panel title="挑战失败">
          <p className="panel__text">再试一次，先找最上面的目标。</p>
          <button className="btn btn--primary" onClick={actions.onRestart}>重新开始</button>
          <button className="btn btn--ghost" onClick={actions.onExit}>返回选关</button>
        </Panel>
      );
    case "completed":
      return (
        <Panel title="收拾干净了！">
          <Stars count={session.stars(requiredWrong)} />
          <p className="panel__text">
            放错 {session.wrongCount} 次{session.rescueUsed ? " · 使用了救场" : ""}
          </p>
          {actions.onNext && (
            <button className="btn btn--primary" onClick={actions.onNext}>下一关</button>
          )}
          <button className="btn" onClick={actions.onRestart}>再玩一次</button>
          <button className="btn btn--ghost" onClick={actions.onExit}>返回选关</button>
        </Panel>
      );
    default:
      return null;
  }
}
