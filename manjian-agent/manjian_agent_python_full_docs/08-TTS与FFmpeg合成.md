# 08 TTS 与 FFmpeg 合成

## 1. TTS 责任边界

TTS 输入是通过校验的旁白文本和语音配置，输出是本地音频文件及元数据。每个片段记录：
- scene_id
- text_hash
- provider / model / voice_id
- speed / pitch（若支持）
- duration_ms
- file_path / content_hash
- generated_at

TTS 供应商的音色授权、使用范围和内容政策需要在接入前核实。不要未经许可克隆真实人物声音。

## 2. 字幕

第一版按每个场景的旁白片段生成 SRT，时间轴来自实际音频时长，而不是完全相信模型给出的秒数。若一个场景内语音很长，可按句子切分并对齐；没有强制要求时不必一开始就引入复杂 ASR 对齐服务。

## 3. FFmpeg 渲染

- 使用固定的渲染模板，保证输入相同则输出行为可复现。
- 调用 subprocess 时使用参数数组，不拼接未经校验的 shell 字符串。
- 限制分辨率、帧率、最大时长和并发任务数。
- 渲染后通过 `ffprobe` 检查容器、视频流、音频流、时长和分辨率。
- 失败时保存退出码和 stderr 摘要，清理临时文件但保留必要诊断信息。

## 4. RenderPlan 示例

```json
{
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "format": "mp4",
  "video_codec": "libx264",
  "audio_codec": "aac",
  "subtitle_path": "/work/task_x/subtitles.srt",
  "scenes": [
    {
      "scene_id": "scene_01",
      "visual_path": "/work/task_x/scene_01.png",
      "audio_path": "/work/task_x/scene_01.wav",
      "duration_seconds": 2.7
    }
  ]
}
```

该 JSON 只是结构示例；实际执行前必须校验路径归属、文件存在、扩展名与媒体内容一致，避免路径穿越或执行任意文件。
