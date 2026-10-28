import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { GenerationConfig } from '@/api/catalog'
import { ReferenceAudioPicker, ReferenceImagePicker, type PickedImage } from '@/shared/components/ReferenceImagePicker'
import { ErrorState } from '@/shared/components/StateViews'
import { useWorkspace } from '@/features/workspace/hooks'
import { useCreateManualProduction, useManualDraft } from '../hooks'
import { RUN_MODE_LABEL } from '../status'
import type { RunMode } from '../types'

/**
 * 手动创建：主题、提示词、时长、视频方向、seed 全部自己填，不经过大模型和分镜/台词审核。
 * 提示词用账号类型当前的模板预填（提示词前缀 + 角色设定），在此基础上修改；生成后仍走成片审核。
 */
export function ManualCreateTab() {
  const { account } = useWorkspace()
  if (!account?.params?.resolutions?.length) {
    return <ErrorState message="这个账号类型还没有生成配置，请到「账号设置」里补全。" />
  }
  return <ManualForm key={account.id} accountId={account.id} wf={account.params} />
}

/** 插入模板时留给用户替换的占位词；提交前必须全部改掉。 */
const PLACEHOLDERS: Record<string, string> = {
  scene_desc: '【场景】', action_desc: '【动作】', camera_desc: '【运镜】', tts_text: '【台词】',
}

/** 把模板里的变量换成当前值或占位词；与后端 render 一样用 {{变量}}。 */
function fill(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => values[name] ?? PLACEHOLDERS[name] ?? '')
}

