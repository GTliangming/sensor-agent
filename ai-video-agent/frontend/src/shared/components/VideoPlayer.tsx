interface Props {
  src: string
  /** 竖屏视频限制最大宽度，避免占满整行 */
  aspectRatio?: string
}

export function VideoPlayer({ src, aspectRatio = '9:16' }: Props) {
  const [w, h] = aspectRatio.split(':').map(Number)
  return (
    <video
      className="video-player"
      src={src}
      controls
      playsInline
      preload="metadata"
      style={{ aspectRatio: `${w} / ${h}` }}
    />
  )
}
