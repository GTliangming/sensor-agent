import { useEffect, useState } from "react";
import { clearProgress, defaultSave, loadSave, recordCompletion, saveProgress, writeSave, type SaveData } from "./core/save";
import type { LevelConfig } from "./core/types";
import { CHAPTER, loadLevel } from "./data";
import { preloadSprites } from "./render/sprites";
import { feedback } from "./services/feedback";
import { GameScreen } from "./ui/GameScreen";
import { LevelSelect } from "./ui/LevelSelect";
import type { ChapterProgress } from "./ui/Panels";

function chapterProgress(save: SaveData): ChapterProgress {
  const ids = CHAPTER.levelIds;
  return {
    completed: ids.filter((id) => save.completedLevels.includes(id)).length,
    total: ids.length,
    stars: ids.reduce((sum, id) => sum + (save.stars[id] ?? 0), 0),
  };
}

export function App() {
  const [save, setSave] = useState<SaveData>(() => loadSave(window.localStorage));
  const [level, setLevel] = useState<LevelConfig | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState(0);
  /** 加载失败的关卡：弱网下分包下载失败时显示重试，而不是点了没反应 */
  const [loadError, setLoadError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    feedback.enabled = save.settings.soundEnabled;
  }, [save.settings.soundEnabled]);

  const updateSave = (fn: (s: SaveData) => SaveData) =>
    setSave((prev) => {
      const next = fn(prev);
      writeSave(window.localStorage, next);
      return next;
    });

  const toggleSound = () =>
    updateSave((s) => ({ ...s, settings: { ...s.settings, soundEnabled: !s.settings.soundEnabled } }));

  /** 按需加载关卡数据和这一关用到的贴图，都准备好后再进关，避免进关时图标一个个冒出来 */
  const open = async (id: string) => {
    setLoadingId(id);
    setLoadProgress(0);
    setLoadError(null);
    try {
      const config = await loadLevel(id);
      await preloadSprites(
        config.itemInstances.map((i) => [i.itemId, i.variantId]),
        (done, total) => setLoadProgress(total ? Math.round((done / total) * 100) : 100),
      );
      setLevel(config);
    } catch (e) {
      setLoadError({ id, message: e instanceof Error ? e.message : "加载失败" });
    } finally {
      setLoadingId(null);
    }
  };

  if (!level) {
    return (
      <LevelSelect
        chapter={CHAPTER}
        save={save}
        progress={chapterProgress(save)}
        loadingId={loadingId}
        loadProgress={loadProgress}
        loadError={loadError}
        onSelect={(summary) => void open(summary.id)}
        onRetry={() => loadError && void open(loadError.id)}
        onToggleSound={toggleSound}
        onToggleTimed={() =>
          updateSave((s) => ({ ...s, settings: { ...s.settings, timedChallenge: !s.settings.timedChallenge } }))
        }
        onReset={() => updateSave(() => defaultSave())}
      />
    );
  }

  const index = CHAPTER.levelIds.indexOf(level.id);
  const nextId = CHAPTER.levelIds[index + 1];
  return (
    <GameScreen
      key={level.id}
      level={level}
      guide={level.levelNumber === 1 && !save.completedLevels.includes(level.id)}
      soundEnabled={save.settings.soundEnabled}
      timed={save.settings.timedChallenge}
      bestScore={save.bestScores[level.id] ?? 0}
      completed={save.completedLevels.includes(level.id)}
      resumeSnapshot={save.inProgress?.levelId === level.id ? save.inProgress : null}
      progress={chapterProgress(save)}
      onToggleSound={toggleSound}
      onExit={() => setLevel(null)}
      onSaveProgress={(snap) => updateSave((s) => saveProgress(s, snap))}
      onClearProgress={() => updateSave((s) => clearProgress(s))}
      onComplete={(stars, score) => updateSave((s) => recordCompletion(s, level.id, level.levelNumber, stars, score))}
      onNext={nextId ? () => void open(nextId) : undefined}
    />
  );
}
