from __future__ import annotations

import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw

from .audio import synthesize_narration
from .frames import fit_asset, render_rank_frame, render_transition_frame, semantic_lines
from .layout import load_font, safe_area


TIMELINE = (
    ("hook", 0, 3),
    ("rank3", 3, 15),
    ("rank2", 15, 29),
    ("rank1", 29, 46),
    ("outro", 46, 54),
)
VIDEO_SUFFIXES = frozenset({".mp4", ".mov", ".m4v", ".webm"})
IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp"})


@dataclass(frozen=True, slots=True)
class Script:
    items: tuple
    captions: tuple[str, ...]


def _metric_text(value):
    if isinstance(value, int) or float(value).is_integer():
        return f"{int(value):,}"
    return f"{float(value):,.2f}".rstrip("0").rstrip(".")


def build_script(manifest):
    ordered = tuple(sorted(manifest.items, key=lambda item: item.rank, reverse=True))
    captions = [f"{manifest.month}の人気コンテンツ、トップ3。"]
    captions.extend(
        f"第{item.rank}位。{item.title}。{manifest.ranking_label}は、"
        f"{_metric_text(item.metric_value)}回でした。"
        for item in ordered
    )
    captions.append(
        "気になる内容は、ごうホームクリニック公式チャンネルとサイトでご覧ください。"
    )
    return Script(ordered, tuple(captions))


def special_transition_starts(config):
    if config.placement == "hook":
        return (0,)
    if config.placement == "chapter":
        return (15, 29)
    return ()


def run_ffmpeg(command, *, runner=subprocess.run, stage="render"):
    try:
        result = runner(
            command,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except (subprocess.CalledProcessError, OSError):
        raise RuntimeError(f"ffmpeg {stage} failed") from None
    if getattr(result, "returncode", 0) != 0:
        raise RuntimeError(f"ffmpeg {stage} failed")
    return result


def materialize_asset_frames(asset, directory, config, *, runner=subprocess.run):
    asset = Path(asset)
    suffix = asset.suffix.lower()
    if suffix in IMAGE_SUFFIXES:
        return (asset,)
    if suffix not in VIDEO_SUFFIXES:
        raise ValueError(f"unsupported asset type: {suffix or 'none'}")
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    pattern = directory / "frame-%06d.png"
    command = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        str(asset),
        "-vf",
        f"fps={config.fps}",
        str(pattern),
    ]
    run_ffmpeg(command, runner=runner, stage="asset decode")
    frames = tuple(sorted(directory.glob("frame-*.png")))
    if not frames:
        raise RuntimeError("ffmpeg asset decode produced no frames")
    return frames


def _rank_asset(project_dir, rank):
    candidates = [
        path
        for path in Path(project_dir).glob(f"rank-{rank}.*")
        if path.suffix.lower() in IMAGE_SUFFIXES | VIDEO_SUFFIXES
    ]
    if len(candidates) != 1:
        raise ValueError(f"rank-{rank} requires exactly one image or video asset")
    return candidates[0]


def _bgm_asset(project_dir):
    candidates = [
        Path(project_dir) / name
        for name in ("bgm.wav", "bgm.mp3", "bgm.m4a", "bgm.aac")
        if (Path(project_dir) / name).is_file()
    ]
    if len(candidates) != 1:
        raise ValueError("project requires exactly one bgm audio file")
    return candidates[0]


