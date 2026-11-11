import { useState } from "react";
import { defaultSave, loadSave, recordCompletion, writeSave, type SaveData } from "./core/save";
import { CHAPTER, LEVELS } from "./data";
import { GameScreen } from "./ui/GameScreen";
import { LevelSelect } from "./ui/LevelSelect";

export function App() {
  const [save, setSave] = useState<SaveData>(() => loadSave(window.localStorage));
  const [levelIndex, setLevelIndex] = useState<number | null>(null);

  const updateSave = (fn: (s: SaveData) => SaveData) =>
    setSave((prev) => {
      const next = fn(prev);
      writeSave(window.localStorage, next);
      return next;
    });

  if (levelIndex === null) {
    return (
      <LevelSelect
        chapter={CHAPTER}
        levels={LEVELS}
        save={save}
        onSelect={(level) => setLevelIndex(LEVELS.indexOf(level))}
        onReset={() => updateSave(() => defaultSave())}
      />
    );
  }

  const level = LEVELS[levelIndex];
  const hasNext = levelIndex + 1 < LEVELS.length;
  return (
    <GameScreen
      key={level.id}
      level={level}
      onExit={() => setLevelIndex(null)}
      onComplete={(stars) => updateSave((s) => recordCompletion(s, level.id, level.levelNumber, stars))}
      onNext={hasNext ? () => setLevelIndex(levelIndex + 1) : undefined}
    />
  );
}
