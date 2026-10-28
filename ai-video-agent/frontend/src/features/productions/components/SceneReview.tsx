import { useState } from 'react'
import { productionsApi } from '../api'
import { useProductionAction } from '../hooks'
import type { ProductionDetail, SceneItem } from '../types'
import { RegenerateBox } from './RegenerateBox'

/** 审核 A：分镜。每个镜头三项（场景、动作、运镜）都是英文短语，会直接拼进视频提示词。 */
export function SceneReview({ production }: { production: ProductionDetail }) {
  const content = production.content!
  const [scenes, setScenes] = useState<SceneItem[]>(content.content.scenes)
  const approve = useProductionAction(production.id, productionsApi.approveScene)
  const regen = useProductionAction(production.id, productionsApi.regenerate)
  const error = approve.error ?? regen.error

  const set = (i: number, key: keyof Omit<SceneItem, 'scene_id'>, value: string) =>
    setScenes((prev) => prev.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)))
  const complete = scenes.every((s) => s.scene_desc.trim() && s.action_desc.trim() && s.camera_desc.trim())

  return (
    <section className="panel form" aria-labelledby="review-a">
      <div className="row-between">
        <h2 id="review-a">审核分镜</h2>
        <span className="muted">第 {content.version} 版，{content.source === 'llm' ? 'AI 生成' : '人工修改'}</span>
      </div>
      {content.content.theme && <p>主题：{content.content.theme}</p>}

      {scenes.map((s, i) => (
        <fieldset key={s.scene_id} className="scene">
          <legend>镜头 {i + 1}</legend>
          <div className="field">
            <label htmlFor={`sd-${i}`}>场景</label>
            <input id={`sd-${i}`} className="input" value={s.scene_desc} onChange={(e) => set(i, 'scene_desc', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`ad-${i}`}>动作</label>
            <input id={`ad-${i}`} className="input" value={s.action_desc} onChange={(e) => set(i, 'action_desc', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`cd-${i}`}>运镜</label>
            <input id={`cd-${i}`} className="input" value={s.camera_desc} onChange={(e) => set(i, 'camera_desc', e.target.value)} />
          </div>
        </fieldset>
      ))}

      {error && <p className="field-error" role="alert">{error.message}</p>}
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={!complete || approve.isPending}
          onClick={() => approve.mutate(scenes)}>
          通过，审核台词
        </button>
      </div>
      <RegenerateBox label="按意见重新生成全部内容" pending={regen.isPending} onSubmit={(fb) => regen.mutate(fb)} />
    </section>
  )
}
