import type { SaveData } from "../core/save";
import type { ChapterConfig } from "../core/types";
import { Stars } from "./ItemIcon";
import type { ChapterProgress } from "./Panels";

type LevelSummary = ChapterConfig["levels"][number];

interface Props {
  chapter: ChapterConfig;
  save: SaveData;
  progress: ChapterProgress;
  /** 正在加载的关卡 ID（显示加载中，避免重复点击） */
  loadingId: string | null;
  /** 贴图预加载进度 0–100 */
  loadProgress: number;
  /** 上一次加载失败的关卡，显示重试入口 */
  loadError: { id: string; message: string } | null;
  onSelect: (level: LevelSummary) => void;
  onRetry: () => void;
  onToggleSound: () => void;
  /** 限时挑战开关（每关 120 秒） */
  onToggleTimed: () => void;
  onReset: () => void;
}

export function LevelSelect({ chapter, save, progress, loadingId, loadProgress, loadError, onSelect, onRetry, onToggleSound, onToggleTimed, onReset }: Props) {
  return (
    <div className="stage stage--menu">
      <div className="menu">
        <p className="menu__eyebrow">一屋百年 · 第 {chapter.chapterNumber} 章</p>
        <h1 className="menu__title">{chapter.name}</h1>
        <p className="menu__desc">{chapter.description}</p>
        {loadError && (
          <div className="load-error" role="alert">
            <span>关卡加载失败，请检查网络后重试（{loadError.message}）</span>
            <button className="btn btn--primary load-error__retry" onClick={onRetry}>
              点重试
            </button>
          </div>
        )}
        <div className="chapter-progress chapter-progress--menu">
          <div className="chapter-progress__label">
            已收拾 {progress.completed}/{progress.total} 处 · ★ {progress.stars}/{progress.total * 3}
          </div>
          <div className="chapter-progress__bar">
            <span style={{ width: `${(progress.completed / progress.total) * 100}%` }} />
          </div>
        </div>
        <div className="level-grid">
          {chapter.levels.map((level) => {
            const locked = level.levelNumber > save.unlockedLevel;
            const loading = loadingId === level.id;
            return (
              <button
                key={level.id}
                className={locked ? "level-card level-card--locked" : "level-card"}
                disabled={locked || loadingId !== null}
                onClick={() => onSelect(level)}
              >
                <span className="level-card__num">{locked ? "🔒" : level.levelNumber}</span>
                <span className="level-card__name">
                  {loading ? `加载中… ${loadProgress}%` : level.name}
                </span>
                {(save.bestScores[level.id] ?? 0) > 0 && (
                  <span className="level-card__best">最高分 {save.bestScores[level.id]}</span>
                )}
                {loading && (
                  <span className="level-card__progress">
                    <span style={{ width: `${loadProgress}%` }} />
                  </span>
                )}
                <Stars count={save.stars[level.id] ?? 0} />
              </button>
            );
          })}
        </div>
        <div className="menu__footer">
          <button className="btn btn--ghost" onClick={onToggleTimed}>
            限时挑战：{save.settings.timedChallenge ? "开（每关 120 秒）" : "关"}
          </button>
          <button className="btn btn--ghost" onClick={onToggleSound}>
            音效与震动：{save.settings.soundEnabled ? "开" : "关"}
          </button>
          <button className="btn btn--ghost" onClick={onReset}>
            清空存档
          </button>
        </div>
      </div>
    </div>
  );
}
