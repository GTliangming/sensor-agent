import { useEffect, useReducer, useRef, useState } from "react";
import { GameSession } from "../core/GameSession";
import type { LevelConfig } from "../core/types";
import { ITEM_MAP, SCENE_MAP } from "../data";
import { cqw, slotCenter, toCssPercent } from "../layout";
import { ThreeStage } from "../render/ThreeStage";
import { adService } from "../services/AdService";
import { feedback } from "../services/feedback";
import { Guide, type GuideStep } from "./Guide";
import { SessionPanel, type ChapterProgress } from "./Panels";
import { StorageSlots, TargetSlots } from "./Slots";
import { useStageLayout } from "./useStageLayout";

interface Props {
  level: LevelConfig;
  /** 是否显示新手引导（第 1 关首次游玩） */
  guide: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
  progress: ChapterProgress;
  onExit: () => void;
  onComplete: (stars: number) => void;
  onNext?: () => void;
}

export function GameScreen(props: Props) {
  const { level } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<ThreeStage | null>(null);
  const sessionRef = useRef(new GameSession(level));
  // 点击回调绑定在 Three 舞台上，通过 ref 始终拿到最新的 props 和处理函数，避免闭包里用到旧值
  const propsRef = useRef(props);
  propsRef.current = props;
  const layout = useStageLayout(rootRef);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [attempt, setAttempt] = useState(0);
  const [arriving, setArriving] = useState<Set<string>>(new Set());
  const [resultReady, setResultReady] = useState(false);
  const [adPlaying, setAdPlaying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [bumps, setBumps] = useState<number[]>([]);
  const [guideStep, setGuideStep] = useState<GuideStep>(props.guide ? "point" : "none");

  useEffect(() => {
    const stage = new ThreeStage(hostRef.current!);
    stageRef.current = stage;
    stage.onItemClick = (id) => handleClickRef.current(id);
    // 仅在 URL 带 ?e2e 时暴露给浏览器自动化测试
    if (new URLSearchParams(location.search).has("e2e")) {
      (window as unknown as { __e2e: unknown }).__e2e = {
        tapPoint: (id: string) => stage.findTapPoint(id),
        pickAt: (x: number, y: number) => stage.pickAtClient(x, y),
      };
    }
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    stageRef.current?.setLayout(layout);
  }, [layout]);

  useEffect(() => {
    const stage = stageRef.current!;
    const session = new GameSession(level);
    sessionRef.current = session;
    stage.loadLevel(level, SCENE_MAP.get(level.sceneId)!, ITEM_MAP);
    for (const inst of level.itemInstances) stage.setBlocked(inst.id, session.isBlocked(inst.id));
    stage.onTick = (dt) => {
      const before = session.hint?.instanceId ?? null;
      const autoHint = session.update(dt);
      const after = session.hint?.instanceId ?? null;
      stage.setHint(after);
      if (autoHint) feedback.play("hint");
      if (before !== after) refresh();
    };
    setArriving(new Set());
    setBumps([]);
    setResultReady(false);
    refresh();
    // 新手引导期间由引导文案代替开局提示条，避免两条提示叠在一起
    if (propsRef.current.guide && attempt === 0) return;
    setToast(`第 ${level.levelNumber} 关 · ${level.teaching}`);
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [level, attempt]);

  // 切到后台（来电、切 App）自动暂停
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && sessionRef.current.status === "playing") {
        sessionRef.current.pause();
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  function handleClick(id: string) {
    const session = sessionRef.current;
    const stage = stageRef.current;
    if (!stage) return;
    feedback.unlock();
    const r = session.click(id);
    if (r.type === "blocked") {
      stage.shake(id);
      feedback.play("blocked");
    }
    if (r.type === "collected") {
      const completedObjective = session.objectives[r.objectiveIndex].completed;
      feedback.play(r.levelCompleted ? "complete" : completedObjective ? "objective" : "collect");
      const target = slotCenter(layout.target, r.objectiveIndex, session.objectives.length);
      stage.flyTo(id, target, 0.75, () => {
        // 物件落进找寻格时格子弹一下，让“收集到了”的手感更明确
        setBumps((b) => {
          const next = [...b];
          next[r.objectiveIndex] = (next[r.objectiveIndex] ?? 0) + 1;
          return next;
        });
        if (r.levelCompleted) {
          propsRef.current.onComplete(session.stars());
          setResultReady(true);
        }
      });
      if (guideStep === "point") setGuideStep("storage");
      else if (guideStep === "storage") setGuideStep("none");
    }
    if (r.type === "missed") {
      feedback.play(r.storageFull ? "fail" : "miss");
      setArriving((s) => new Set(s).add(id));
      const target = slotCenter(layout.storage, r.slotIndex, session.collection.length);
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
  const handleClickRef = useRef(handleClick);
  handleClickRef.current = handleClick;

  const session = sessionRef.current;
  const restart = () => {
    feedback.play("tap");
    setAttempt((n) => n + 1);
  };
  const pause = () => {
    feedback.play("tap");
    session.pause();
    refresh();
  };
  const resume = () => {
    feedback.play("tap");
    session.resume();
    refresh();
  };
  const locateLast = (objectiveIndex: number) => {
    feedback.unlock();
    const id = session.locateLast(objectiveIndex);
    stageRef.current?.setHint(id);
    if (id) feedback.play("hint");
    refresh();
  };
  const showHint = () => {
    feedback.unlock();
    const id = session.requestHint();
    stageRef.current?.setHint(id);
    if (id) feedback.play("hint");
    else setToast(session.hintsLeft() > 0 ? "暂时没有可提示的物件" : "免费提示已用完");
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
  const guideTarget = guideStep === "point" && playing ? session.clickableTargets()[0] ?? null : null;
  const headerStyle = { top: toCssPercent(layout, 0, layout.height - layout.safeTop).top, height: cqw(150) };

  return (
    <div ref={rootRef} className="stage" onPointerDown={() => feedback.unlock()}>
      <div ref={hostRef} className="stage__canvas" />
      <header className="hud-header" style={headerStyle}>
        <button className="icon-btn" onClick={props.onExit} aria-label="返回选关">‹</button>
        <div className="hud-header__title">
          <span className="hud-header__chapter">第 {level.levelNumber} 关</span>
          {level.name}
        </div>
        <button className="icon-btn hint-btn" onClick={showHint} disabled={!playing} aria-label="提示">
          💡<span className="hint-btn__count">{session.hintsLeft()}</span>
        </button>
        <button className="icon-btn" onClick={pause} disabled={!playing} aria-label="暂停">Ⅱ</button>
      </header>
      <TargetSlots session={session} layout={layout} bumps={bumps} onLocateLast={locateLast} />
      <StorageSlots session={session} layout={layout} arriving={arriving} />
      {toast && <div className="toast">{toast}</div>}
      <Guide step={guideStep} targetId={guideTarget} stage={stageRef.current} root={rootRef.current} layout={layout} />
      <SessionPanel
        session={session}
        showResult={session.status === "paused" || session.status === "failed" || resultReady}
        adPlaying={adPlaying}
        soundEnabled={props.soundEnabled}
        progress={props.progress}
        actions={{
          onResume: resume,
          onRestart: restart,
          onExit: props.onExit,
          onRescue: rescue,
          onGiveUp: giveUp,
          onNext: props.onNext,
          onToggleSound: props.onToggleSound,
        }}
      />
    </div>
  );
}
