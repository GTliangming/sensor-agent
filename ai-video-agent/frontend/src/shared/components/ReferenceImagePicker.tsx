import { useRef, useState } from 'react'
import { uploadsApi } from '@/api/uploads'

export interface PickedImage {
  id: string
  url: string
}

interface Props {
  value: PickedImage[]
  onChange: (images: PickedImage[]) => void
  max: number
}

const MAX_BYTES = 10 * 1024 * 1024 // 与后端 MAX_UPLOAD_BYTES 默认值一致，仅用于提前提示

/** 参考图片选择：可选，最多 max 张；逐张上传，成功后显示缩略图，可单独移除。 */
export function ReferenceImagePicker({ value, onChange, max }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const full = value.length >= max

  async function handleFiles(files: FileList) {
    setError(undefined)
    setBusy(true)
    const next = [...value]
    try {
      for (const file of Array.from(files).slice(0, max - next.length)) {
        if (file.size > MAX_BYTES) {
          setError(`${file.name} 超过 10 MB，已跳过`)
          continue
        }
        const result = await uploadsApi.uploadImage(file)
        next.push({ id: result.file_id, url: result.url })
        onChange([...next])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="picker">
      <ul className="thumbs">
        {value.map((img, i) => (
          <li key={img.id} className="thumb">
            <img src={img.url} alt={`参考图 ${i + 1}`} />
            <button type="button" className="thumb-remove" aria-label={`移除参考图 ${i + 1}`}
              onClick={() => onChange(value.filter((v) => v.id !== img.id))}>
              移除
            </button>
          </li>
        ))}
      </ul>
      <div className="picker-actions">
        <button type="button" className="btn" disabled={full || busy} onClick={() => inputRef.current?.click()}>
          {busy ? '上传中' : '添加图片'}
        </button>
        <span className="muted num">{value.length}/{max}</span>
        <input ref={inputRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp"
          onChange={(e) => e.target.files && handleFiles(e.target.files)} />
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  )
}

/** 参考音频：暂未开放，只展示上限并置灰。 */
export function ReferenceAudioPicker({ max }: { max: number }) {
  return (
    <div className="picker">
      <div className="picker-actions">
        <button type="button" className="btn" disabled aria-disabled="true">添加音频</button>
        <span className="muted num">0/{max}</span>
      </div>
      <p className="muted">暂未开放。</p>
    </div>
  )
}
