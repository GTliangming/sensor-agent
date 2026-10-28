import { useState } from 'react'
import { productionsApi } from '../api'
import { useProductionAction } from '../hooks'
import type { ProductionDetail, SubtitleItem } from '../types'
import { RegenerateBox } from './RegenerateBox'

/** 审核 B：台词与字幕。通过后创建视频任务，夜间模式则排队等窗口。 */
export function DialogueReview({ production }: { production: ProductionDetail }) {
  const content = production.content!
  const [tts, setTts] = useState(content.content.tts_text)
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>(content.content.subtitles)
  const approve = useProductionAction(production.id, (id: string, edit: { tts_text: string; subtitles: SubtitleItem[] }) =>
    productionsApi.approveDialogue(id, edit))
  const regen = useProductionAction(production.id, productionsApi.regenerate)
  const back = useProductionAction(production.id, (id: string, _: void) => productionsApi.backToScene(id))
  const error = approve.error ?? regen.error ?? back.error
  const setText = (i: number, text: string) => setSubtitles((prev) => prev.map((s, idx) => (idx === i ? { ...s, text } : s)))

  return (
    <section className="panel form" aria-labelledby="review-b">
      <div className="row-between">
        <h2 id="review-b">审核台词与字幕</h2>
        <span className="muted">第 {content.version} 版，{content.source === 'llm' ? 'AI 生成' : '人工修改'}</span>
      </div>

      <div className="field">
        <label htmlFor="tts">台词，视频里人物说的话</label>
        <textarea id="tts" className="input" rows={4} value={tts} onChange={(e) => setTts(e.target.value)} />
        <span className="muted num">{tts.length} 字</span>
      </div>

      <fieldset className="field">
        <legend>字幕</legend>
        <ol className="subtitles">
          {subtitles.map((s, i) => (
            <li key={i}>
              <span className="num muted">{s.start.slice(3, 8)} 到 {s.end.slice(3, 8)}</span>
              <input className="input" aria-label={`字幕 ${i + 1}`} value={s.text} onChange={(e) => setText(i, e.target.value)} />
            </li>
          ))}
        </ol>
      </fieldset>

      {error && <p className="field-error" role="alert">{error.message}</p>}
      <div className="actions">
        <button type="button" className="btn btn-primary"
          disabled={!tts.trim() || subtitles.some((s) => !s.text.trim()) || approve.isPending}
          onClick={() => approve.mutate({ tts_text: tts.trim(), subtitles })}>
          通过，{production.run_mode === 'night' ? '加入夜间队列' : '开始生成视频'}
        </button>
        <button type="button" className="btn" disabled={back.isPending} onClick={() => back.mutate()}>退回修改分镜</button>
      </div>
      <RegenerateBox label="按意见重新生成全部内容" pending={regen.isPending} onSubmit={(fb) => regen.mutate(fb)}
        placeholder="例如：台词更口语一点，少一点说教" />
    </section>
  )
}
