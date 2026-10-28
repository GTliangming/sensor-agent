import { useState } from 'react'

interface Props {
  label: string
  pending: boolean
  onSubmit: (feedback: string) => void
  placeholder?: string
}

/** “带修改意见重新生成”：意见会和上一版一起交给模型，在原稿上改。 */
export function RegenerateBox({ label, pending, onSubmit, placeholder }: Props) {
  const [feedback, setFeedback] = useState('')
  return (
    <div className="regen">
      <label htmlFor="regen-fb">修改意见</label>
      <textarea id="regen-fb" className="input" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)}
        placeholder={placeholder ?? '例如：第二个镜头更安静，台词再短一点'} />
      <button type="button" className="btn" disabled={!feedback.trim() || pending} onClick={() => onSubmit(feedback.trim())}>
        {label}
      </button>
    </div>
  )
}
