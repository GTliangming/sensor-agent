import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { GameSession } from "../core/GameSession";
import { solveLevel } from "../core/solver";
import type { LevelConfig } from "../core/types";
import { ITEM_MAP, SCENE_MAP } from "../data";
import { storageSlotCenter, targetSlotCenter } from "../layout";
import { ThreeStage } from "../render/ThreeStage";
import { adService } from "../services/AdService";
import { SessionPanel } from "./Panels";
import { StorageSlots, TargetSlots } from "./Slots";

interface Props {
  level: LevelConfig;
  onExit: () => void;
  onComplete: (stars: number) => void;
  onNext?: () => void;
}

export function GameScreen({ level, onExit, onComplete, onNext }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<ThreeStage | null>(null);
  const sessionRef = useRef(new GameSession(level));
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [attempt, setAttempt] = useState(0);
  const [arriving, setArriving] = useState<Set<string>>(new Set());
  const [resultReady, setResultReady] = useState(false);
  const [adPlaying, setAdPlaying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // 本关不看广告通关至少要放错的次数，星级按超出部分计算
  const requiredWrong = useMemo(() => solveLevel(level).minWrong, [level]);

  useEffect(() => {
    const stage = new ThreeStage(hostRef.current!);
    stageRef.current = stage;
    // 仅在 URL 带 ?e2e 时暴露给浏览器自动化测试
    if (new URLSearchParams(location.search).has("e2e")) {
      (window as unknown as { __e2e: unknown }).__e2e = { tapPoint: (id: string) => stage.findTapPoint(id) };
    }
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current!;
    const session = new GameSession(level);
    sessionRef.current = session;
    stage.loadLevel(level, SCENE_MAP.get(level.sceneId)!, ITEM_MAP);
    for (const inst of level.itemInstances) stage.setBlocked(inst.id, session.isBlocked(inst.id));
    stage.onItemClick = handleClick;
    stage.onTick = (dt) => {
      const before = session.hint?.instanceId ?? null;
      session.update(dt);
      const after = session.hint?.instanceId ?? null;
      stage.setHint(after);
      if (before !== after) refresh();
    };
    setArriving(new Set());
    setResultReady(false);
    setToast(`第 ${level.levelNumber} 关 · ${level.teaching}`);
    const timer = setTimeout(() => setToast(null), 2200);
    refresh();
    return () => clearTimeout(timer);
  }, [level, attempt]);

  function handleClick(id: string) {
    const session = sessionRef.current;
    const stage = stageRef.current;
    if (!stage) return;
    const r = session.click(id);
    if (r.type === "blocked") stage.shake(id);
    if (r.type === "collected") {
      const target = targetSlotCenter(r.objectiveIndex, session.objectives.length);
      stage.flyTo(id, target, 0.75, () => {
        if (r.levelCompleted) {
          onComplete(session.stars(requiredWrong));
          setResultReady(true);
        }
      });
    }
    if (r.type === "missed") {
      setArriving((s) => new Set(s).add(id));
      const target = storageSlotCenter(r.slotIndex, session.collection.length);
      stage.flyTo(id, target, 0.8, () => {
        setArriving((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
        if (r.storageFull) setResultReady(true);
      });
    }
    if (r.type === "collected" || r.type === "missed") {
      r.unlocked.forEach((u) => stage.setBlocked(u, false, true));
      setToast(null);
    }
    refresh();
  }
  const session = sessionRef.current;

  const restart = () => setAttempt((n) => n + 1);
  const pause = () => {
    session.pause();
    refresh();
  };
  const resume = () => {
    session.resume();
    refresh();
  };
  const showHint = () => {
    const id = session.requestHint();
    stageRef.current?.setHint(id);
    if (!id) setToast(session.hintsLeft() > 0 ? "暂时没有可提示的物件" : "免费提示已用完");
    refresh();
  };
  const rescue = async () => {
    setAdPlaying(true);
    const ok = await adService.showRewardedAd();
    setAdPlaying(false);
    if (ok) {
      session.rescue();
      setResultReady(false);
    }
    refresh();
  };
  const giveUp = () => {
    session.giveUp();
    refresh();
  };

  const playing = session.status === "playing";

  return (
    <div className="stage">
      <div ref={hostRef} className="stage__canvas" />
      <header className="hud-header">
        <button className="icon-btn" onClick={onExit} aria-label="返回选关">‹</button>
        <div className="hud-header__title">
          <span className="hud-header__chapter">第 {level.levelNumber} 关</span>
          {level.name}
        </div>
        <button className="icon-btn hint-btn" onClick={showHint} disabled={!playing} aria-label="提示">
          💡<span className="hint-btn__count">{session.hintsLeft()}</span>
        </button>
        <button className="icon-btn" onClick={pause} disabled={!playing} aria-label="暂停">Ⅱ</button>
      </header>
      <TargetSlots session={session} />
      <div className="storage-label">归位格 {session.collection.filter(Boolean).length}/{session.collection.length}</div>
      <StorageSlots session={session} arriving={arriving} />
      {toast && <div className="toast">{toast}</div>}
      <SessionPanel
        session={session}
        requiredWrong={requiredWrong}
        showResult={session.status === "paused" || session.status === "failed" || resultReady}
        adPlaying={adPlaying}
        actions={{ onResume: resume, onRestart: restart, onExit, onRescue: rescue, onGiveUp: giveUp, onNext }}
      />
    </div>
  );
}
