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
  onToggleSound: () => void;
}

/** 章节进度，通关面板上显示，给玩家“在往前走”的感觉 */
export interface ChapterProgress {
  completed: number;
  total: number;
  stars: number;
}

export function SessionPanel({
  session,
  showResult,
  adPlaying,
  adError,
  soundEnabled,
  progress,
  bestScore,
  actions,
}: {
  session: GameSession;
  showResult: boolean;
  adPlaying: boolean;
  /** 广告失败时的提示（“广告加载失败，请重试”），有则显示在救场面板里 */
  adError?: string | null;
  soundEnabled: boolean;
  progress?: ChapterProgress;
  /** 本关历史最高分（含本次） */
  bestScore?: number;
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
          <button className="btn" onClick={actions.onToggleSound}>音效与震动：{soundEnabled ? "开" : "关"}</button>
          <button className="btn btn--ghost" onClick={actions.onExit}>返回选关</button>
        </Panel>
      );
    case "rescue":
      return (
        <Panel title="归位格满了">
          <p className="panel__text">放错的东西太多了，要清空归位格继续吗？</p>
          <p className="panel__note">{fairNote(session)}</p>
          {adError && <p className="panel__error">{adError}</p>}
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
          <p className="panel__text">
            {session.failReason === "timeout"
              ? "时间到了！120 秒内没找完，再试一次吧。"
              : "先拿顶上那些压住目标的东西，能少放错几次。"}
          </p>
          <p className="panel__note">{fairNote(session)}</p>
          <button className="btn btn--primary" onClick={actions.onRestart}>重新开始</button>
          <button className="btn btn--ghost" onClick={actions.onExit}>返回选关</button>
        </Panel>
      );
    case "completed":
      return (
        <Panel title="收拾干净了！">
          <Stars count={session.stars()} />
          <div className="tidy-bar">
            <div className="tidy-bar__label">整洁度 100%</div>
            <div className="tidy-bar__track">
              <span />
            </div>
          </div>
          <p className="panel__text">
            本关分数 {session.score}
            {bestScore !== undefined && bestScore > 0 ? ` · 最高分 ${Math.max(bestScore, session.score)}` : ""}
          </p>
          <p className="panel__text">
            放错 {session.wrongCount} 次{session.level.requiredWrong > 0 ? `（本关至少要放错 ${session.level.requiredWrong} 次）` : ""}
            {session.rescueUsed ? " · 使用了救场" : ""}
          </p>
          {progress && (
            <div className="chapter-progress">
              <div className="chapter-progress__label">
                第一章 {progress.completed}/{progress.total} 关 · ★ {progress.stars}/{progress.total * 3}
              </div>
              <div className="chapter-progress__bar">
                <span style={{ width: `${(progress.completed / progress.total) * 100}%` }} />
              </div>
            </div>
          )}
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

/** 明确告诉玩家关卡一定能过，避免“故意做成死局逼人看广告”的观感 */
function fairNote(session: GameSession): string {
  const n = session.level.requiredWrong;
  return n === 0 ? "本关一定有解：一次都不放错就能通关，不需要看广告。" : `本关一定有解：最少只需放错 ${n} 次，不需要看广告。`;
}
