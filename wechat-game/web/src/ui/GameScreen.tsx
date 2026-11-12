import { useEffect, useReducer, useRef, useState } from "react";
import { GameSession } from "../core/GameSession";
import type { LevelSnapshot } from "../core/save";
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
  /** 限时挑战模式（每关 120 秒） */
  timed: boolean;
  /** 本关历史最高分 */
  bestScore: number;
  /** 本关的中断点快照（有则进关时问“继续还是重新开始”） */
  resumeSnapshot?: LevelSnapshot | null;
  onToggleSound: () => void;
  progress: ChapterProgress;
  onExit: () => void;
  onSaveProgress: (snap: LevelSnapshot) => void;
  onClearProgress: () => void;
  onComplete: (stars: number, score: number) => void;
  onNext?: () => void;
}

/** 飘分：找对时从物件位置飘出的“+分数” */
interface FloatScore {
  key: number;
  gain: number;
  combo: number;
  left: string;
  top: string;
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
  const [adError, setAdError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bumps, setBumps] = useState<number[]>([]);
  const [guideStep, setGuideStep] = useState<GuideStep>(props.guide ? "point" : "none");
  const [floats, setFloats] = useState<FloatScore[]>([]);
  const floatKey = useRef(0);
  /** 断点续玩决定：有快照时先问，null = 还没决定 */
  const [resumeDecision, setResumeDecision] = useState<"resume" | "fresh" | null>(
    props.resumeSnapshot ? null : "fresh",
  );
  /** 倒计时显示的秒数，变化时才刷新（每秒一次，不随每帧刷新） */
  const lastSecRef = useRef<number | null>(null);

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
    if (resumeDecision === null) return; // 断点续玩还没决定，先不进关
    const stage = stageRef.current!;
    const session = new GameSession(level, {
      timed: propsRef.current.timed,
      snapshot: resumeDecision === "resume" ? propsRef.current.resumeSnapshot ?? undefined : undefined,
    });
    sessionRef.current = session;
    stage.loadLevel(level, SCENE_MAP.get(level.sceneId)!, ITEM_MAP);
    for (const inst of level.itemInstances) {
      if (!session.inScene(inst.id)) stage.hideInstance(inst.id);
    }
    stage.onTick = (dt) => {
      const before = session.hint?.instanceId ?? null;
      const autoHint = session.update(dt);
      const after = session.hint?.instanceId ?? null;
      stage.setHint(after);
      if (autoHint) feedback.play("hint");
      if (before !== after) refresh();
      // 限时倒计时：显示的秒数变了才刷新，避免每帧都重渲染
      if (session.timeLeft !== null) {
        const sec = Math.ceil(session.timeLeft);
        if (sec !== lastSecRef.current) {
          lastSecRef.current = sec;
          refresh();
        }
        if (session.status === "failed") refresh();
      }
    };
    setArriving(new Set());
    setBumps([]);
    setResultReady(false);
    setFloats([]);
    refresh();
    // 新手引导期间由引导文案代替开局提示条，避免两条提示叠在一起
    if (propsRef.current.guide && attempt === 0) return;
    setToast(`第 ${level.levelNumber} 关 · ${level.teaching}`);
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [level, attempt, resumeDecision]);

  // 切到后台（来电、切 App）自动暂停，并保存中断点快照
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && sessionRef.current.status === "playing") {
        sessionRef.current.pause();
        saveSnapshotIfNeeded();
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  /** 切后台/退出/暂停时保存中断点；通关、失败、限时只剩 5 秒内不保存（恢复了也马上失败，不如重开） */
  const saveSnapshotIfNeeded = () => {
    const session = sessionRef.current;
    if (session.status !== "playing" && session.status !== "paused" && session.status !== "rescue") return;
    if (session.timeLeft !== null && session.timeLeft <= 5) {
      propsRef.current.onClearProgress();
      return;
    }
    propsRef.current.onSaveProgress(session.snapshot());
  };

  const exit = () => {
    saveSnapshotIfNeeded();
    propsRef.current.onExit();
  };

  function handleClick(id: string) {
    const session = sessionRef.current;
    const stage = stageRef.current;
    if (!stage) return;
    feedback.unlock();
    // 飘分位置：点中物件的屏幕坐标（飞走之前取）
    const tapPoint = stage.findTapPoint(id);
    const r = session.click(id);
    if (r.type === "blocked") {
      stage.shake(id);
      feedback.play("blocked");
    }
    if (r.type === "collected") {
      // 音效随连击变调（+6%/连击，上限 +30%）
      const pitch = 1 + Math.min(session.combo - 1, 5) * 0.06;
      feedback.play(r.levelCompleted ? "complete" : session.objectives[r.objectiveIndex].completed ? "objective" : "collect", pitch);
      const target = slotCenter(layout.target, r.objectiveIndex, session.objectives.length);
      stage.flyTo(id, target, 0.75, () => {
        // 物件落进找寻格时格子弹一下，让“收集到了”的手感更明确
        setBumps((b) => {
          const next = [...b];
          next[r.objectiveIndex] = (next[r.objectiveIndex] ?? 0) + 1;
          return next;
        });
        if (r.levelCompleted) {
          propsRef.current.onComplete(session.stars(), session.score);
          setResultReady(true);
        }
      });
      // 飘分：从物件位置向上飘出“+分数”
      if (tapPoint && rootRef.current) {
        const rect = rootRef.current.getBoundingClientRect();
        const key = ++floatKey.current;
        const left = `${((tapPoint.x - rect.left) / rect.width) * 100}%`;
        const top = `${((tapPoint.y - rect.top) / rect.height) * 100}%`;
        setFloats((f) => [...f, { key, gain: r.scoreGain, combo: r.combo, left, top }]);
        setTimeout(() => setFloats((f) => f.filter((x) => x.key !== key)), 900);
      }
      // 通关整洁 payoff：剩余物件淡出收起，露出整洁的房间底色
      if (r.levelCompleted) stage.celebrate(id);
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
      r.unlocked.forEach((u) => stage.pulseUnblocked(u));
      setToast(null);
    }
    refresh();
  }
  const handleClickRef = useRef(handleClick);
  handleClickRef.current = handleClick;

  const session = sessionRef.current;
  const restart = () => {
    feedback.play("tap");
    propsRef.current.onClearProgress();
    setResumeDecision("fresh");
    setAttempt((n) => n + 1);
  };
  const pause = () => {
    feedback.play("tap");
    session.pause();
    saveSnapshotIfNeeded();
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
    setAdError(null);
    setAdPlaying(true);
    const ok = await adService.showRewardedAd();
    setAdPlaying(false);
    if (ok) {
      session.rescue();
      setResultReady(false);
    } else {
      // 广告失败/超时：显示重试，不卡住、不扣救场次数
      setAdError("广告加载失败，请重试");
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
  const collected = session.objectives.reduce((n, o) => n + o.collectedCount, 0);
  const total = session.objectives.reduce((n, o) => n + o.requiredCount, 0);
  const tidyPct = total ? Math.round((collected / total) * 100) : 0;
  const timeLeftSec = session.timeLeft !== null ? Math.ceil(session.timeLeft) : null;

  return (
    <div ref={rootRef} className="stage" onPointerDown={() => feedback.unlock()}>
      <div ref={hostRef} className="stage__canvas" />
      <header className="hud-header" style={headerStyle}>
        <div className="hud-header__row">
          <button className="icon-btn" onClick={exit} aria-label="返回选关">‹</button>
          <div className="hud-header__title">
            <span className="hud-header__chapter">第 {level.levelNumber} 关</span>
            {level.name}
            <span className="hud-header__score">
              ⭐ {session.score}
              {session.combo >= 2 && <span className="hud-header__combo"> 🔥×{session.combo}</span>}
              {timeLeftSec !== null && (
                <span className={timeLeftSec <= 30 ? "hud-header__timer hud-header__timer--low" : "hud-header__timer"}>
                  ⏱ {timeLeftSec}s
                </span>
              )}
            </span>
          </div>
          <button className="icon-btn hint-btn" onClick={showHint} disabled={!playing} aria-label="提示">
            💡<span className="hint-btn__count">{session.hintsLeft()}</span>
          </button>
          <button className="icon-btn" onClick={pause} disabled={!playing} aria-label="暂停">Ⅱ</button>
        </div>
        <div className="hud-progress">
          <div className="hud-progress__bar">
            <span style={{ width: `${tidyPct}%` }} />
          </div>
          <span className="hud-progress__label">
            已找 {collected}/{total} · 整洁度 {tidyPct}%
          </span>
        </div>
      </header>
      <TargetSlots session={session} layout={layout} bumps={bumps} onLocateLast={locateLast} />
      <StorageSlots session={session} layout={layout} arriving={arriving} />
      {floats.map((f) => (
        <div key={f.key} className="float-score" style={{ left: f.left, top: f.top }}>
          +{f.gain}
          {f.combo >= 2 && <span className="float-score__combo"> ×{f.combo}连击</span>}
        </div>
      ))}
      {toast && <div className="toast">{toast}</div>}
      <Guide step={guideStep} targetId={guideTarget} stage={stageRef.current} root={rootRef.current} layout={layout} />
      {resumeDecision === null && props.resumeSnapshot && (
        <div className="overlay">
          <div className="panel">
            <h2 className="panel__title">上次玩到一半</h2>
            <p className="panel__text">
              第 {level.levelNumber} 关已找{" "}
              {level.itemInstances.filter(
                (i) =>
                  props.resumeSnapshot!.removed.includes(i.id) &&
                  level.objectives.some((o) => o.itemId === i.itemId),
              ).length}{" "}
              件 · 分数 {props.resumeSnapshot.score}
              {props.resumeSnapshot.timeLeft !== undefined
                ? ` · 限时剩 ${Math.ceil(props.resumeSnapshot.timeLeft)} 秒`
                : ""}
              ，要继续吗？
            </p>
            <button className="btn btn--primary" onClick={() => setResumeDecision("resume")}>继续玩</button>
            <button className="btn" onClick={() => { propsRef.current.onClearProgress(); setResumeDecision("fresh"); }}>重新开始</button>
            <button className="btn btn--ghost" onClick={exit}>返回选关</button>
          </div>
        </div>
      )}
      <SessionPanel
        session={session}
        showResult={session.status === "paused" || session.status === "failed" || resultReady}
        adPlaying={adPlaying}
        adError={adError}
        soundEnabled={props.soundEnabled}
        progress={props.progress}
        bestScore={props.bestScore}
        actions={{
          onResume: resume,
          onRestart: restart,
          onExit: exit,
          onRescue: rescue,
          onGiveUp: giveUp,
          onNext: props.onNext,
          onToggleSound: props.onToggleSound,
        }}
      />
    </div>
  );
}
