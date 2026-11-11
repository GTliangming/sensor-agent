import type { SaveData } from "../core/save";
import type { ChapterConfig, LevelConfig } from "../core/types";
import { Stars } from "./ItemIcon";

interface Props {
  chapter: ChapterConfig;
  levels: LevelConfig[];
  save: SaveData;
  onSelect: (level: LevelConfig) => void;
  onReset: () => void;
}

export function LevelSelect({ chapter, levels, save, onSelect, onReset }: Props) {
  return (
    <div className="stage stage--menu">
      <div className="menu">
        <p className="menu__eyebrow">一屋百年 · 第 {chapter.chapterNumber} 章</p>
        <h1 className="menu__title">{chapter.name}</h1>
        <p className="menu__desc">{chapter.description}</p>
        <div className="level-grid">
          {levels.map((level) => {
            const locked = level.levelNumber > save.unlockedLevel;
            return (
              <button
                key={level.id}
                className={locked ? "level-card level-card--locked" : "level-card"}
                disabled={locked}
                onClick={() => onSelect(level)}
              >
                <span className="level-card__num">{locked ? "🔒" : level.levelNumber}</span>
                <span className="level-card__name">{level.name}</span>
                <Stars count={save.stars[level.id] ?? 0} />
              </button>
            );
          })}
        </div>
        <button className="btn btn--ghost menu__reset" onClick={onReset}>
          清空存档
        </button>
      </div>
    </div>
  );
}
