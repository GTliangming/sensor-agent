import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { catalogApi, type GenerationConfig } from '@/api/catalog'
import { ReferenceAudioPicker, ReferenceImagePicker, type PickedImage } from '@/shared/components/ReferenceImagePicker'
import { ErrorState } from '@/shared/components/StateViews'
import { useWorkspace } from '@/features/workspace/hooks'
import { useCreateProduction } from '../hooks'
import { RUN_MODE_LABEL } from '../status'
import type { RunMode } from '../types'

/**
 * 创建：主题、时长、参考图、视频方向、seed、生成时间。
 * 所有选项和上限都来自当前账号类型在数据库里的生成配置（account.params），前端不写死。
 * 立即生成会跳到任务列表，夜间生成留在这里连续创建。
 */
export function CreateTab() {
  const { account } = useWorkspace()
  if (!account?.params?.resolutions?.length) {
    return <ErrorState message="这个账号类型还没有生成配置，请到「账号设置」里补全。" />
  }
  return <CreateForm key={account.id} accountId={account.id} wf={account.params} />
}

function CreateForm({ accountId, wf }: { accountId: string; wf: GenerationConfig }) {
  const navigate = useNavigate()
  const create = useCreateProduction()
  const [topic, setTopic] = useState('')
  const [duration, setDuration] = useState(wf.default_duration)
  const [images, setImages] = useState<PickedImage[]>([])
  const [resolution, setResolution] = useState(wf.default_resolution ?? wf.resolutions[0].label)
  const [seed, setSeed] = useState(wf.seed == null ? '' : String(wf.seed))
  const [runMode, setRunMode] = useState<RunMode>('now')
  const [created, setCreated] = useState<string>()

  const suggest = useMutation({
    mutationFn: () => catalogApi.suggestTopic(accountId),
    onSuccess: (r) => setTopic(r.topic),
  })

  // seed 选填：留空就用后端数据库里的默认值
  const seedValid = seed === '' || (/^\d+$/.test(seed) && Number.isSafeInteger(Number(seed)))
  const imagesOk = !wf.requires_image || images.length > 0

  function submit(e: FormEvent) {
    e.preventDefault()
    setCreated(undefined)
    create.mutate(
      {
        account_id: accountId, topic: topic.trim(), run_mode: runMode, duration_seconds: duration, resolution,
        seed: seed === '' ? undefined : Number(seed), reference_file_ids: images.map((i) => i.id),
      },
      {
        onSuccess: (p) => {
          if (runMode === 'now') return navigate('../tasks')
          // 夜间任务：留在这里方便连续创建，用一行提示告知已排队
          setCreated(p.id)
          setTopic('')
          setImages([])
        },
      },
    )
  }

  return (
    <div className="create-grid">
    <form className="panel form" onSubmit={submit} aria-labelledby="create-title">
      <h2 id="create-title">创建视频</h2>

      <div className="field">
        <label htmlFor="topic">主题</label>
        <div className="input-row">
          <input id="topic" className="input" value={topic} maxLength={1000} onChange={(e) => setTopic(e.target.value)}
            placeholder="留空则由 AI 自动选择主题" />
          <button type="button" className="btn" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
            {suggest.isPending ? '生成中' : 'AI 想一个'}
          </button>
        </div>
        {suggest.error && <p className="field-error" role="alert">{suggest.error.message}</p>}
      </div>

      <div className="field">
        <label htmlFor="duration">时长，最长 {wf.max_duration} 秒</label>
        <div className="input-row">
          <input id="duration" type="range" min={wf.min_duration} max={wf.max_duration} value={duration}
            onChange={(e) => setDuration(Number(e.target.value))} />
          <output className="num" htmlFor="duration">{duration} 秒</output>
        </div>
      </div>

      <fieldset className="field">
        <legend>视频方向</legend>
        <div className="choices">
          {wf.resolutions.map((r) => (
            <label key={r.label} className={r.label === resolution ? 'choice checked' : 'choice'}>
              <input type="radio" name="resolution" value={r.label} checked={r.label === resolution}
                onChange={() => setResolution(r.label)} />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <span className="label">
          参考图片，{wf.requires_image ? '至少 1 张' : '可选'}，最多 {wf.max_images} 张
        </span>
        <ReferenceImagePicker value={images} onChange={setImages} max={wf.max_images} />
        {!imagesOk && <p className="muted">这个工作流要求至少 1 张参考图。</p>}
      </div>

      <div className="field">
        <span className="label">参考音频，最多 {wf.max_audios} 个</span>
        <ReferenceAudioPicker max={wf.max_audios} />
      </div>

      <div className="field">
        <label htmlFor="seed">seed</label>
        <input id="seed" className="input input-short num" inputMode="numeric" value={seed}
          aria-invalid={!seedValid} onChange={(e) => setSeed(e.target.value.trim())} />
        <p className="muted">默认值来自数据库里这个账号类型的配置，可以在「账号设置」里修改；留空则使用默认值。</p>
        {!seedValid && <p className="field-error" role="alert">seed 需要是整数</p>}
      </div>

      <fieldset className="field">
        <legend>生成时间</legend>
        <div className="choices">
          {(['now', 'night'] as RunMode[]).map((m) => (
            <label key={m} className={m === runMode ? 'choice checked' : 'choice'}>
              <input type="radio" name="run-mode" value={m} checked={m === runMode} onChange={() => setRunMode(m)} />
              <span>{RUN_MODE_LABEL[m]}</span>
            </label>
          ))}
        </div>
        <p className="muted">夜间生成会排队，等夜间时段再提交，费用更低；同时最多运行 3 个。</p>
      </fieldset>

      {create.error && <p className="field-error" role="alert">{create.error.message}</p>}
      {created && (
        <p role="status" className="notice">已加入夜间队列。<Link to="../tasks">查看任务列表</Link></p>
      )}
      <div className="actions">
        <button className="btn btn-primary" disabled={!seedValid || !imagesOk || create.isPending}>
          {create.isPending ? '提交中' : '确认生成'}
        </button>
      </div>
    </form>
    <aside className="panel stack sheet" aria-label="本次生成">
      <h2>本次生成</h2>
      <p className="sheet-figure num">{duration}<span> 秒</span></p>
      <dl className="kv">
        <dt>视频方向</dt><dd>{resolution}</dd>
        <dt>生成时间</dt><dd>{RUN_MODE_LABEL[runMode]}</dd>
        <dt>参考图片</dt><dd className="num">{images.length} / {wf.max_images}</dd>
        <dt>seed</dt><dd className="num">{seed || '使用默认值'}</dd>
      </dl>
    </aside>
    </div>
  )
}
