import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AgentRun, TaskView } from "./api";
import { TERMINAL, cancelTask, createTask, getTask, listRuns, ready, videoUrl } from "./api";

// 后端阶段的推进顺序（用于判断每一步"已完成/进行中/待命"）
const ORDER = [
  "validate_request", "storyboarding", "validate_storyboard", "asset_search",
  "image_generation", "animating", "tts", "subtitles", "rendering", "validating", "done",
];
// 展示用的"烧制计划"行
const STEPS: { key: string; label: string }[] = [
  { key: "storyboarding", label: "分镜生成" },
  { key: "asset_search", label: "素材检索" },
  { key: "image_generation", label: "AI 补图" },
  { key: "animating", label: "图生视频" },
  { key: "tts", label: "配音合成" },
  { key: "subtitles", label: "字幕时间轴" },
  { key: "rendering", label: "FFmpeg 合成" },
  { key: "validating", label: "产物校验" },
];
const STATUS_CN: Record<string, string> = {
  queued: "排队中", running: "烧制中", succeeded: "已出片", failed: "失败",
  cancelled: "已取消", storyboard_ready: "分镜就绪",
};

function uid() {
  return (crypto.randomUUID?.() ?? `r${Date.now()}${Math.floor(Math.random() * 1e6)}`);
}

