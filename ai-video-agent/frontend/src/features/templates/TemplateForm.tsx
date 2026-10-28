import { useState, type FormEvent } from 'react'
import { useWorkspace } from '@/features/workspace/hooks'
import type { Template, TemplateKind } from './api'
import { useSaveTemplate, useTemplateMeta } from './hooks'

interface Props {
  kind: TemplateKind
  accountId: string
  /** 编辑已有模板（保存为新版本）；不传表示新建 */
  template?: Template
  onDone: () => void
}

export function TemplateForm({ kind, accountId, template, onDone }: Props) {
  const { data: meta } = useTemplateMeta()
  const { line } = useWorkspace()
  const save = useSaveTemplate(kind, template?.id)
  const [name, setName] = useState(template?.name ?? '')
  const [body, setBody] = useState(template?.body ?? '')
  // 新建时选择适用范围；编辑时保持原来的范围
  const [scope, setScope] = useState<'account' | 'line'>('account')
  const required = meta?.required.includes(kind) ?? false

  function submit(e: FormEvent) {
    e.preventDefault()
    const target = template
      ? { account_id: template.account_id, platform: template.platform }
      : scope === 'account'
        ? { account_id: accountId, platform: null }
        : { account_id: null, platform: line?.key ?? null }
    save.mutate({ name: name.trim(), body, video_type: template?.video_type ?? null, ...target }, { onSuccess: onDone })
  }

  return (
    <form className="panel form" onSubmit={submit}>
      <h3>{template ? `编辑，保存为第 ${template.version + 1} 版` : '新建模板'}</h3>
      {!template && (
        <fieldset className="field">
          <legend>适用范围</legend>
          <div className="choices">
            <label className={scope === 'account' ? 'choice checked' : 'choice'}>
              <input type="radio" name="tpl-scope" checked={scope === 'account'} onChange={() => setScope('account')} />
              <span>本账号类型专属</span>
            </label>
            <label className={scope === 'line' ? 'choice checked' : 'choice'}>
              <input type="radio" name="tpl-scope" checked={scope === 'line'} onChange={() => setScope('line')} />
              <span>{line?.name ?? '本业务线'}下通用</span>
            </label>
          </div>
        </fieldset>
      )}
      <div className="field">
        <label htmlFor="tpl-name">名称</label>
        <input id="tpl-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
      </div>
      <div className="field">
        <label htmlFor="tpl-body">内容</label>
        <textarea id="tpl-body" className="input mono-area" rows={16} value={body} onChange={(e) => setBody(e.target.value)} />
        {meta && !body && (
          <button type="button" className="btn-link" onClick={() => setBody(meta.starters[kind])}>以内置起步文本为参考</button>
        )}
      </div>
      {meta && (
        <div className="chips" role="group" aria-label="可用变量，点击插入">
          {Object.entries(meta.variables).map(([k, desc]) => (
            <button type="button" key={k} className="chip" title={desc} onClick={() => setBody((b) => `${b}{{${k}}}`)}>
              {`{{${k}}}`}
            </button>
          ))}
        </div>
      )}
      {save.error && <p className="field-error" role="alert">{save.error.message}</p>}
      <div className="actions">
        <button className="btn btn-primary" disabled={!name.trim() || (required && !body.trim()) || save.isPending}>保存</button>
        <button type="button" className="btn" onClick={onDone}>取消</button>
      </div>
    </form>
  )
}
