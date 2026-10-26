"""FFmpeg 渲染服务（文档 08.3，阶段 4 + 连续性增强）。

连续性做法（不依赖视频生成模型，纯 FFmpeg 确定性实现）：
- 场景内：Ken Burns 运镜（zoompan 缓慢推拉），让静态图片"动"起来；
- 场景间：xfade 交叉淡化做衔接，音频同步 acrossfade；
- 过渡时长按最短片段收敛，字幕时间轴与过渡共用 timeline，避免漂移。

subprocess 一律用参数数组，不拼接未经校验的 shell 字符串。失败保留退出码与 stderr 摘要。
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from app.config import Settings
from app.domain.plans import AudioPlan, RenderPlan
from app.domain.storyboard import Storyboard
from app.observability.logging import get_logger
from app.repositories.sqlite import TaskRepository
from app.services.assets.asset_resolver import resolve_scene_images
from app.services.media.ffmpeg_builder import build_crossfade
from app.services.media.ffprobe_service import probe_media
from app.services.media.timeline import effective_transition, total_duration

logger = get_logger(__name__)


class RenderError(RuntimeError):
    pass


class RenderService:
    def __init__(self, repo: TaskRepository, settings: Settings):
        self._repo = repo
        self._w = settings.video_width
        self._h = settings.video_height
        self._fps = settings.video_fps
        self._motion = settings.video_motion
        self._transition = settings.transition_seconds
        self._timeout = settings.render_timeout_seconds
        self._max_seconds = settings.max_output_seconds
        self._tasks_dir = settings.tasks_dir

    def render(self, task_id: str, storyboard: Storyboard, asset_plan: dict,
               audio_plan: AudioPlan, subtitle_path: str) -> RenderPlan:
        work = self._tasks_dir / task_id
        work.mkdir(parents=True, exist_ok=True)

        image_by_scene = resolve_scene_images(self._repo, asset_plan)
        audio_by_scene = {s["scene_id"]: s for s in audio_plan.segments}

        ordered = sorted(storyboard.scenes, key=lambda s: s.order)
        images: list[Path] = []
        audios: list[Path] = []
        durations: list[float] = []
        scenes_meta: list[dict] = []
        for scene in ordered:
            img = image_by_scene.get(scene.scene_id)
            aud = audio_by_scene.get(scene.scene_id)
            if img is None or not Path(img).exists():
                raise RenderError(f"场景 {scene.scene_id} 缺少可用图片文件")
            if aud is None or not Path(aud["file_path"]).exists():
                raise RenderError(f"场景 {scene.scene_id} 缺少音频文件")
            images.append(Path(img))
            audios.append(Path(aud["file_path"]))
            durations.append(float(aud["duration_seconds"]))
            scenes_meta.append({"scene_id": scene.scene_id, "visual_path": str(img),
                                "audio_path": aud["file_path"],
                                "duration_seconds": float(aud["duration_seconds"])})

        t = effective_transition(durations, self._transition)
        expected = total_duration(durations, t)
        if expected > self._max_seconds:
            raise RenderError(f"输出总时长 {expected}s 超过上限 {self._max_seconds}s")

        output = work / "output.mp4"
        tmp = work / "_novideo.mp4"
        self._compose(images, audios, durations, t, tmp)

        if subtitle_path and Path(subtitle_path).exists():
            self._mux_subtitles(tmp, Path(subtitle_path), output)
            tmp.unlink(missing_ok=True)
        else:
            tmp.replace(output)

        probe = probe_media(output)
        validated = self._validate(probe, expected)
        return RenderPlan(
            task_id=task_id, producer="render_service",
            width=self._w, height=self._h, fps=self._fps,
            scenes=scenes_meta, subtitle_path=subtitle_path or "",
            output_path=str(output), duration_seconds=probe.get("duration") or expected,
            validated=validated, probe=probe,
            warnings=[] if t > 0 else (["单场景或过渡为 0：无交叉淡化"] if len(durations) < 2 else []),
        )

    def render_from_clips(self, task_id: str, clips: list[dict], subtitle_path: str) -> RenderPlan:
        """用已规整好的每场景视频短片（含音轨）做交叉淡化拼接（图生视频路径）。"""
        work = self._tasks_dir / task_id
        work.mkdir(parents=True, exist_ok=True)
        ordered = sorted(clips, key=lambda c: c["order"])
        paths = [Path(c["clip_path"]) for c in ordered]
        durations = [float(c["duration"]) for c in ordered]
        for pth in paths:
            if not pth.exists():
                raise RenderError(f"缺少场景短片: {pth}")

        t = effective_transition(durations, self._transition)
        expected = total_duration(durations, t)
        if expected > self._max_seconds:
            raise RenderError(f"输出总时长 {expected}s 超过上限 {self._max_seconds}s")

        output = work / "output.mp4"
        tmp = work / "_novideo.mp4"
        self._compose_clips(paths, durations, t, tmp)
        if subtitle_path and Path(subtitle_path).exists():
            self._mux_subtitles(tmp, Path(subtitle_path), output)
            tmp.unlink(missing_ok=True)
        else:
            tmp.replace(output)

        probe = probe_media(output)
        validated = self._validate(probe, expected)
        scenes_meta = [{"scene_id": c["scene_id"], "visual_path": c["clip_path"],
                        "duration_seconds": float(c["duration"])} for c in ordered]
        return RenderPlan(
            task_id=task_id, producer="render_service",
            width=self._w, height=self._h, fps=self._fps,
            scenes=scenes_meta, subtitle_path=subtitle_path or "",
            output_path=str(output), duration_seconds=probe.get("duration") or expected,
            validated=validated, probe=probe,
        )

    def _compose_clips(self, clips: list[Path], durations: list[float], t: float, out: Path) -> None:
        n = len(clips)
        cmd: list[str] = ["ffmpeg", "-y"]
        for c in clips:
            cmd += ["-i", str(c)]
        parts = [f"[{i}:v]setsar=1,fps={self._fps},format=yuv420p[v{i}]" for i in range(n)]
        audio_labels = [f"[{i}:a]" for i in range(n)]
        parts, vlabel, alabel = build_crossfade(parts, audio_labels, durations, t)
        cmd += ["-filter_complex", ";".join(parts), "-map", vlabel, "-map", alabel,
                "-r", str(self._fps), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out)]
        self._run(cmd)

    # ---- ffmpeg 合成 ----
    def _video_filter(self, idx: int, dur: float) -> str:
        if self._motion:
            frames = max(1, round(dur * self._fps))
            return (
                f"[{idx}:v]scale={self._w}:{self._h}:force_original_aspect_ratio=increase,"
                f"crop={self._w}:{self._h},"
                f"zoompan=z='min(zoom+0.0012,1.12)':d={frames}:"
                f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':fps={self._fps}:s={self._w}x{self._h},"
                f"setsar=1,format=yuv420p[v{idx}]"
            )
        return (
            f"[{idx}:v]scale={self._w}:{self._h}:force_original_aspect_ratio=decrease,"
            f"pad={self._w}:{self._h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={self._fps},"
            f"format=yuv420p[v{idx}]"
        )

    def _compose(self, images: list[Path], audios: list[Path], durations: list[float],
                 t: float, out: Path) -> None:
        n = len(images)
        cmd: list[str] = ["ffmpeg", "-y"]
        for img, dur in zip(images, durations, strict=False):
            if self._motion:
                # zoompan 按 d 自行产出帧，单帧输入即可；加 -loop/-t 会使帧数叠加、时长爆炸
                cmd += ["-i", str(img)]
            else:
                cmd += ["-loop", "1", "-t", f"{dur:.3f}", "-i", str(img)]
        for aud in audios:
            cmd += ["-i", str(aud)]

        parts = [self._video_filter(i, durations[i]) for i in range(n)]
        audio_labels = [f"[{n + i}:a]" for i in range(n)]  # 音频在图片输入之后
        parts, vlabel, alabel = build_crossfade(parts, audio_labels, durations, t)

        cmd += ["-filter_complex", ";".join(parts),
                "-map", vlabel, "-map", alabel,
                "-r", str(self._fps), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out)]
        self._run(cmd)

    def _mux_subtitles(self, video: Path, srt: Path, out: Path) -> None:
        self._run(["ffmpeg", "-y", "-i", str(video), "-i", str(srt),
                   "-c", "copy", "-c:s", "mov_text", "-metadata:s:s:0", "language=chi", str(out)])


    def _validate(self, probe: dict, expected_total: float) -> bool:
        video = probe.get("video") or {}
        audio = probe.get("audio")
        ok = (
            bool(probe.get("format_name"))
            and video.get("width") == self._w and video.get("height") == self._h
            and audio is not None and probe.get("duration") is not None
            and abs(probe["duration"] - expected_total) <= max(1.0, expected_total * 0.2)
        )
        if not ok:
            logger.warning("渲染产物校验未通过 probe=%s expected=%.2f", probe, expected_total)
        return ok

    def _run(self, cmd: list[str]) -> None:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=self._timeout)
        if proc.returncode != 0:
            raise RenderError(f"ffmpeg 失败 rc={proc.returncode}: {proc.stderr.strip()[-400:]}")
