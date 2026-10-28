import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useWorkspace } from '@/features/workspace/hooks'
import { EmptyState, ErrorState, LoadingRows } from '@/shared/components/StateViews'
import { formatTime } from '@/shared/format'
import type { TemplateKind } from './api'
import { useRemoveTemplate, useTemplateMeta, useTemplates } from './hooks'
import { TemplateForm } from './TemplateForm'

const scopeOf = (t: { account_id: string | null; platform: string | null }) =>
  t.account_id ? '本账号类型专属' : t.platform ? '本业务线通用' : '全局通用'

/**
 * 提示词模板：保存在数据库里，按「业务线 + 账号类型」区分，生成时现查。
 * 种类在 URL 里；匹配优先级：账号类型专属 > 业务线通用 > 全局通用。缺少必需的种类时不能创建任务。
 */
export function TemplatesTab() {
  const { accountId } = useWorkspace()
  const [params, setParams] = useSearchParams()
  const { data: meta } = useTemplateMeta()
  const kinds = (meta ? Object.keys(meta.kinds) : []) as TemplateKind[]
  const kind = (kinds.find((k) => k === params.get('kind')) ?? kinds[0] ?? 'content') as TemplateKind
  const [editing, setEditing] = useState<string>() // 'new' | 模板 id
  const { data: templates, isLoading, error, refetch } = useTemplates(kind, accountId)
  const remove = useRemoveTemplate()
  const required = meta?.required.includes(kind)

  return (
    <section className="stack" aria-labelledby="tpl-title">
      <div className="row-between">
        <h2 id="tpl-title">提示词模板</h2>
        {!editing && <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>新建模板</button>}
      </div>
      <p className="muted">
        模板都存在数据库里，生成时按这个账号类型现查。「内容生成」两份发给大模型；
        前缀、角色设定、镜头写法、台词写法按顺序拼成传给视频模型的提示词。保存会生成新版本，旧版本保留。
      </p>
      <div className="filters" role="group" aria-label="模板种类">
        {kinds.map((k) => (
          <button key={k} type="button" className={k === kind ? 'chip active' : 'chip'} aria-pressed={k === kind}
            onClick={() => { setParams({ kind: k }, { replace: true }); setEditing(undefined) }}>
            {meta?.kinds[k] ?? k}
          </button>
        ))}
      </div>

      {editing && (
        <TemplateForm key={`${kind}-${editing}`} kind={kind} accountId={accountId}
          template={templates?.find((t) => t.id === editing)} onDone={() => setEditing(undefined)} />
      )}

      {isLoading && <LoadingRows rows={3} />}
      {error && <ErrorState message={error.message} onRetry={() => refetch()} />}
      {templates?.length === 0 && (
        <EmptyState
          title={required ? '缺少这份必需的模板' : '还没有这份模板'}
          hint={required ? '没有它就不能创建任务，请新建一份。' : '可以不建，相当于空。'}
        />
      )}
      {templates && templates.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th scope="col">名称</th><th scope="col">适用范围</th><th scope="col">版本</th><th scope="col">更新时间</th><th scope="col">操作</th></tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{scopeOf(t)}</td>
                  <td className="num">第 {t.version} 版</td>
                  <td className="num">{formatTime(t.created_at)}</td>
                  <td>
                    <div className="actions">
                      <button type="button" className="btn-link" onClick={() => setEditing(t.id)}>编辑</button>
                      <button type="button" className="btn-link" disabled={remove.isPending}
                        onClick={() => window.confirm(`停用「${t.name}」？历史版本会保留。`) && remove.mutate(t.id)}>
                        停用
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
