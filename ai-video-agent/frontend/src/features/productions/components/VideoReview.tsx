import { useState } from 'react'
import { VideoPlayer } from '@/shared/components/VideoPlayer'
import { productionsApi } from '../api'
import { useProductionAction } from '../hooks'
import { RUN_MODE_LABEL } from '../status'
import type { ProductionDetail, RunMode } from '../types'

/** 发布所需的文案，方便复制到视频号。 */
export function PublishCopy({ production }: { production: ProductionDetail }) {
  const c = production.content?.content
  if (!c) return null
  return (
    <dl className="kv">
      <dt>主题</dt><dd>{c.theme || production.topic}</dd>
      <dt>台词</dt><dd>{c.tts_text}</dd>
    </dl>
  )
}

/** 视频方向标签里带“横”或“1:1”时调整播放器比例，默认竖屏。 */
export function aspectOf(resolution: string): string {
  if (resolution.includes('1:1')) return '1:1'
  return resolution.includes('横') ? '16:9' : '9:16'
}

/** 审核 C：成片。重新生成会再消耗一次 GPU 费用（沿用当前已审核的分镜与台词），所以需要确认。 */
export function VideoReview({ production }: { production: ProductionDetail }) {
  const video = production.video
  const [runMode, setRunMode] = useState<RunMode>(production.run_mode)
  const approve = useProductionAction(production.id, (id: string, _: void) => productionsApi.approveVideo(id))
  const regen = useProductionAction(production.id, productionsApi.regenerateVideo)
  const error = approve.error ?? regen.error

  function regenerate() {
    if (!window.confirm('重新生成会再消耗一次 GPU 费用，确定吗？')) return
    regen.mutate({ run_mode: runMode })
  }

  return (
    <section className="panel form" aria-labelledby="review-c">
      <h2 id="review-c">审核成片</h2>
      {video?.video_url && (
        <div className="player-wrap">
          <VideoPlayer src={video.video_url} aspectRatio={aspectOf(production.resolution)} />
          <a className="btn-link" href={video.video_url} download={`${production.id}.mp4`}>下载视频</a>
        </div>
      )}
      <PublishCopy production={production} />
      {error && <p className="field-error" role="alert">{error.message}</p>}
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={approve.isPending} onClick={() => approve.mutate()}>通过，待发布</button>
      </div>
      <details className="disclosure">
        <summary>不满意，重新生成</summary>
        <p className="muted">沿用当前的分镜和台词，换一个随机 seed 再生成一次；想换内容请废弃后重新创建。</p>
        <div className="choices">
          {(['now', 'night'] as RunMode[]).map((m) => (
            <label key={m} className={m === runMode ? 'choice checked' : 'choice'}>
              <input type="radio" name="vr-mode" checked={m === runMode} onChange={() => setRunMode(m)} />
              <span>{RUN_MODE_LABEL[m]}</span>
            </label>
          ))}
        </div>
        <button type="button" className="btn" disabled={regen.isPending} onClick={regenerate}>重新生成视频</button>
      </details>
    </section>
  )
}