function ManualForm({ accountId, wf }: { accountId: string; wf: GenerationConfig }) {
  const navigate = useNavigate()
  const create = useCreateManualProduction()
  const [topic, setTopic] = useState('')
  const [duration, setDuration] = useState(wf.default_duration)
  const [resolution, setResolution] = useState(wf.default_resolution ?? wf.resolutions[0].label)
  const [images, setImages] = useState<PickedImage[]>([])
  const [seed, setSeed] = useState(wf.seed == null ? '' : String(wf.seed))
  const [runMode, setRunMode] = useState<RunMode>('now')

  // 没改过就跟随模板预填内容（换视频方向会重新预填）；改过之后以用户填写的为准
  const draft = useManualDraft(accountId, resolution)
  const [promptEdited, setPromptEdited] = useState<string | null>(null)
  const [negativeEdited, setNegativeEdited] = useState<string | null>(null)
  const prompt = promptEdited ?? draft.data?.prompt ?? ''
  const negative = negativeEdited ?? draft.data?.negative_prompt ?? ''

  const seedValid = /^\d+$/.test(seed) && Number.isSafeInteger(Number(seed))
  const imagesOk = !wf.requires_image || images.length > 0
  const leftover = Object.values(PLACEHOLDERS).filter((ph) => prompt.includes(ph))
  const canSubmit = topic.trim() !== '' && prompt.trim() !== '' && leftover.length === 0 && seedValid && imagesOk
    && !draft.isLoading && !create.isPending

  // 在提示词末尾追加模板：镜头按已有镜头数编号，时间段按 3 个镜头平均分配，之后可自行修改
  const shotCount = (prompt.match(/Shot \d+/g) ?? []).length
  function insertShot() {
    const n = shotCount + 1
    const step = duration / 3
    const text = fill(draft.data?.shot_template ?? '', {
      shot_index: String(n), start: String(Math.min(duration, Math.round((n - 1) * step))),
      end: String(Math.min(duration, Math.round(n * step))), duration_seconds: String(duration),
    })
    setPromptEdited(`${prompt.trimEnd()} ${text}`.trimStart())
  }
  function insertDialogue() {
    const text = fill(draft.data?.dialogue_template ?? '', { duration_seconds: String(duration) })
    setPromptEdited(`${prompt.trimEnd()} ${text}`.trimStart())
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate(
      {
        account_id: accountId, topic: topic.trim(), prompt: prompt.trim(), negative_prompt: negative.trim(),
        run_mode: runMode, duration_seconds: duration, resolution, seed: Number(seed),
        reference_file_ids: images.map((i) => i.id),
      },
      { onSuccess: () => navigate('../tasks') },
    )
  }

  return (
    <form className="panel form" onSubmit={submit} aria-labelledby="manual-create-title">
      <h2 id="manual-create-title">手动创建视频</h2>
      <p className="muted">所有内容都由你填写，不经过大模型和分镜、台词审核，生成后进入成片审核。</p>

      <div className="field">
        <label htmlFor="m-topic">主题</label>
        <input id="m-topic" className="input" value={topic} maxLength={1000} onChange={(e) => setTopic(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="m-prompt">提示词</label>
        <textarea id="m-prompt" className="input" rows={8} maxLength={20000} value={prompt}
          onChange={(e) => setPromptEdited(e.target.value)} />
        <p className="muted">
          已按「提示词模板」预填了提示词前缀和角色设定。用下面的按钮把「镜头写法」「台词写法」模板插到末尾，再替换其中【】里的内容。
          {promptEdited !== null && (
            <> <button type="button" className="btn-link" onClick={() => setPromptEdited(null)}>恢复为模板内容</button></>
          )}
        </p>
        <div className="actions">
          <button type="button" className="btn" disabled={!draft.data?.shot_template} onClick={insertShot}>
            插入镜头模板（第 {shotCount + 1} 个）
          </button>
          <button type="button" className="btn" disabled={!draft.data?.dialogue_template} onClick={insertDialogue}>
            插入台词模板
          </button>
        </div>
        {leftover.length > 0 && <p className="field-error" role="alert">提示词里还有没替换的 {leftover.join('、')}</p>}
        {draft.error && <p className="field-error" role="alert">{draft.error.message}</p>}
      </div>

      <div className="field">
        <label htmlFor="m-negative">负向提示词</label>
        <textarea id="m-negative" className="input" rows={3} maxLength={2000} value={negative}
          onChange={(e) => setNegativeEdited(e.target.value)} />
        {!wf.fields.negative_prompt && <p className="muted">这个账号类型的工作流没有负向提示词参数，会按「负向写法」模板拼进提示词一起发送。</p>}
      </div>

      <fieldset className="field">
        <legend>视频方向</legend>
        <div className="choices">
          {wf.resolutions.map((r) => (
            <label key={r.label} className={r.label === resolution ? 'choice checked' : 'choice'}>
              <input type="radio" name="m-resolution" checked={r.label === resolution} onChange={() => setResolution(r.label)} />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="m-duration">时长，最长 {wf.max_duration} 秒</label>
        <div className="input-row">
          <input id="m-duration" type="range" min={wf.min_duration} max={wf.max_duration} value={duration}
            onChange={(e) => setDuration(Number(e.target.value))} />
          <output className="num" htmlFor="m-duration">{duration} 秒</output>
        </div>
      </div>

      <div className="field">
        <label htmlFor="m-seed">seed</label>
        <input id="m-seed" className="input input-short num" inputMode="numeric" value={seed} aria-invalid={!seedValid}
          onChange={(e) => setSeed(e.target.value.trim())} />
        {!seedValid && <p className="field-error" role="alert">seed 需要是整数</p>}
      </div>

      <div className="field">
        <span className="label">参考图片，{wf.requires_image ? '至少 1 张' : '可选'}，最多 {wf.max_images} 张</span>
        <ReferenceImagePicker value={images} onChange={setImages} max={wf.max_images} />
        {!imagesOk && <p className="muted">这个工作流要求至少 1 张参考图。</p>}
      </div>

      <div className="field">
        <span className="label">参考音频，最多 {wf.max_audios} 个</span>
        <ReferenceAudioPicker max={wf.max_audios} />
      </div>

      <fieldset className="field">
        <legend>生成时间</legend>
        <div className="choices">
          {(['now', 'night'] as RunMode[]).map((m) => (
            <label key={m} className={m === runMode ? 'choice checked' : 'choice'}>
              <input type="radio" name="m-run-mode" checked={m === runMode} onChange={() => setRunMode(m)} />
              <span>{RUN_MODE_LABEL[m]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {create.error && <p className="field-error" role="alert">{create.error.message}</p>}
      <div className="actions">
        <button className="btn btn-primary" disabled={!canSubmit}>{create.isPending ? '提交中' : '确认生成'}</button>
      </div>
    </form>
  )
}
