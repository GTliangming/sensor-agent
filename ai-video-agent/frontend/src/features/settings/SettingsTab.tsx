import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { catalogApi, type AccountType, type GenerationConfig } from '@/api/catalog'
import { useWorkspace, workspacePath } from '@/features/workspace/hooks'

/**
 * 账号设置：这个账号类型保存在数据库里的全部配置。
 * 人设、画面风格，以及生成配置：AutoDL 工作流 ID、seed、时长与参考图上限、视频方向选项、请求字段名。
 * 改完保存，对之后创建的任务立即生效，不需要改代码或重启。
 */
export function SettingsTab() {
  const { account } = useWorkspace()
  return account ? (
    <div className="stack">
      <SettingsForm key={account.id} account={account} />
      <CopyForm account={account} />
    </div>
  ) : null
}

const isInt = (s: string) => /^\d+$/.test(s) && Number.isSafeInteger(Number(s))

function SettingsForm({ account }: { account: AccountType }) {
  const qc = useQueryClient()
  const cfg = account.params
  const [persona, setPersona] = useState(account.persona)
  const [style, setStyle] = useState(account.style_guide ?? '')
  const [workflowId, setWorkflowId] = useState(cfg.workflow_id)
  const [seed, setSeed] = useState(cfg.seed == null ? '' : String(cfg.seed))
  const [minD, setMinD] = useState(String(cfg.min_duration))
  const [defD, setDefD] = useState(String(cfg.default_duration))
  const [maxD, setMaxD] = useState(String(cfg.max_duration))
  const [maxImages, setMaxImages] = useState(String(cfg.max_images))
  const [requiresImage, setRequiresImage] = useState(cfg.requires_image)
  const [defaultRes, setDefaultRes] = useState(cfg.default_resolution ?? '')
  const [resolutions, setResolutions] = useState(JSON.stringify(cfg.resolutions, null, 2))
  const [fields, setFields] = useState(JSON.stringify(cfg.fields, null, 2))
  const [jsonError, setJsonError] = useState<string>()
  const [saved, setSaved] = useState(false)

  const numbersOk = [minD, defD, maxD, maxImages].every(isInt) && (seed === '' || isInt(seed))

  const save = useMutation({
    mutationFn: (params: GenerationConfig) => catalogApi.update(account.id, {
      name: account.name, persona: persona.trim(), style_guide: style.trim() || null, params,
      is_active: account.is_active,
    }),
    onSuccess: () => { setSaved(true); qc.invalidateQueries({ queryKey: ['business-lines'] }) },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setSaved(false)
    setJsonError(undefined)
    let parsedRes: GenerationConfig['resolutions']
    let parsedFields: GenerationConfig['fields']
    try {
      parsedRes = JSON.parse(resolutions)
      parsedFields = JSON.parse(fields)
    } catch {
      return setJsonError('视频方向或请求字段名不是合法的 JSON，请检查括号和引号')
    }
    // 其余没有在表单里展示的配置项（如 video_config、config_version）原样保留
    save.mutate({
      ...cfg, workflow_id: workflowId.trim(), seed: seed === '' ? null : Number(seed),
      min_duration: Number(minD), default_duration: Number(defD), max_duration: Number(maxD),
      max_images: Number(maxImages), requires_image: requiresImage,
      default_resolution: defaultRes || null, resolutions: parsedRes, fields: parsedFields,
    })
  }

  const labels = (() => {
    try { return (JSON.parse(resolutions) as { label: string }[]).map((r) => r.label) } catch { return cfg.resolutions.map((r) => r.label) }
  })()

  return (
    <form className="panel form" onSubmit={submit} aria-labelledby="settings-title">
      <h2 id="settings-title">账号设置</h2>

      <div className="field">
        <label htmlFor="persona">人设与语气</label>
        <textarea id="persona" className="input" rows={3} value={persona} onChange={(e) => setPersona(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="style">画面风格与禁忌</label>
        <textarea id="style" className="input" rows={3} value={style} onChange={(e) => setStyle(e.target.value)} />
      </div>

      <h3>生成配置</h3>
      <div className="field">
        <label htmlFor="workflow-id">AutoDL 工作流 ID</label>
        <input id="workflow-id" className="input" value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} />
        {!workflowId.trim() && <p className="field-error">还没有填写，不填就无法真正提交到 AutoDL。</p>}
      </div>
      <div className="field">
        <label htmlFor="default-seed">默认 seed</label>
        <input id="default-seed" className="input input-short num" inputMode="numeric" value={seed}
          onChange={(e) => setSeed(e.target.value.trim())} />
        <p className="muted">创建视频时作为 seed 的初始值，每个任务实际用的 seed 会记在任务里。</p>
      </div>
      <div className="row-fields">
        <div className="field"><label htmlFor="min-d">最短时长，秒</label>
          <input id="min-d" className="input num" inputMode="numeric" value={minD} onChange={(e) => setMinD(e.target.value)} /></div>
        <div className="field"><label htmlFor="def-d">默认时长，秒</label>
          <input id="def-d" className="input num" inputMode="numeric" value={defD} onChange={(e) => setDefD(e.target.value)} /></div>
        <div className="field"><label htmlFor="max-d">最长时长，秒</label>
          <input id="max-d" className="input num" inputMode="numeric" value={maxD} onChange={(e) => setMaxD(e.target.value)} /></div>
        <div className="field"><label htmlFor="max-img">参考图上限，张</label>
          <input id="max-img" className="input num" inputMode="numeric" value={maxImages} onChange={(e) => setMaxImages(e.target.value)} /></div>
      </div>
      <label className="check">
        <input type="checkbox" checked={requiresImage} onChange={(e) => setRequiresImage(e.target.checked)} />
        <span>必须至少上传 1 张参考图（H3 工作流的 ref_image_0 是必填）</span>
      </label>
      <div className="field">
        <label htmlFor="default-res">默认视频方向</label>
        <select id="default-res" className="input input-short" value={defaultRes} onChange={(e) => setDefaultRes(e.target.value)}>
          <option value="">取第一项</option>
          {labels.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="resolutions">视频方向选项，JSON</label>
        <textarea id="resolutions" className="input mono-area" rows={8} value={resolutions} onChange={(e) => setResolutions(e.target.value)} />
        <p className="muted">label 会原样作为 resolution 参数发给 AutoDL，增删选项后创建页立刻跟着变。</p>
      </div>
      <div className="field">
        <label htmlFor="fields">请求字段名，JSON</label>
        <textarea id="fields" className="input mono-area" rows={11} value={fields} onChange={(e) => setFields(e.target.value)} />
        <p className="muted">
          对应 AutoDL 工作流的参数名，留空表示不传。images、audios 填编号字段的前缀，例如 ref_image_ 会得到 ref_image_0、ref_image_1。
          image_mode 为 url 时传图片地址，要求后端的 PUBLIC_BASE_URL 是公网可访问的。
        </p>
      </div>

      {jsonError && <p className="field-error" role="alert">{jsonError}</p>}
      {save.error && <p className="field-error" role="alert">{save.error.message}</p>}
      {saved && <p role="status" className="notice">已保存，对之后创建的任务生效</p>}
      <div className="actions">
        <button className="btn btn-primary" disabled={!persona.trim() || !numbersOk || save.isPending}>保存</button>
      </div>
    </form>
  )
}

/** 新增一种账号类型：复制当前类型的生成配置和全部专属模板，再去改人设和模板。 */
function CopyForm({ account }: { account: AccountType }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { lineKey } = useWorkspace()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const create = useMutation({
    mutationFn: () => catalogApi.create({
      platform: account.platform, slug, name: name.trim(), persona: account.persona, copy_from: account.id,
    }),
    onSuccess: async (created) => {
      await qc.invalidateQueries({ queryKey: ['business-lines'] })
      navigate(workspacePath(lineKey, created.id, 'settings'))
    },
  })
  const slugOk = /^[a-z0-9_]{1,32}$/.test(slug)

  return (
    <form className="panel form" onSubmit={(e) => { e.preventDefault(); create.mutate() }} aria-labelledby="copy-title">
      <h2 id="copy-title">新增账号类型</h2>
      <p className="muted">复制「{account.name}」的生成配置和全部专属模板，创建后到新类型里修改人设和模板。</p>
      <div className="field">
        <label htmlFor="copy-name">名称</label>
        <input id="copy-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
      </div>
      <div className="field">
        <label htmlFor="copy-slug">标识，小写字母、数字、下划线</label>
        <input id="copy-slug" className="input input-short" value={slug} aria-invalid={slug !== '' && !slugOk}
          onChange={(e) => setSlug(e.target.value.trim())} />
      </div>
      {create.error && <p className="field-error" role="alert">{create.error.message}</p>}
      <div className="actions">
        <button className="btn" disabled={!name.trim() || !slugOk || create.isPending}>复制并创建</button>
      </div>
    </form>
  )
}
