import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { GenerationConfig } from '@/api/catalog'
import { useBusinessLines } from '@/features/workspace/hooks'
import { ReferenceAudioPicker, ReferenceImagePicker, type PickedImage } from '@/shared/components/ReferenceImagePicker'
import { ErrorState, LoadingRows } from '@/shared/components/StateViews'
import { useCreateVideo } from '../hooks'
import { taskPath } from '../paths'
import { RUN_MODE_LABEL, type RunMode } from '../status'

/**
 * 手动生成：直接填提示词，不经过大模型和审核，用于调试工作流。
 * 视频方向、时长上限、seed 等都取自所选账号类型在数据库里的生成配置。
 */
export function VideoForm() {
  const { data: lines, isLoading, error, refetch } = useBusinessLines()
  const [accountId, setAccountId] = useState('')
  if (isLoading) return <LoadingRows rows={5} />
  const all = lines?.flatMap((l) => l.account_types.map((a) => ({ ...a, lineName: l.name }))) ?? []
  if (error || all.length === 0) return <ErrorState message={error?.message ?? '还没有账号类型'} onRetry={() => refetch()} />
  const account = all.find((a) => a.id === accountId) ?? all[0]

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="manual-account">使用哪个账号类型的生成配置</label>
        <select id="manual-account" className="input" value={account.id} onChange={(e) => setAccountId(e.target.value)}>
          {all.map((a) => <option key={a.id} value={a.id}>{a.lineName}，{a.name}</option>)}
        </select>
      </div>
      <ManualForm key={account.id} accountId={account.id} wf={account.params} />
    </div>
  )
}

function ManualForm({ accountId, wf }: { accountId: string; wf: GenerationConfig }) {
  const navigate = useNavigate()
  const create = useCreateVideo()
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [images, setImages] = useState<PickedImage[]>([])
  const [duration, setDuration] = useState(wf.default_duration)
  const [resolution, setResolution] = useState(wf.default_resolution ?? wf.resolutions[0].label)
  const [seed, setSeed] = useState(wf.seed == null ? '' : String(wf.seed))
  const [runMode, setRunMode] = useState<RunMode>('now')

  // 同一次提交意图复用同一个幂等键；成功后才换新的，失败重试时不会重复生成
  const idemKey = useRef(crypto.randomUUID())

  const seedValid = seed === '' || (/^\d+$/.test(seed) && Number.isSafeInteger(Number(seed)))
  const imagesOk = !wf.requires_image || images.length > 0
  const canSubmit = prompt.trim().length > 0 && seedValid && imagesOk && !create.isPending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    create.mutate(
      {
        key: idemKey.current,
        payload: {
          account_id: accountId, prompt: prompt.trim(), negative_prompt: negative.trim() || undefined,
          image_ids: images.map((i) => i.id), resolution, duration_seconds: duration,
          seed: seed === '' ? undefined : Number(seed), run_mode: runMode,
        },
      },
      {
        onSuccess: (task) => {
          idemKey.current = crypto.randomUUID()
          navigate(taskPath(task.task_id))
        },
      },
    )
  }

  return (
    <form className="panel form" onSubmit={handleSubmit} aria-labelledby="manual-title">
      <h2 id="manual-title">手动生成</h2>
      <p className="muted">直接使用你填写的提示词，不经过大模型和审核。</p>

      <div className="field">
        <label htmlFor="prompt">提示词</label>
        <textarea id="prompt" className="input" rows={4} maxLength={20000} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="negative">负向提示词</label>
        <textarea id="negative" className="input" rows={2} maxLength={2000} value={negative} onChange={(e) => setNegative(e.target.value)} />
        {!wf.fields.negative_prompt && <p className="muted">这个账号类型的工作流没有负向提示词参数，会按「负向写法」模板拼进提示词一起发送。</p>}
      </div>

      <div className="field">
        <span className="label">参考图片，{wf.requires_image ? '至少 1 张' : '可选'}，最多 {wf.max_images} 张</span>
        <ReferenceImagePicker value={images} onChange={setImages} max={wf.max_images} />
      </div>
      <div className="field">
        <span className="label">参考音频，最多 {wf.max_audios} 个</span>
        <ReferenceAudioPicker max={wf.max_audios} />
      </div>

      <fieldset className="field">
        <legend>视频方向</legend>
        <div className="choices">
          {wf.resolutions.map((r) => (
            <label key={r.label} className={r.label === resolution ? 'choice checked' : 'choice'}>
              <input type="radio" name="resolution" checked={r.label === resolution} onChange={() => setResolution(r.label)} />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="duration">时长，最长 {wf.max_duration} 秒</label>
        <div className="input-row">
          <input id="duration" type="range" min={wf.min_duration} max={wf.max_duration} value={duration}
            onChange={(e) => setDuration(Number(e.target.value))} />
          <output className="num" htmlFor="duration">{duration} 秒</output>
        </div>
      </div>

      <div className="field">
        <label htmlFor="seed">seed</label>
        <input id="seed" className="input input-short num" inputMode="numeric" value={seed} aria-invalid={!seedValid}
          onChange={(e) => setSeed(e.target.value.trim())} />
      </div>

      <fieldset className="field">
        <legend>生成时间</legend>
        <div className="choices">
          {(['now', 'night'] as RunMode[]).map((m) => (
            <label key={m} className={m === runMode ? 'choice checked' : 'choice'}>
              <input type="radio" name="run-mode" checked={m === runMode} onChange={() => setRunMode(m)} />
              <span>{RUN_MODE_LABEL[m]}</span>
            </label>
          ))}
        </div>
        <p className="muted">夜间生成会在后台排队，等夜间时段再提交；同时最多运行 3 个，结果自动刷新。</p>
      </fieldset>

      {create.error && <p className="field-error" role="alert">{create.error.message}</p>}
      <div className="actions">
        <button className="btn btn-primary" disabled={!canSubmit}>{create.isPending ? '提交中' : '确认生成'}</button>
      </div>
    </form>
  )
}