def _caption_frame(frame, caption, config):
    canvas = (config.width, config.height)
    result = frame.convert("RGBA")
    overlay = Image.new("RGBA", canvas, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    left, top, right, _ = safe_area(canvas)
    font_size = round(38 * config.width / 1080)
    font = load_font(font_size)
    limit = max(1, int((right - left - 40) / max(font_size, 1)))
    exact_caption = "\n".join(semantic_lines(caption, limit))
    spacing = max(1, round(font_size * 0.2))
    bounds = draw.multiline_textbbox((0, 0), exact_caption, font=font, spacing=spacing)
    box_bottom = top + (bounds[3] - bounds[1]) + round(44 * config.height / 1920)
    draw.rounded_rectangle(
        (left, top, right, box_bottom),
        radius=round(20 * config.width / 1080),
        fill=(0, 0, 0, 190),
    )
    draw.multiline_text(
        (left + round(20 * config.width / 1080), top + round(16 * config.height / 1920)),
        exact_caption,
        font=font,
        fill="white",
        spacing=spacing,
    )
    return Image.alpha_composite(result, overlay).convert("RGB")


def _timeline_entry(seconds):
    for index, (name, start, end) in enumerate(TIMELINE):
        if start <= seconds < end:
            return index, name
    return len(TIMELINE) - 1, "outro"


def _asset_image(paths, frame_number):
    path = paths[frame_number % len(paths)]
    with Image.open(path) as source:
        return source.convert("RGB").copy()


def render_frames(project_dir, manifest, config, directory, *, runner=subprocess.run):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    script = build_script(manifest)
    items = {item.rank: item for item in manifest.items}
    materialized = {
        rank: materialize_asset_frames(
            _rank_asset(project_dir, rank),
            directory.parent / f"asset-{rank}",
            config,
            runner=runner,
        )
        for rank in (1, 2, 3)
    }
    background = Image.new("RGB", (config.width, config.height), "#111827")
    starts = set(special_transition_starts(config))
    total_frames = TIMELINE[-1][2] * config.fps

    for frame_index in range(total_frames):
        seconds = frame_index / config.fps
        caption_index, name = _timeline_entry(seconds)
        rank = 3 if name in {"hook", "rank3"} else 2 if name == "rank2" else 1
        item = items[rank]
        asset = _asset_image(materialized[rank], frame_index)

        transition_start = next(
            (start for start in starts if start <= seconds < start + 1),
            None,
        )
        if transition_start is not None:
            next_frame = fit_asset(asset, (config.width, config.height))
            frame = render_transition_frame(
                script.captions[caption_index],
                next_frame,
                background,
                seconds - transition_start,
                config,
            )
        else:
            frame = render_rank_frame(manifest, item, asset, seconds, config)
        frame = _caption_frame(frame, script.captions[caption_index], config)
        frame.save(directory / f"frame-{frame_index + 1:06d}.png")
    return directory / "frame-%06d.png"


def build_ffmpeg_command(frames, narration, bgm, output, config):
    filter_complex = (
        "[1:a]apad,atrim=duration=54[narration];"
        "[2:a]volume=0.18,apad,atrim=duration=54[bgm];"
        "[narration][bgm]amix=inputs=2:duration=longest:dropout_transition=0[mixed]"
    )
    return [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-framerate",
        str(config.fps),
        "-i",
        str(frames),
        "-i",
        str(narration),
        "-stream_loop",
        "-1",
        "-i",
        str(bgm),
        "-filter_complex",
        filter_complex,
        "-map",
        "0:v:0",
        "-map",
        "[mixed]",
        "-t",
        "54",
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(config.fps),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(output),
    ]


def render_video(
    project_dir,
    manifest,
    config,
    api_key,
    output,
    *,
    tts_func=synthesize_narration,
    frames_func=render_frames,
    runner=subprocess.run,
):
    if not isinstance(api_key, str) or not api_key.strip():
        raise ValueError("Gemini API key is required")
    project_dir = Path(project_dir)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    script = build_script(manifest)
    bgm = _bgm_asset(project_dir)

    with tempfile.TemporaryDirectory(prefix="ranking-shorts-") as temporary:
        workspace = Path(temporary)
        narration = workspace / "narration.wav"
        frames_dir = workspace / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)
        tts_func(
            "\n".join(script.captions),
            api_key.strip(),
            narration,
            model=os.environ.get("GEMINI_TTS_MODEL"),
            runner=runner,
        )
        frames = frames_func(
            project_dir,
            manifest,
            config,
            frames_dir,
            runner=runner,
        )
        command = build_ffmpeg_command(frames, narration, bgm, output, config)
        run_ffmpeg(command, runner=runner, stage="render")
    if not output.is_file():
        raise RuntimeError("ffmpeg render did not create output")
    return output