export function App() {
  const [topic, setTopic] = useState("雨后的城市夜景");
  const [style, setStyle] = useState("现代、温柔清冷");
  const [seconds, setSeconds] = useState(12);
  const [scenes, setScenes] = useState(5);
  const [task, setTask] = useState<TaskView | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prov, setProv] = useState<string>("");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    ready().then((r) => r && setProv([r.text_provider, r.checks?.ffmpeg ? "ffmpeg" : "no-ffmpeg"].filter(Boolean).join(" · ")));
  }, []);

  const poll = useCallback((id: string) => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      try {
        const t = await getTask(id);
        setTask(t);
        if (TERMINAL.has(t.status)) {
          if (timer.current) window.clearInterval(timer.current);
          setBusy(false);
          listRuns(id).then((r) => setRuns(r.runs)).catch(() => {});
        }
      } catch (e) {
        /* 瞬时错误忽略，下一轮重试 */
      }
    }, 1500);
  }, []);

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null); setRuns([]); setBusy(true); setTask(null);
    try {
      const { task_id } = await createTask({
        request_id: uid(), topic, style, target_seconds: seconds, max_scenes: scenes,
        max_generated_images: scenes,
      });
      const t = await getTask(task_id);
      setTask(t);
      poll(task_id);
    } catch (e: any) {
      setErr(String(e?.message ?? e)); setBusy(false);
    }
  }

  async function onCancel() {
    if (task) { try { await cancelTask(task.task_id); } catch {} }
  }

  const stage = task?.stage ?? null;
  const pos = stage ? ORDER.indexOf(stage) : -1;
  const done = task && (task.status === "succeeded" || task.status === "storyboard_ready");
  const rampOn = done ? 6 : Math.max(0, Math.min(6, Math.round(((pos + 1) / ORDER.length) * 6)));
  const render = task?.result?.render_plan ?? null;
  const sb = task?.result?.storyboard ?? null;
  const showVideo = !!render?.output_path && task?.status === "succeeded";
  const totalMs = runs.reduce((a, r) => a + (r.latency_ms ?? 0), 0);

  function rowState(key: string): "done" | "active" | "pending" {
    if (done) return "done";
    const i = ORDER.indexOf(key);
    if (pos < 0) return "pending";
    if (i < pos) return "done";
    if (i === pos && task && !TERMINAL.has(task.status)) return "active";
    return i <= pos ? "done" : "pending";
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="container topbar__in">
          <span className="wordmark">漫剪 · <b>Kiln</b> 控制台</span>
          {prov && <span className="ready"><span className="k">provider</span> {prov}</span>}
        </div>
      </header>

      <main className="container hero">
        <h1 className="hero__head">给一个主题，取出一支短片。</h1>
        <p className="lead hero__lead">
          输入主题，炉膛依次完成分镜、素材、补图、配音、图生视频与合成，产出竖屏成片。
        </p>

        <div className="grid">
          <form className="panel" onSubmit={onSubmit}>
            <label className="field">
              <span>主题</span>
              <textarea className="textarea" value={topic} maxLength={300}
                onChange={(e) => setTopic(e.target.value)} required />
            </label>
            <label className="field">
              <span>风格</span>
              <input className="input" value={style} maxLength={100}
                onChange={(e) => setStyle(e.target.value)} />
            </label>
            <div className="row">
              <label className="field">
                <span>目标时长（秒）</span>
                <input className="input" type="number" min={5} max={60} value={seconds}
                  onChange={(e) => setSeconds(+e.target.value)} />
              </label>
              <label className="field">
                <span>最大镜头数</span>
                <input className="input" type="number" min={1} max={20} value={scenes}
                  onChange={(e) => setScenes(+e.target.value)} />
              </label>
            </div>
            <div className="actions">
              <button className="btn btn--primary" type="submit" disabled={busy || !topic.trim()}>
                {busy ? "烧制中…" : "开始生成"}
              </button>
              {busy && task && (
                <button className="btn btn--ghost" type="button" onClick={onCancel}>取消</button>
              )}
            </div>
            {err && <p className="err">{err}</p>}
          </form>

          <section aria-live="polite">
            {!task && <p className="idle">炉膛待命。填好主题后点「开始生成」。</p>}
            {task && (
              <>
                <div className="stage-head">
                  <span className="statusword" data-s={task.status}>
                    {STATUS_CN[task.status] ?? task.status}
                  </span>
                  <span className="ready"><span className="k">task</span> {task.task_id.slice(0, 12)}</span>
                </div>
                <div className="ramp" aria-hidden="true">
                  {[1, 2, 3, 4, 5, 6].map((i) => <i key={i} data-on={i <= rampOn ? 1 : 0} />)}
                </div>

                {showVideo ? (
                  <figure className="photo">
                    <video src={videoUrl(task.task_id)} controls playsInline />
                  </figure>
                ) : (
                  <ul className="schedule">
                    {STEPS.map((s) => {
                      const st = rowState(s.key);
                      const frac = st === "done" ? 1 : st === "active" ? 0.6 : 0;
                      return (
                        <li key={s.key} data-state={st}>
                          <span className="stage-name">{s.label}</span>
                          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                            <span className="bar"><span style={{ transform: `scaleX(${frac})` }} /></span>
                            <span className="state">
                              {st === "done" ? "已完成" : st === "active" ? "进行中" : "待命"}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {(render || sb) && (
                  <div className="figures">
                    {sb?.scenes && <span className="figure">{sb.scenes.length}<small>镜头</small></span>}
                    {render?.duration_seconds != null &&
                      <span className="figure">{Number(render.duration_seconds).toFixed(1)}<small>成片秒数</small></span>}
                    {totalMs > 0 &&
                      <span className="figure">{(totalMs / 1000).toFixed(1)}<small>生成耗时 s</small></span>}
                  </div>
                )}

                {runs.length > 0 && (
                  <ul className="runs">
                    {runs.map((r, i) => (
                      <li key={i}>
                        <span>{r.agent_name}{r.model_name ? ` · ${r.model_name}` : ""}</span>
                        <span>{r.latency_ms != null ? `${(r.latency_ms / 1000).toFixed(1)}s` : ""}
                          {r.usage ? ` · ${Object.entries(r.usage).map(([k, v]) => `${k}=${v}`).join(" ")}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {task.error_message && <p className="err">{task.error_code}: {task.error_message}</p>}
              </>
            )}
          </section>
        </div>
      </main>

      <footer className="footer">
        <div className="container">
          <div className="mast">漫剪 Agent</div>
          <p>内部视频生成控制台 · 文本 DeepSeek · 图像/配音/图生视频 SiliconFlow · 合成 FFmpeg</p>
        </div>
      </footer>
    </div>
  );
}
